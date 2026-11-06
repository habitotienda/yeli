"""Editor drafts ("projects"): pause an edit, come back later and carry on.

A project stores the editor's timeline as JSON (the same shape the editor already uses for undo: clips, texts, aspect),
plus the publication details typed so far (title, description, category, who can watch) and an optional custom cover.
The video files are NOT copied: a clip points to a saved video of the owner as "vod:<id>", or to a file from the
device as "file:<name>:<size>:<lastModified>" (those can't be restored by the server: the editor asks for the file again).

Routes (all need an account and only ever touch the caller's own projects)
  GET  /api/me/projects                  list, newest first (no timelines, no image bytes)
  POST /api/projects                     create (optionally with a first state)
  GET  /api/projects/<id>                one project with its timeline and the sources that no longer exist
  POST /api/projects/<id>/save           save the timeline and/or the details; `rev` says which version you started from
  POST /api/projects/<id>/cover          set the custom cover (JPEG data URL, same limits as a video cover)
  POST /api/projects/<id>/cover/delete   go back to the automatic cover
  GET  /api/projects/<id>/cover          the cover image
  POST /api/projects/<id>/delete         delete the draft (an exported clip is not touched)

Concurrency: every save must carry the `rev` it was based on. If another tab saved in between, the answer is 409 with
the current `rev` and nothing is written, so autosave from two tabs can't silently overwrite each other.
"""
import json
import math
import re
import secrets

from flask import Blueprint, Response, jsonify, request

from . import config
from .core import *
from .db import get_db

bp = Blueprint("projects", __name__)

STATE_VERSION = 1
PROJECT_ID = re.compile(r"^[a-f0-9]{16}$")
ASSET_RE = re.compile(r"^(vod:[a-f0-9]{16}|file:.{1,200})$", re.S)
UID_RE = re.compile(r"^[A-Za-z0-9_-]{1,24}$")
FILTER_RE = re.compile(r"^[a-z0-9_-]{1,24}$")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
EXTRA_KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,31}$")
ASPECTS = ("16:9", "9:16", "1:1")
FITS = ("fit", "fill")
TEXT_POSITIONS = ("top", "middle", "bottom")
VISIBILITIES = ("public", "followers", "private")
COVER_SOURCES = ("upload", "frame")
MAX_SECONDS = 24 * 3600
MAX_EXTRA_KEYS = 24

PROJECT_SELECT = """
SELECT p.id, p.user_id, p.name, p.rev, p.aspect, p.clip_count, p.total_seconds, p.live_seconds, p.title, p.description,
       p.category, p.visibility, p.status, p.vod_id, p.state_version, p.created_at, p.updated_at,
       c.updated_at AS cover_ver, c.source AS cover_source
FROM edit_projects p LEFT JOIN edit_project_covers c ON c.project_id = p.id
"""


# --------------------------------------------------------------------------
# The timeline: validate it, keep it small, and derive what the server needs from it
# --------------------------------------------------------------------------
class StateError(ValueError):
    pass


class ForeignSource(StateError):
    """The timeline uses a video that belongs to someone else."""


def _num(value, lo, hi, what):
    """A finite number inside [lo, hi], rounded to 3 decimals. Booleans are not numbers here."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise StateError(f"{what} must be a number.")
    if value < lo or value > hi:
        raise StateError(f"{what} is out of range.")
    return round(float(value), 3)


def _extras(src, known):
    """Fields the server doesn't know about are kept if they are small scalars. This is what lets the editor get new
    tools without a database change; anything nested or large is dropped."""
    out = {}
    for key, value in src.items():
        if key in known or not EXTRA_KEY_RE.match(key):
            continue
        if isinstance(value, bool) or value is None:
            out[key] = value
        elif isinstance(value, (int, float)) and math.isfinite(value):
            out[key] = round(float(value), 4) if isinstance(value, float) else value
        elif isinstance(value, str) and len(value) <= 200:
            out[key] = value
        if len(out) >= MAX_EXTRA_KEYS:
            break
    return out


CLIP_KNOWN = {"uid", "asset", "in", "out", "speed", "volume", "filter", "fadeIn", "fadeOut", "fit"}
TEXT_KNOWN = {"uid", "text", "start", "dur", "size", "color", "bg", "pos"}


def _clean_clip(c):
    if not isinstance(c, dict):
        raise StateError("Every clip must be an object.")
    uid, asset = c.get("uid"), c.get("asset")
    if not isinstance(uid, str) or not UID_RE.match(uid):
        raise StateError("A clip has an invalid id.")
    if not isinstance(asset, str) or not ASSET_RE.match(asset):
        raise StateError("A clip points to an unknown video.")
    start = _num(c.get("in"), 0, MAX_SECONDS, "Clip start")
    end = _num(c.get("out"), 0, MAX_SECONDS, "Clip end")
    if end - start < 0.05:
        raise StateError("A clip is too short.")
    fit = c.get("fit", "fit")
    flt = c.get("filter", "none")
    if fit not in FITS:
        raise StateError("Unknown framing.")
    if not isinstance(flt, str) or not FILTER_RE.match(flt):
        raise StateError("Unknown filter.")
    return {
        "uid": uid, "asset": asset, "in": start, "out": end,
        "speed": _num(c.get("speed", 1), 0.25, 4, "Speed"),
        "volume": _num(c.get("volume", 1), 0, 4, "Volume"),
        "filter": flt,
        "fadeIn": _num(c.get("fadeIn", 0), 0, 30, "Fade in"),
        "fadeOut": _num(c.get("fadeOut", 0), 0, 30, "Fade out"),
        "fit": fit,
        **_extras(c, CLIP_KNOWN),
    }


def _clean_text(t):
    if not isinstance(t, dict):
        raise StateError("Every text must be an object.")
    uid, text = t.get("uid"), t.get("text", "")
    if not isinstance(uid, str) or not UID_RE.match(uid):
        raise StateError("A text has an invalid id.")
    if not isinstance(text, str):
        raise StateError("A text must be a string.")
    color, pos = t.get("color", "#ffffff"), t.get("pos", "bottom")
    if not isinstance(color, str) or not COLOR_RE.match(color):
        raise StateError("A text has an invalid color.")
    if pos not in TEXT_POSITIONS:
        raise StateError("A text has an invalid position.")
    return {
        "uid": uid, "text": text[:300],
        "start": _num(t.get("start", 0), 0, MAX_SECONDS, "Text start"),
        "dur": _num(t.get("dur", 3), 0.05, MAX_SECONDS, "Text length"),
        "size": _num(t.get("size", 7), 1, 50, "Text size"),
        "color": color.lower(), "bg": bool(t.get("bg", False)), "pos": pos,
        **_extras(t, TEXT_KNOWN),
    }


def clean_state(data):
    """The timeline in its canonical form (raises StateError). Unknown top-level keys are dropped; the rest of the
    editor's evolution goes through the per-clip / per-text extras."""
    if not isinstance(data, dict):
        raise StateError("The project must be an object.")
    aspect = data.get("aspect", "16:9")
    if aspect not in ASPECTS:
        raise StateError("Unknown video format.")
    clips, texts = data.get("clips", []), data.get("texts", [])
    if not isinstance(clips, list) or not isinstance(texts, list):
        raise StateError("Clips and texts must be lists.")
    if len(clips) > config.PROJECT_MAX_CLIPS:
        raise StateError(f"A project can have up to {config.PROJECT_MAX_CLIPS} clips.")
    if len(texts) > config.PROJECT_MAX_TEXTS:
        raise StateError(f"A project can have up to {config.PROJECT_MAX_TEXTS} texts.")
    state = {"v": STATE_VERSION, "aspect": aspect, "clips": [_clean_clip(c) for c in clips], "texts": [_clean_text(t) for t in texts]}
    if len(json.dumps(state, separators=(",", ":"))) > config.PROJECT_STATE_MAX:
        raise StateError("This project is too big to save.")
    return state


def timeline_stats(state):
    """(timeline seconds per saved video, timeline seconds from device files). A clip lasts (out - in) / speed."""
    per_vod, local = {}, 0.0
    for c in state["clips"]:
        secs = (c["out"] - c["in"]) / c["speed"]
        if c["asset"].startswith("vod:"):
            per_vod[c["asset"][4:]] = per_vod.get(c["asset"][4:], 0.0) + secs
        else:
            local += secs
    return per_vod, local


def _check_sources(db, me_id, per_vod):
    """Another person's video can't be put in my timeline. Ids that don't exist (deleted meanwhile) are allowed: the
    draft reports them as missing when it is opened. Returns the seconds that come from recorded streams."""
    live = 0.0
    if per_vod:
        marks = ",".join("?" * len(per_vod))
        for r in db.execute(f"SELECT id, user_id, source FROM vods WHERE id IN ({marks})", list(per_vod)).fetchall():
            if r["user_id"] != me_id:
                raise ForeignSource("You can only edit your own videos.")
            if r["source"] == "live":
                live += per_vod[r["id"]]
    return live


def _write_sources(db, pid, per_vod):
    db.execute("DELETE FROM edit_project_sources WHERE project_id = ?", (pid,))
    db.executemany("INSERT INTO edit_project_sources (project_id, vod_id, seconds) VALUES (?,?,?)",
                   [(pid, vid, round(secs, 3)) for vid, secs in per_vod.items()])


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def project_json(row, state=None, missing=None):
    total = row["total_seconds"]
    out = {
        "id": row["id"],
        "name": row["name"],
        "rev": row["rev"],
        "aspect": row["aspect"],
        "clip_count": row["clip_count"],
        "duration": round(total, 1),
        "live_seconds": round(row["live_seconds"], 1),
        "live_ratio": round(row["live_seconds"] / total, 3) if total > 0 else 0,
        "title": row["title"],
        "description": row["description"],
        "category": row["category"],
        "visibility": row["visibility"],
        "status": row["status"],
        "vod_id": row["vod_id"],
        "cover": row["cover_ver"],              # None = no custom cover; else a version number for cache busting
        "cover_source": row["cover_source"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
    if state is not None:
        out["state"] = state
        out["missing_sources"] = missing or []
    return out


def _mine(db, pid, me_row):
    if not PROJECT_ID.match(pid or ""):
        return None
    row = db.execute(f"{PROJECT_SELECT} WHERE p.id = ?", (pid,)).fetchone()
    return row if row is not None and row["user_id"] == me_row["id"] else None


def _fields(data):
    """The publication details present in `data`, validated: {column: value}. Nothing here is required to save a draft;
    what a video needs in order to be published is checked at publish time."""
    out = {}
    if "name" in data:
        out["name"] = text_field(data, "name", config.PROJECT_NAME_MAX)
        if not out["name"]:
            raise StateError("Give your project a name.")
    if "title" in data:
        out["title"] = text_field(data, "title", config.VOD_TITLE_MAX)
    if "description" in data:
        out["description"] = text_field(data, "description", config.VOD_DESC_MAX)
    if "category" in data:
        if data["category"] not in config.CATEGORIES:
            raise StateError("Unknown category.")
        out["category"] = data["category"]
    if "visibility" in data:
        if data["visibility"] not in VISIBILITIES:
            raise StateError("Unknown privacy option.")
        out["visibility"] = data["visibility"]
    return out


def _state_columns(db, me_id, pid, state):
    """The columns derived from a timeline; also refreshes the sources table. Raises StateError."""
    per_vod, local = timeline_stats(state)
    live = _check_sources(db, me_id, per_vod)
    _write_sources(db, pid, per_vod)
    return {
        "state": json.dumps(state, separators=(",", ":")),
        "state_version": STATE_VERSION,
        "aspect": state["aspect"],
        "clip_count": len(state["clips"]),
        "total_seconds": round(sum(per_vod.values()) + local, 3),
        "live_seconds": round(live, 3),
    }


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------
@bp.get("/api/me/projects")
@login_required
def my_projects():
    me_row = current_user()
    rows = get_db().execute(
        f"{PROJECT_SELECT} WHERE p.user_id = ? ORDER BY p.updated_at DESC, p.created_at DESC LIMIT 100", (me_row["id"],)
    ).fetchall()
    return jsonify(projects=[project_json(r) for r in rows], limit=config.PROJECT_MAX_PER_USER)


@bp.post("/api/projects")
@login_required
def project_create():
    me_row = current_user()
    db = get_db()
    data = request.get_json(silent=True) or {}
    n = db.execute("SELECT COUNT(*) AS n FROM edit_projects WHERE user_id = ?", (me_row["id"],)).fetchone()["n"]
    if n >= config.PROJECT_MAX_PER_USER:
        return err(f"You have {n} saved projects, which is the limit. Delete one to start another.", 409, limit=True)
    pid, t = secrets.token_hex(8), now()
    try:
        fields = _fields(data)
        state = clean_state(data["state"] if "state" in data else {})
    except StateError as e:
        return err(str(e))
    fields.setdefault("name", "Untitled project")
    db.execute("INSERT INTO edit_projects (id, user_id, name, created_at, updated_at) VALUES (?,?,?,?,?)", (pid, me_row["id"], fields.pop("name"), t, t))
    try:
        cols = {**fields, **_state_columns(db, me_row["id"], pid, state)}
    except StateError as e:
        db.rollback()
        return err(str(e), 403 if isinstance(e, ForeignSource) else 400)
    sets = ", ".join(f"{k} = ?" for k in cols)
    db.execute(f"UPDATE edit_projects SET {sets} WHERE id = ?", [*cols.values(), pid])
    db.commit()
    return jsonify(ok=True, project=project_json(_mine(db, pid, me_row))), 201


def _missing_sources(db, pid, me_id):
    return [r["vod_id"] for r in db.execute(
        "SELECT s.vod_id FROM edit_project_sources s LEFT JOIN vods v ON v.id = s.vod_id AND v.user_id = ? AND v.status = 'ready' "
        "WHERE s.project_id = ? AND v.id IS NULL", (me_id, pid)).fetchall()]


@bp.get("/api/projects/<pid>")
@login_required
def project_get(pid):
    me_row = current_user()
    db = get_db()
    row = _mine(db, pid, me_row)
    if row is None:
        return err("Project not found.", 404)
    stored = db.execute("SELECT state FROM edit_projects WHERE id = ?", (pid,)).fetchone()["state"]
    try:
        state = json.loads(stored)
    except ValueError:
        state = {}
    state.setdefault("v", STATE_VERSION)
    state.setdefault("aspect", row["aspect"])
    state.setdefault("clips", [])
    state.setdefault("texts", [])
    return jsonify(project=project_json(row, state, _missing_sources(db, pid, me_row["id"])))


@bp.post("/api/projects/<pid>/save")
@login_required
def project_save(pid):
    """Save the timeline (`state`) and/or the details (name, title, description, category, visibility).
    `rev` is required: the version this change is based on. A timeline change on an exported project makes it a draft again."""
    me_row = current_user()
    db = get_db()
    row = _mine(db, pid, me_row)
    if row is None:
        return err("Project not found.", 404)
    data = request.get_json(silent=True) or {}
    try:
        base = int(data.get("rev"))
    except (TypeError, ValueError):
        return err("Say which version you are saving over (rev).")
    if base != row["rev"]:
        return err("This project was saved somewhere else. Reload it to see the latest version.", 409, conflict=True, rev=row["rev"])
    try:
        cols = _fields(data)
        state = clean_state(data["state"]) if "state" in data else None
    except StateError as e:
        return err(str(e))
    if not cols and state is None:
        return err("Nothing to save.")

    try:
        if state is not None:
            cols.update(_state_columns(db, me_row["id"], pid, state))
            if row["status"] == "exported":
                cols["status"] = "draft"
    except StateError as e:
        db.rollback()
        return err(str(e), 403 if isinstance(e, ForeignSource) else 400)

    cols["rev"] = base + 1
    cols["updated_at"] = now()
    sets = ", ".join(f"{k} = ?" for k in cols)
    # `rev = ?` makes the check-and-write atomic: of two simultaneous saves only one wins.
    n = db.execute(f"UPDATE edit_projects SET {sets} WHERE id = ? AND rev = ?", [*cols.values(), pid, base]).rowcount
    if not n:
        db.rollback()
        current = db.execute("SELECT rev FROM edit_projects WHERE id = ?", (pid,)).fetchone()
        return err("This project was saved somewhere else. Reload it to see the latest version.", 409, conflict=True, rev=current["rev"] if current else None)
    db.commit()
    return jsonify(ok=True, project=project_json(_mine(db, pid, me_row)))


@bp.post("/api/projects/<pid>/cover")
@login_required
def project_cover_set(pid):
    """The custom cover for when the video is published: a JPEG data URL (the browser scales a picked file or a video
    frame to fit MAX_COVER_BYTES). Changing it doesn't touch `rev`: it can't conflict with the timeline."""
    me_row = current_user()
    db = get_db()
    if _mine(db, pid, me_row) is None:
        return err("Project not found.", 404)
    data = request.get_json(silent=True) or {}
    cover = decode_jpeg(data.get("cover"), config.MAX_COVER_BYTES)
    if cover is None:
        return err("That cover image isn't valid or is too big.", field="cover")
    source = data.get("source", "upload")
    if source not in COVER_SOURCES:
        return err("Unknown cover source.")
    t = now()
    db.execute(
        "INSERT INTO edit_project_covers (project_id, data, source, updated_at) VALUES (?,?,?,?) "
        "ON CONFLICT(project_id) DO UPDATE SET data = excluded.data, source = excluded.source, updated_at = excluded.updated_at",
        (pid, cover, source, t))
    db.execute("UPDATE edit_projects SET updated_at = ? WHERE id = ?", (t, pid))
    db.commit()
    return jsonify(ok=True, project=project_json(_mine(db, pid, me_row)))


@bp.post("/api/projects/<pid>/cover/delete")
@login_required
def project_cover_delete(pid):
    me_row = current_user()
    db = get_db()
    if _mine(db, pid, me_row) is None:
        return err("Project not found.", 404)
    db.execute("DELETE FROM edit_project_covers WHERE project_id = ?", (pid,))
    db.execute("UPDATE edit_projects SET updated_at = ? WHERE id = ?", (now(), pid))
    db.commit()
    return jsonify(ok=True, project=project_json(_mine(db, pid, me_row)))


@bp.get("/api/projects/<pid>/cover")
@login_required
def project_cover_get(pid):
    me_row = current_user()
    db = get_db()
    if _mine(db, pid, me_row) is None:
        return err("No cover.", 404)
    row = db.execute("SELECT data FROM edit_project_covers WHERE project_id = ?", (pid,)).fetchone()
    if row is None:
        return err("No cover.", 404)
    resp = Response(row["data"], mimetype="image/jpeg")
    resp.headers["Cache-Control"] = "private, max-age=86400"  # the URL changes with `cover` (the version) in the project JSON
    return resp


@bp.post("/api/projects/<pid>/delete")
@login_required
def project_delete(pid):
    """Deletes the draft only. A clip that was exported from it stays: it is a video of its own."""
    me_row = current_user()
    db = get_db()
    if _mine(db, pid, me_row) is None:
        return err("Project not found.", 404)
    db.execute("DELETE FROM edit_projects WHERE id = ?", (pid,))  # covers and sources go with it (ON DELETE CASCADE)
    db.commit()
    return jsonify(ok=True)
