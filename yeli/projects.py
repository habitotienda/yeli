"""Video editor projects (drafts): save the work, continue later, and measure how much of it is live footage.

A project is only the list of cuts (which clip, from where to where, speed, filters, texts...). The video itself is
made when you export, so a project is small and can be opened from any device.

  GET  /api/me/projects          my projects, newest first (without the cuts)
  GET  /api/projects/<id>        one project with its cuts
  POST /api/projects             create (no id) or save (with id) a project
  POST /api/projects/<id>/delete

The 70% rule: an edited video must be made of at least EDIT_MIN_LIVE_PCT % footage from the streamer's own live
streams (clips that came from a live count in full; an earlier edit counts for its own live share; videos from the
device, which are not saved in a project, count as zero). The server measures it from the saved project when the
export starts (see vods.vod_new), so the browser can't just say "100%".
"""
import json
import re
import secrets

from flask import Blueprint, jsonify, request

from . import config
from .core import *
from .db import get_db

bp = Blueprint("projects", __name__)

PROJECT_ID = re.compile(r"^[a-f0-9]{16}$")
VOD_REF = re.compile(r"^vod:([a-f0-9]{16})$")
ASPECTS = ("16:9", "9:16", "1:1", "4:5")
FILTERS = ("none", "bw", "sepia", "vivid", "warm", "cool", "cinema", "blur", "fade", "noir", "dream", "retro")
FONTS = ("Fredoka", "Arial", "Georgia", "Impact", "Courier New")
ANIMS = ("none", "fade", "pop", "slide")
BACKGROUNDS = ("black", "blur", "white", "color")
POSITIONS = ("top", "middle", "bottom")
CORNERS = ("tl", "tr", "bl", "br")
MAX_CLIPS, MAX_TEXTS = 200, 100


def _num(v, lo, hi, default):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return default
    if n != n or n in (float("inf"), float("-inf")):  # NaN or infinity
        return default
    return min(hi, max(lo, n))


def _enum(v, options, default):
    return v if v in options else default


def _str(v, n):
    return v.strip()[:n] if isinstance(v, str) else ""


def _color(v, default="#ffffff"):
    return v if isinstance(v, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", v) else default


def clean_project(data):
    """Keeps only what the editor understands, with every number inside its range. Returns None when it isn't a project."""
    if not isinstance(data, dict) or not isinstance(data.get("clips"), list):
        return None
    clips = []
    for c in data["clips"][:MAX_CLIPS]:
        if not isinstance(c, dict) or not isinstance(c.get("a"), str):
            continue
        a = c["a"][:160]
        if not (VOD_REF.match(a) or a.startswith("file:")):
            continue
        speed = _num(c.get("speed"), 0.25, 4, 1)
        cin = _num(c.get("in"), 0, 86400, 0)
        cout = _num(c.get("out"), 0, 86400, 0)
        if cout - cin < 0.05:
            continue
        clips.append({
            "uid": _str(c.get("uid"), 24), "a": a, "name": _str(c.get("name"), 80), "in": cin, "out": cout, "speed": speed,
            "volume": _num(c.get("volume"), 0, 2, 1), "filter": _enum(c.get("filter"), FILTERS, "none"),
            "fadeIn": _num(c.get("fadeIn"), 0, 5, 0), "fadeOut": _num(c.get("fadeOut"), 0, 5, 0),
            "fit": _enum(c.get("fit"), ("fit", "fill"), "fit"),
            "rot": int(_num(c.get("rot"), 0, 3, 0)), "flipH": bool(c.get("flipH")), "flipV": bool(c.get("flipV")),
            "zoom": _num(c.get("zoom"), 1, 4, 1), "px": _num(c.get("px"), -1, 1, 0), "py": _num(c.get("py"), -1, 1, 0),
            "bright": _num(c.get("bright"), -100, 100, 0), "contrast": _num(c.get("contrast"), -100, 100, 0),
            "sat": _num(c.get("sat"), -100, 100, 0), "blur": _num(c.get("blur"), 0, 20, 0),
            "opacity": _num(c.get("opacity"), 0, 1, 1),
        })
    texts = []
    for t in (data.get("texts") if isinstance(data.get("texts"), list) else [])[:MAX_TEXTS]:
        if not isinstance(t, dict):
            continue
        texts.append({
            "uid": _str(t.get("uid"), 24), "kind": _enum(t.get("kind"), ("text", "sticker"), "text"), "text": _str(t.get("text"), 120) or " ",
            "start": _num(t.get("start"), 0, 86400, 0), "dur": _num(t.get("dur"), 0.1, 86400, 3), "size": _num(t.get("size"), 2, 60, 7),
            "color": _color(t.get("color")), "bg": bool(t.get("bg")), "pos": _enum(t.get("pos"), POSITIONS, "bottom"),
            "font": _enum(t.get("font"), FONTS, "Fredoka"), "bold": t.get("bold") is not False, "italic": bool(t.get("italic")),
            "outline": t.get("outline") is not False, "shadow": bool(t.get("shadow")), "anim": _enum(t.get("anim"), ANIMS, "none"),
            "x": _num(t.get("x"), 0, 100, 50), "y": _num(t.get("y"), 0, 100, 88), "rot": _num(t.get("rot"), -180, 180, 0),
            "opacity": _num(t.get("opacity"), 0, 1, 1),
        })
    wm = data.get("watermark") if isinstance(data.get("watermark"), dict) else {}
    return {
        "aspect": _enum(data.get("aspect"), ASPECTS, "16:9"), "clips": clips, "texts": texts,
        "bg": _enum(data.get("bg"), BACKGROUNDS, "black"), "bgColor": _color(data.get("bgColor"), "#000000"),
        "watermark": {"on": bool(wm.get("on")), "text": _str(wm.get("text"), 40), "pos": _enum(wm.get("pos"), CORNERS, "br")},
    }


def timeline_seconds(data):
    return sum((c["out"] - c["in"]) / c["speed"] for c in data["clips"])


def live_stats(db, user_id, data):
    """(live seconds, total seconds) of a cleaned project. Only the owner's own saved videos can count as live."""
    ids = {m.group(1) for c in data["clips"] if (m := VOD_REF.match(c["a"]))}
    rows = {}
    if ids:
        marks = ",".join("?" * len(ids))
        for r in db.execute(
            f"SELECT id, source, live_pct, duration FROM vods WHERE user_id = ? AND status = 'ready' AND id IN ({marks})", (user_id, *ids)
        ).fetchall():
            rows[r["id"]] = r
    live = total = 0.0
    for c in data["clips"]:
        length = (c["out"] - c["in"]) / c["speed"]
        total += length
        m = VOD_REF.match(c["a"])
        row = rows.get(m.group(1)) if m else None
        if row is None:
            continue
        if row["duration"] > 0 and c["in"] >= row["duration"] + 1:
            continue  # cuts that start after the end of the video are not footage
        if row["source"] == "live":
            share = 1.0
        elif row["source"] == "edit" and row["live_pct"] >= 0:
            share = row["live_pct"] / 100
        else:
            share = 0.0
        live += length * share
    return live, total


def live_pct(db, user_id, data):
    live, total = live_stats(db, user_id, data)
    return int(live * 100 / total + 1e-9) if total > 0 else 0


def _meta(r):
    return {
        "id": r["id"], "title": r["title"], "duration": r["duration"], "live_pct": r["live_pct"], "clips": r["clips"],
        "cover_vod": r["cover_vod"], "updated_at": r["updated_at"], "created_at": r["created_at"],
    }


def get_project(db, user_id, pid):
    if not PROJECT_ID.match(pid or ""):
        return None
    return db.execute("SELECT * FROM edit_projects WHERE id = ? AND user_id = ?", (pid, user_id)).fetchone()


@bp.get("/api/me/projects")
@login_required
def my_projects():
    me_row = current_user()
    rows = get_db().execute("SELECT * FROM edit_projects WHERE user_id = ? ORDER BY updated_at DESC", (me_row["id"],)).fetchall()
    return jsonify(projects=[_meta(r) for r in rows], limit=config.EDIT_MAX_PROJECTS, min_live=config.EDIT_MIN_LIVE_PCT)


@bp.get("/api/projects/<pid>")
@login_required
def project_get(pid):
    me_row = current_user()
    row = get_project(get_db(), me_row["id"], pid)
    if row is None:
        return err("Project not found.", 404)
    return jsonify(project=_meta(row), data=json.loads(row["data"]), min_live=config.EDIT_MIN_LIVE_PCT)


@bp.post("/api/projects")
@login_required
def project_save():
    me_row = current_user()
    db = get_db()
    body = request.get_json(silent=True) or {}
    data = clean_project(body.get("data"))
    if data is None:
        return err("That project isn't valid.")
    raw = json.dumps(data, separators=(",", ":"))
    if len(raw) > config.EDIT_PROJECT_MAX_BYTES:
        return err("This project is too big to save. Remove some clips or texts.", 413)
    title = text_field(body, "title", config.VOD_TITLE_MAX) or "Untitled project"
    duration = timeline_seconds(data)
    pct = live_pct(db, me_row["id"], data)
    first = next((m.group(1) for c in data["clips"] if (m := VOD_REF.match(c["a"]))), "")
    t = now()
    pid = body.get("id")
    if pid:
        if get_project(db, me_row["id"], pid) is None:
            return err("Project not found.", 404)
        db.execute(
            "UPDATE edit_projects SET title = ?, data = ?, duration = ?, live_pct = ?, clips = ?, cover_vod = ?, updated_at = ? WHERE id = ?",
            (title, raw, duration, pct, len(data["clips"]), first, t, pid),
        )
    else:
        have = db.execute("SELECT COUNT(*) AS n FROM edit_projects WHERE user_id = ?", (me_row["id"],)).fetchone()["n"]
        if have >= config.EDIT_MAX_PROJECTS:
            return err(f"You have {have} saved projects, which is the limit. Delete one to save a new one.", 409, limit=True)
        pid = secrets.token_hex(8)
        db.execute(
            "INSERT INTO edit_projects (id, user_id, title, data, duration, live_pct, clips, cover_vod, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (pid, me_row["id"], title, raw, duration, pct, len(data["clips"]), first, t, t),
        )
    db.commit()
    return jsonify(ok=True, project=_meta(get_project(db, me_row["id"], pid)), min_live=config.EDIT_MIN_LIVE_PCT)


@bp.post("/api/projects/<pid>/delete")
@login_required
def project_delete(pid):
    me_row = current_user()
    db = get_db()
    if get_project(db, me_row["id"], pid) is None:
        return err("Project not found.", 404)
    db.execute("DELETE FROM edit_projects WHERE id = ?", (pid,))
    db.commit()
    return jsonify(ok=True)
