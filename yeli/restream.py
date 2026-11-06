"""Send the stream to other platforms at the same time (Kick, TikTok, Twitch, YouTube, Facebook, any RTMP server).

How it works: the studio publishes to the media server (MediaMTX) as always. For every destination the streamer has switched
on, this server starts one ffmpeg that reads that stream from the media server over RTSP and pushes it to the platform over RTMP.
Because the studio already mixes everything into one picture and one soundtrack, whatever is in it goes out too: the
chat overlay, the alerts, the bot's messages and the bot's voice.

It needs: the media-server mode (not peer-to-peer, where there is no server-side video), `ffmpeg` on this server and
`YELI_MEDIA_RTSP` pointing at MediaMTX's RTSP address (see the README). Without them everything else keeps working.

Stream keys are secrets: they are stored in the database (they have to be, ffmpeg needs them), never sent back to the
browser, and removed from any error text.
"""
import re
import shutil
import sqlite3
import subprocess
import threading
import time
from collections import deque

from flask import Blueprint, jsonify, request

from . import config
from .core import *
from .db import get_db

bp = Blueprint("restream", __name__)

MAX_DESTINATIONS = 6
MAX_FAILS = 6          # consecutive failures before giving up (until the streamer changes something or goes live again)
STALE_AFTER = 45       # seconds without a heartbeat from the studio: the stream is over

PLATFORMS = {
    "kick": {"label": "Kick", "url": ""},
    "tiktok": {"label": "TikTok", "url": ""},
    "twitch": {"label": "Twitch", "url": "rtmp://live.twitch.tv/app"},
    "youtube": {"label": "YouTube", "url": "rtmp://a.rtmp.youtube.com/live2"},
    "facebook": {"label": "Facebook", "url": "rtmps://live-api-s.facebook.com:443/rtmp/"},
    "custom": {"label": "Other (RTMP)", "url": ""},
}
FORMATS = ("original", "vertical")

URL_RE = re.compile(r"^rtmps?://[A-Za-z0-9.-]{1,253}(:[0-9]{2,5})?(/[A-Za-z0-9._~%+/=-]*)?$")
KEY_RE = re.compile(r"^[^\s\"'`\\$;|<>(){}\x00-\x1f]{1,400}$")  # one argument to ffmpeg, never a shell, but keep it plain anyway


def ffmpeg_bin():
    return config.FFMPEG_BIN or shutil.which("ffmpeg")


def available():
    """(True, '') when this server can send streams out, else (False, why)."""
    if not config.MEDIA_URL:
        return False, "media_server"
    if not config.MEDIA_RTSP:
        return False, "rtsp"
    if not ffmpeg_bin():
        return False, "ffmpeg"
    return True, ""


def input_args(path):
    return ["-rtsp_transport", "tcp", "-i", f"{config.MEDIA_RTSP}/{path}"]


def build_command(path, dest):
    """The ffmpeg command line for one destination (a list: no shell is involved)."""
    cmd = [ffmpeg_bin(), "-hide_banner", "-loglevel", "warning", "-nostdin", *input_args(path), "-map", "0:v:0?", "-map", "0:a:0?"]
    vertical = dest["fmt"] == "vertical"
    if vertical:
        cmd += ["-vf", "crop='min(iw,ih*9/16)':ih,scale=720:1280"]
    # The studio's stream is VP8 or H.264 and Opus; platforms want H.264 and AAC, so re-encode (reliable, costs some CPU).
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-pix_fmt", "yuv420p",
            "-b:v", "2500k" if vertical else "3500k", "-maxrate", "2500k" if vertical else "3500k",
            "-bufsize", "5000k" if vertical else "7000k", "-g", "60", "-keyint_min", "60",
            "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
            "-f", "flv", dest["url"].rstrip("/") + "/" + dest["stream_key"]]
    return cmd


class Job:
    def __init__(self, dest, path):
        self.dest_id = dest["id"]
        self.user_id = dest["user_id"]
        self.sig = (dest["url"], dest["stream_key"], dest["fmt"])
        self.path = path
        self.key = dest["stream_key"]
        self.status = "starting"   # starting, live, retrying, error
        self.error = ""
        self.fails = 0
        self.stop = threading.Event()
        self.proc = None
        self.dest = dict(dest)
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _clean(self, line):
        return line.replace(self.key, "***").replace(self.dest["url"], "<server>")[:200]

    def _run(self):
        backoff = 3
        while not self.stop.is_set():
            self.status = "starting"
            tail = deque(maxlen=4)
            try:
                self.proc = subprocess.Popen(build_command(self.path, self.dest), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                             stderr=subprocess.PIPE, text=True, errors="replace")
            except OSError as e:
                self.status, self.error = "error", self._clean(str(e))
                return
            started = time.monotonic()
            threading.Thread(target=self._collect, args=(self.proc, tail), daemon=True).start()
            while self.proc.poll() is None and not self.stop.is_set():
                if self.status == "starting" and time.monotonic() - started > 4:
                    self.status, self.error = "live", ""
                self.stop.wait(0.4)
            if self.stop.is_set():
                self._kill()
                return
            time.sleep(0.2)  # let the reader collect the last lines
            self.error = self._clean(tail[-1]) if tail else f"ffmpeg stopped (code {self.proc.returncode})"
            if time.monotonic() - started > 60:
                backoff, self.fails = 3, 0
            self.fails += 1
            if self.fails >= MAX_FAILS:
                self.status = "error"
                return
            self.status = "retrying"
            self.stop.wait(backoff)
            backoff = min(backoff * 2, 30)

    @staticmethod
    def _collect(proc, tail):
        """Keep the last lines ffmpeg wrote, for the error shown to the streamer."""
        try:
            for line in proc.stderr:
                if line.strip():
                    tail.append(line.strip())
        except (ValueError, OSError):
            pass
        finally:
            try:
                proc.stderr.close()
            except OSError:
                pass

    def _kill(self):
        p = self.proc
        if p and p.poll() is None:
            p.terminate()
            try:
                p.wait(timeout=4)
            except subprocess.TimeoutExpired:
                p.kill()

    def halt(self):
        self.stop.set()
        self._kill()


_lock = threading.RLock()
_jobs = {}  # destination id -> Job
_watchdog = None


def _stop_job(dest_id):
    job = _jobs.pop(dest_id, None)
    if job:
        job.halt()


def stop_all(uid=None):
    with _lock:
        for did in [i for i, j in _jobs.items() if uid is None or j.user_id == uid]:
            _stop_job(did)


def sync(db, uid):
    """Make the running ffmpeg processes match the streamer's destinations and whether they are live from the media server."""
    row = db.execute("SELECT is_live, mode FROM streams WHERE user_id = ?", (uid,)).fetchone()
    live = bool(row and row["is_live"] and row["mode"] == "sfu")
    ok, _ = available()
    dests = db.execute("SELECT * FROM destinations WHERE user_id = ? AND enabled = 1", (uid,)).fetchall() if live and ok else []
    path = db.execute("SELECT username FROM users WHERE id = ?", (uid,)).fetchone()["username"].lower()
    with _lock:
        wanted = {d["id"]: d for d in dests}
        for did in [i for i, j in _jobs.items() if j.user_id == uid and i not in wanted]:
            _stop_job(did)
        for did, d in wanted.items():
            job = _jobs.get(did)
            if job is not None and job.sig != (d["url"], d["stream_key"], d["fmt"]):
                _stop_job(did)
                job = None
            if job is None:
                job = _jobs[did] = Job(d, path)
                job.thread.start()
        if _jobs:
            _start_watchdog()


def _start_watchdog():
    global _watchdog
    if _watchdog is None or not _watchdog.is_alive():
        _watchdog = threading.Thread(target=_watch, daemon=True)
        _watchdog.start()


def _watch():
    """Stops the destinations of a stream that is over, even if the studio closed without saying goodbye."""
    while True:
        time.sleep(10)
        with _lock:
            users = {j.user_id for j in _jobs.values()}
        if not users:
            return
        try:
            con = sqlite3.connect(config.DB_PATH, timeout=15)
            con.row_factory = sqlite3.Row
            for uid in users:
                row = con.execute("SELECT is_live, last_seen FROM streams WHERE user_id = ?", (uid,)).fetchone()
                if row is None or not row["is_live"] or (row["last_seen"] or 0) < now() - STALE_AFTER:
                    stop_all(uid)
            con.close()
        except sqlite3.Error:
            pass


def status_of(dest_id):
    job = _jobs.get(dest_id)
    if job is None:
        return "off", ""
    return job.status, job.error


def mask(key):
    return "\u2022\u2022\u2022\u2022" + key[-4:] if len(key) > 8 else "\u2022\u2022\u2022\u2022"


def dest_json(d):
    status, error = status_of(d["id"])
    return {"id": d["id"], "platform": d["platform"], "name": d["name"], "url": d["url"], "key_hint": mask(d["stream_key"]),
            "enabled": bool(d["enabled"]), "fmt": d["fmt"], "status": status, "error": error}


def validate(data, current=None):
    """Clean the fields of a destination: returns (values, error)."""
    out = {}
    cur = current or {}
    platform = data.get("platform", cur.get("platform"))
    if platform not in PLATFORMS:
        return None, "Choose a platform."
    out["platform"] = platform
    out["name"] = text_field(data, "name", 40) if "name" in data else cur.get("name", "")
    url = (data.get("url") if "url" in data else cur.get("url")) or ""
    url = url.strip()
    if not URL_RE.match(url):
        return None, "Enter the server address, it starts with rtmp:// or rtmps://."
    out["url"] = url
    key = data.get("key")
    if key is None or key == "":
        key = cur.get("stream_key", "")
    key = key.strip() if isinstance(key, str) else ""
    if not key:
        return None, "Paste the stream key."
    if not KEY_RE.match(key):
        return None, "That stream key has characters it can't have. Copy it again from the platform."
    out["stream_key"] = key
    fmt = data.get("fmt", cur.get("fmt", "original"))
    if fmt not in FORMATS:
        return None, "Unknown format."
    out["fmt"] = fmt
    out["enabled"] = 1 if data.get("enabled", cur.get("enabled", 1)) else 0
    return out, None


@bp.get("/api/restream")
@login_required
def restream_state():
    uid = current_user()["id"]
    db = get_db()
    ok, why = available()
    stream = db.execute("SELECT is_live, mode FROM streams WHERE user_id = ?", (uid,)).fetchone()
    rows = db.execute("SELECT * FROM destinations WHERE user_id = ? ORDER BY id", (uid,)).fetchall()
    return jsonify(available=ok, why=why, live=bool(stream and stream["is_live"]), mode=stream["mode"] if stream else "",
                   destinations=[dest_json(r) for r in rows], max=MAX_DESTINATIONS,
                   platforms=[{"id": k, "label": v["label"], "url": v["url"]} for k, v in PLATFORMS.items()])


@bp.post("/api/restream")
@login_required
def restream_add():
    uid = current_user()["id"]
    db = get_db()
    if db.execute("SELECT COUNT(*) AS n FROM destinations WHERE user_id = ?", (uid,)).fetchone()["n"] >= MAX_DESTINATIONS:
        return err(f"You can add up to {MAX_DESTINATIONS} platforms.")
    vals, problem = validate(request.get_json(silent=True) or {})
    if problem:
        return err(problem)
    cur = db.execute("INSERT INTO destinations (user_id, platform, name, url, stream_key, enabled, fmt, created_at) VALUES (?,?,?,?,?,?,?,?)",
                     (uid, vals["platform"], vals["name"], vals["url"], vals["stream_key"], vals["enabled"], vals["fmt"], now()))
    db.commit()
    sync(db, uid)
    row = db.execute("SELECT * FROM destinations WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(destination=dest_json(row)), 201


@bp.post("/api/restream/<int:did>")
@login_required
def restream_update(did):
    uid = current_user()["id"]
    db = get_db()
    row = db.execute("SELECT * FROM destinations WHERE id = ? AND user_id = ?", (did, uid)).fetchone()
    if row is None:
        return err("Platform not found.", 404)
    vals, problem = validate(request.get_json(silent=True) or {}, dict(row))
    if problem:
        return err(problem)
    db.execute("UPDATE destinations SET platform = ?, name = ?, url = ?, stream_key = ?, enabled = ?, fmt = ? WHERE id = ?",
               (vals["platform"], vals["name"], vals["url"], vals["stream_key"], vals["enabled"], vals["fmt"], did))
    db.commit()
    sync(db, uid)
    return jsonify(destination=dest_json(db.execute("SELECT * FROM destinations WHERE id = ?", (did,)).fetchone()))


@bp.post("/api/restream/<int:did>/delete")
@login_required
def restream_delete(did):
    uid = current_user()["id"]
    db = get_db()
    if db.execute("DELETE FROM destinations WHERE id = ? AND user_id = ?", (did, uid)).rowcount == 0:
        return err("Platform not found.", 404)
    db.commit()
    with _lock:
        _stop_job(did)
    return jsonify(ok=True)
