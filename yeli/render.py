"""Fast export: the server makes the edited video with ffmpeg, much faster than real time.

The editor normally records its canvas in real time, so a 3 hour edit takes 3 hours. When the project only uses things
ffmpeg can do exactly like the editor (cuts, joins, speed, volume, fades, the frame shape, rotate and mirror) and every
clip comes from the streamer's own saved videos, the server renders it instead: usually many times faster than the
video is long. Anything else (texts, stickers, watermark, filters, adjustments, zoom, music or videos from the device)
keeps using the real-time export, and so does a server without ffmpeg or one that is already busy.

  GET  /api/render/available       {fast: true|false}  whether this server can render
  POST /api/projects/<id>/render   start; body {title, short}  -> {id}.  Errors with field "fallback" mean: use real time
  GET  /api/render/<vod id>        {state: "running"|"done"|"error"|"cancelled", pct, error}
  POST /api/render/<vod id>/cancel

The result is a private clip of the owner (source "edit"), exactly like the one the real-time export saves.
"""
import json
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from flask import Blueprint, jsonify, request

from . import config, db as dbm
from .config import *
from .core import *
from .db import get_db
from .projects import VOD_REF, clean_project, get_project, live_pct as project_live_pct, timeline_seconds
from .restream import ffmpeg_bin
from .vods import MIMES, _finalize, vod_path

bp = Blueprint("render", __name__)

JOBS = {}                                    # vod id -> state of a render (this process only)
_jobs_lock = threading.Lock()
_slots = threading.BoundedSemaphore(max(1, int(os.environ.get("YELI_RENDER_JOBS", "1"))))
MAX_QUALITY_BPS = {1080: 8_000_000, 720: 4_000_000, 480: 2_000_000, 360: 1_000_000}
ASPECT_WH = {"16:9": (16, 9), "9:16": (9, 16), "1:1": (1, 1), "4:5": (4, 5)}


def available():
    return bool(ffmpeg_bin())


def eligible(data):
    """True when ffmpeg can make this project exactly as the editor would draw it."""
    if not data["clips"]:
        return False
    if data["texts"] or data["watermark"]["on"] or data["bg"] == "blur":
        return False
    for c in data["clips"]:
        if not VOD_REF.match(c["a"]):
            return False
        if c["filter"] != "none" or c["blur"] or c["opacity"] != 1 or c["bright"] or c["contrast"] or c["sat"]:
            return False
        if c["zoom"] != 1 or c["px"] or c["py"]:
            return False
    return True


def _even(n):
    return max(2, int(round(n / 2)) * 2)


def frame_size(aspect, short_side):
    aw, ah = ASPECT_WH[aspect]
    if aw >= ah:
        return _even(short_side * aw / ah), short_side
    return short_side, _even(short_side * ah / aw)


def _atempo(speed):
    """atempo only takes 0.5 to 2 per step, so 0.25x and 4x are two steps."""
    parts = []
    while speed > 2.0 + 1e-9:
        parts.append(2.0)
        speed /= 2.0
    while speed < 0.5 - 1e-9:
        parts.append(0.5)
        speed /= 0.5
    parts.append(speed)
    return ",".join(f"atempo={p:.5f}" for p in parts if abs(p - 1) > 1e-6)


def has_audio(path):
    """Does the file have a sound track? (ffmpeg -i prints the streams and then complains about the missing output: that is fine.)"""
    try:
        out = subprocess.run([ffmpeg_bin(), "-hide_banner", "-nostdin", "-i", str(path)], capture_output=True, text=True, timeout=60).stderr
    except (OSError, subprocess.SubprocessError):
        return True
    return bool(re.search(r"Stream #\d+:\d+.*: Audio:", out))


def build_filter(data, paths, audio, size):
    """The filter graph (a string) for the whole timeline, and the length of the result in seconds."""
    w, h = size
    bg = {"black": "black", "white": "white"}.get(data["bg"]) or data["bgColor"].replace("#", "0x")
    lines, labels, total = [], [], 0.0
    for i, c in enumerate(data["clips"]):
        span = c["out"] - c["in"]
        dur = span / c["speed"]
        total += dur
        v = [f"[{i}:v:0]setpts=PTS-STARTPTS"]
        if c["rot"] == 1:
            v.append("transpose=1")
        elif c["rot"] == 2:
            v.append("hflip,vflip")
        elif c["rot"] == 3:
            v.append("transpose=2")
        if c["flipH"]:
            v.append("hflip")
        if c["flipV"]:
            v.append("vflip")
        if c["fit"] == "fill":
            v.append(f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}")
        else:
            v.append(f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color={bg}")
        v.append("setsar=1")
        if abs(c["speed"] - 1) > 1e-6:
            v.append(f"setpts=PTS/{c['speed']:.5f}")
        v.append("fps=30")
        v.append(f"trim=duration={dur:.3f},setpts=PTS-STARTPTS")
        if c["fadeIn"] > 0:
            v.append(f"fade=t=in:st=0:d={min(c['fadeIn'], dur):.3f}")
        if c["fadeOut"] > 0:
            d = min(c["fadeOut"], dur)
            v.append(f"fade=t=out:st={max(0.0, dur - d):.3f}:d={d:.3f}")
        v.append("format=yuv420p")
        lines.append(",".join(v) + f"[v{i}]")

        if audio[i]:
            a = [f"[{i}:a:0]asetpts=PTS-STARTPTS"]
            tempo = _atempo(c["speed"])
            if tempo:
                a.append(tempo)
            if abs(c["volume"] - 1) > 1e-6:
                a.append(f"volume={c['volume']:.3f}")
            a.append("aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo")
            a.append(f"apad,atrim=duration={dur:.3f},asetpts=PTS-STARTPTS")
        else:
            a = [f"anullsrc=r=48000:cl=stereo,atrim=duration={dur:.3f},asetpts=PTS-STARTPTS"]
        if c["fadeIn"] > 0:
            a.append(f"afade=t=in:st=0:d={min(c['fadeIn'], dur):.3f}")
        if c["fadeOut"] > 0:
            d = min(c["fadeOut"], dur)
            a.append(f"afade=t=out:st={max(0.0, dur - d):.3f}:d={d:.3f}")
        lines.append(",".join(a) + f"[a{i}]")
        labels.append(f"[v{i}][a{i}]")
    lines.append("".join(labels) + f"concat=n={len(labels)}:v=1:a=1[v][a]")
    return ";\n".join(lines), total


def _cover(out_path, total):
    """A picture from the middle of the result, as JPEG bytes under the cover limit (or None)."""
    for q in (6, 9, 13, 18, 24):
        try:
            res = subprocess.run(
                [ffmpeg_bin(), "-hide_banner", "-nostdin", "-loglevel", "error", "-ss", f"{min(total / 3, max(0.0, total - 1)):.2f}", "-i", str(out_path),
                 "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", str(q), "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
                capture_output=True, timeout=120,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        if res.returncode == 0 and res.stdout and len(res.stdout) < config.MAX_COVER_BYTES:
            return res.stdout
    return None


def _set(vid, **kw):
    with _jobs_lock:
        JOBS.setdefault(vid, {}).update(kw)
        JOBS[vid]["touched"] = time.time()


def _run(vid, user_id, data, size, title_bps, total_hint):
    """Background thread: ffmpeg, then the vod row becomes a ready clip (or disappears if it failed)."""
    con = dbm.connect()
    script = None
    try:
        row = con.execute("SELECT * FROM vods WHERE id = ?", (vid,)).fetchone()
        out_path = vod_path(row)
        paths, audio = [], []
        cache = {}
        for c in data["clips"]:
            src = VOD_REF.match(c["a"]).group(1)
            if src not in cache:
                r = con.execute("SELECT id, mime FROM vods WHERE id = ? AND user_id = ? AND status = 'ready'", (src, user_id)).fetchone()
                p = vod_path(r) if r is not None else None
                if p is None or not p.exists() or p.stat().st_size <= 0:
                    raise RuntimeError("One of the videos in this project is no longer saved.")
                cache[src] = (p, has_audio(p))
            paths.append(cache[src][0])
            audio.append(cache[src][1])
        graph, total = build_filter(data, paths, audio, size)
        _set(vid, total=total)
        fd, script = tempfile.mkstemp(suffix=".txt", prefix="yeli-render-")
        with os.fdopen(fd, "w") as f:
            f.write(graph)

        cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats"]
        for c, p in zip(data["clips"], paths):
            cmd += ["-ss", f"{c['in']:.3f}", "-t", f"{c['out'] - c['in']:.3f}", "-i", str(p)]
        cmd += ["-filter_complex_script", script, "-map", "[v]", "-map", "[a]",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-maxrate", str(title_bps), "-bufsize", str(title_bps * 2),
                "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
                "-fs", str(config.VOD_MAX_BYTES), str(out_path)]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                preexec_fn=(lambda: os.nice(10)) if hasattr(os, "nice") else None)
        _set(vid, proc=proc)
        errors = []
        threading.Thread(target=lambda: errors.extend(proc.stderr.readlines()[-6:]), daemon=True).start()
        for line in proc.stdout:
            if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
                try:
                    secs = int(line.split("=", 1)[1]) / 1_000_000
                except ValueError:
                    continue
                _set(vid, pct=min(99, int(secs * 100 / max(total, 0.1))))
        code = proc.wait()
        if JOBS.get(vid, {}).get("cancel"):
            raise RuntimeError("cancelled")
        if code != 0 or not out_path.exists() or out_path.stat().st_size <= 0:
            tail = "".join(errors).strip().splitlines()
            raise RuntimeError(("ffmpeg: " + tail[-1]) if tail else "The video couldn’t be made.")

        t = int(time.time())
        size_bytes = out_path.stat().st_size
        cover = _cover(out_path, total)
        con.execute("UPDATE vods SET size = ?, chunks = 1, updated_at = ? WHERE id = ?", (size_bytes, t, vid))
        if cover:
            con.execute("UPDATE vods SET cover = ?, cover_ver = ? WHERE id = ?", (cover, t, vid))
        row = con.execute("SELECT * FROM vods WHERE id = ?", (vid,)).fetchone()
        if not _finalize(con, row, t, int(round(total))):
            raise RuntimeError("Nothing was made.")
        try:
            con.commit()
        except Exception:
            pass
        _set(vid, state="done", pct=100)
    except Exception as e:  # noqa: BLE001 - whatever went wrong, the half-made clip must not stay
        cancelled = JOBS.get(vid, {}).get("cancel") or str(e) == "cancelled"
        try:
            row = con.execute("SELECT * FROM vods WHERE id = ?", (vid,)).fetchone()
            if row is not None:
                con.execute("DELETE FROM vods WHERE id = ?", (vid,))
                try:
                    con.commit()
                except Exception:
                    pass
                vod_path(row).unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass
        _set(vid, state="cancelled" if cancelled else "error", error="" if cancelled else str(e)[:300])
    finally:
        if script:
            Path(script).unlink(missing_ok=True)
        try:
            con.close()
        except Exception:  # noqa: BLE001
            pass
        _slots.release()
        with _jobs_lock:                       # forget old finished jobs
            for k in [k for k, j in JOBS.items() if j.get("state") != "running" and time.time() - j.get("touched", 0) > 3600]:
                JOBS.pop(k, None)


@bp.get("/api/render/available")
@login_required
def render_available():
    return jsonify(fast=available())


@bp.post("/api/projects/<pid>/render")
@login_required
def render_start(pid):
    me_row = current_user()
    db = get_db()
    body = request.get_json(silent=True) or {}
    if not available():
        return err("This server can’t render videos.", 501, field="fallback")
    project = get_project(db, me_row["id"], pid)
    if project is None:
        return err("Save your project before exporting it.", 400, field="project")
    data = clean_project(json.loads(project["data"]))
    if data is None or not data["clips"]:
        return err("This project has no clips.", 400, field="project")
    if not eligible(data):
        return err("This edit needs the real-time export.", 409, field="fallback")
    pct = project_live_pct(db, me_row["id"], data)
    if pct < config.EDIT_MIN_LIVE_PCT:
        return err(f"At least {config.EDIT_MIN_LIVE_PCT}% of your video has to be footage from your live streams. Right now it is {pct}%.",
                   400, field="live", live_pct=pct, min_live=config.EDIT_MIN_LIVE_PCT)
    saved = db.execute("SELECT COUNT(*) AS n FROM vods WHERE user_id = ? AND status = 'ready'", (me_row["id"],)).fetchone()["n"]
    if saved >= config.VOD_MAX_PER_USER:
        return err(f"You have {saved} saved clips and videos, which is the limit. Delete one to save this one.", 409, limit=True)
    for j in JOBS.values():                      # one at a time per person
        if j.get("user_id") == me_row["id"] and j.get("state") == "running":
            return err("You already have an export running.", 503, field="fallback")
    if not _slots.acquire(blocking=False):
        return err("The server is busy making other videos.", 503, field="fallback")

    try:
        short = int(body.get("short") or 720)
        short = short if short in MAX_QUALITY_BPS else 720
        size = frame_size(data["aspect"], short)
        title = text_field(body, "title", config.VOD_TITLE_MAX) or "Edited video"
        total = timeline_seconds(data)
        # a long video has to fit in the size limit of one video: lower the bitrate instead of failing at the end
        fit_bps = int(config.VOD_MAX_BYTES * 0.9 * 8 / max(total, 1)) - 128_000
        video_bps = max(250_000, min(MAX_QUALITY_BPS[short], fit_bps))
        for old in db.execute("SELECT * FROM vods WHERE user_id = ? AND status = 'recording' AND source = 'edit'", (me_row["id"],)).fetchall():
            if old["id"] not in JOBS:
                _finalize(db, old, old["updated_at"])  # an export that was abandoned
        Path(config.VOD_DIR).mkdir(parents=True, exist_ok=True)
        vid = secrets.token_hex(8)
        t = now()
        db.execute(
            """INSERT INTO vods (id, user_id, title, category, mime, status, started_at, updated_at, visibility, source, live_pct, project_id, aspect)
               VALUES (?,?,?,'Other','video/mp4','recording',?,?,'private','edit',?,?,?)""",
            (vid, me_row["id"], title, t, t, pct, project["id"], data["aspect"]),
        )
        db.commit()
        vod_path(db.execute("SELECT id, mime FROM vods WHERE id = ?", (vid,)).fetchone()).touch()
    except Exception:
        _slots.release()
        raise
    _set(vid, state="running", pct=0, user_id=me_row["id"], error="", cancel=False)
    threading.Thread(target=_run, args=(vid, me_row["id"], data, size, video_bps, total), daemon=True, name=f"yeli-render-{vid}").start()
    return jsonify(ok=True, id=vid, size=list(size))


def _job(vid):
    me_row = current_user()
    job = JOBS.get(vid)
    if job is None or job.get("user_id") != me_row["id"]:
        return None
    return job


@bp.get("/api/render/<vid>")
@login_required
def render_status(vid):
    job = _job(vid)
    if job is None:
        return err("Not found.", 404)
    return jsonify(state=job["state"], pct=job.get("pct", 0), error=job.get("error", ""))


@bp.post("/api/render/<vid>/cancel")
@login_required
def render_cancel(vid):
    job = _job(vid)
    if job is None:
        return err("Not found.", 404)
    if job["state"] == "running":
        _set(vid, cancel=True)
        proc = job.get("proc")
        if proc is not None:
            try:
                proc.terminate()
            except OSError:
                pass
    return jsonify(ok=True)
