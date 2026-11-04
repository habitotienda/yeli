"""Saved streams: when a live ends, the recording becomes a video on the streamer's profile.

How it works
  * the streamer's browser records the program output (MediaRecorder) and uploads it in ~5 s pieces while live
    (POST /api/vod/<id>/chunk), so closing the tab loses almost nothing
  * when the stream ends the browser calls /finish and the recording becomes a public video of the channel
  * if the browser disappears, a recording that sent nothing for VOD_STALE_SECONDS is closed with what it has
  * the streamer may change the cover, the title and the description ONE time (POST /api/vod/<id>/edit)

Streams started from OBS over WHIP don't pass through the streamer's browser, so they are not recorded.
"""
import os
import re
import secrets
from pathlib import Path

from flask import Blueprint, Response, jsonify, request, send_file

from . import config
from .config import *
from .core import *
from .db import get_db

bp = Blueprint("vods", __name__)

VOD_ID = re.compile(r"^[a-f0-9]{16}$")
MIMES = {"video/webm": "webm", "video/mp4": "mp4"}


def vod_path(row):
    return Path(config.VOD_DIR) / f"{row['id']}.{MIMES[row['mime']]}"


def _remove_file(row):
    try:
        vod_path(row).unlink()
    except OSError:
        pass


def _finalize(db, row, at):
    """Close a recording: it becomes a video, or disappears when nothing was recorded."""
    if row["size"] <= 0:
        db.execute("DELETE FROM vods WHERE id = ?", (row["id"],))
        _remove_file(row)
        return False
    db.execute(
        "UPDATE vods SET status = 'ready', ended_at = ?, duration = ?, updated_at = ? WHERE id = ?",
        (at, max(0, at - row["started_at"]), at, row["id"]),
    )
    return True


def close_stale(db, user_id=None):
    """Recordings whose browser went away: keep what arrived."""
    t = now()
    sql = "SELECT * FROM vods WHERE status = 'recording' AND updated_at < ?"
    args = [t - config.VOD_STALE_SECONDS]
    if user_id is not None:
        sql += " AND user_id = ?"
        args.append(user_id)
    for row in db.execute(sql, args).fetchall():
        _finalize(db, row, row["updated_at"])
    db.commit()


def vod_json(row, me_row=None):
    mine = bool(me_row and me_row["id"] == row["user_id"])
    out = {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"],
        "category": row["category"],
        "duration": row["duration"],
        "started_at": row["started_at"],
        "status": row["status"],
        "cover": row["cover_ver"] if row["has_cover"] else None,
        "username": row["username"],
        "hue": avatar_hue(row["username"]),
        "avatar": avatar_value(row),
        "is_mine": mine,
        "edited": bool(row["edited"]),
        "can_edit": bool(mine and row["status"] == "ready" and not row["edited"]),
    }
    return out


VOD_SELECT = """
SELECT v.id, v.user_id, v.title, v.description, v.category, v.mime, v.status, v.size, v.duration, v.started_at,
       v.cover_ver, v.edited, (v.cover IS NOT NULL AND LENGTH(v.cover) > 0) AS has_cover,
       u.username, u.avatar, u.avatar_updated
FROM vods v JOIN users u ON u.id = v.user_id
"""


def _get(db, vid):
    if not VOD_ID.match(vid or ""):
        return None
    return db.execute(f"{VOD_SELECT} WHERE v.id = ?", (vid,)).fetchone()


def _visible(row, me_row):
    """Ready videos are public; a recording in progress is only known to its owner."""
    if row is None:
        return False
    if row["status"] == "ready":
        return vod_path(row).exists()
    return bool(me_row and me_row["id"] == row["user_id"])


# --------------------------------------------------------------------------
# Recording (called by the streamer's browser)
# --------------------------------------------------------------------------
@bp.post("/api/vod/start")
@login_required
def vod_start():
    me_row = current_user()
    data = request.get_json(silent=True) or {}
    mime = text_field(data, "mime", 80).split(";")[0].strip().lower()
    if mime not in MIMES:
        return err("This video format isn't supported.")
    db = get_db()
    stream = db.execute("SELECT is_live, title, category FROM streams WHERE user_id = ?", (me_row["id"],)).fetchone()
    if stream is None or not stream["is_live"]:
        return err("You are not live.", 409)

    # A new stream closes whatever an earlier one left open.
    for old in db.execute("SELECT * FROM vods WHERE user_id = ? AND status = 'recording'", (me_row["id"],)).fetchall():
        _finalize(db, old, old["updated_at"])
    saved = db.execute("SELECT COUNT(*) AS n FROM vods WHERE user_id = ? AND status = 'ready'", (me_row["id"],)).fetchone()["n"]
    if saved >= config.VOD_MAX_PER_USER:
        db.commit()
        return err(f"You have {saved} saved videos, which is the limit. Delete one to save your next stream.", 409, limit=True)

    Path(config.VOD_DIR).mkdir(parents=True, exist_ok=True)
    vid = secrets.token_hex(8)
    t = now()
    db.execute(
        """INSERT INTO vods (id, user_id, title, category, mime, status, started_at, updated_at, cover, cover_ver)
           VALUES (?,?,?,?,?,'recording',?,?,(SELECT data FROM thumbnails WHERE user_id = ?),?)""",
        (vid, me_row["id"], stream["title"] or f"{me_row['username']}'s stream", stream["category"] or "Other", mime, t, t,
         me_row["id"], t),
    )
    db.commit()
    row = db.execute("SELECT id, mime FROM vods WHERE id = ?", (vid,)).fetchone()
    vod_path(row).touch()
    return jsonify(ok=True, id=vid, max_bytes=config.VOD_MAX_BYTES)


@bp.post("/api/vod/<vid>/chunk")
@login_required
def vod_chunk(vid):
    """One piece of the recording. `seq` counts from 0; a repeated piece is accepted and ignored."""
    me_row = current_user()
    db = get_db()
    row = _get(db, vid)
    if row is None or row["user_id"] != me_row["id"]:
        return err("Video not found.", 404)
    if row["status"] != "recording":
        return err("This recording is already closed.", 409, closed=True)
    try:
        seq = int(request.args.get("seq", ""))
    except ValueError:
        return err("Invalid piece number.")
    full = db.execute("SELECT chunks, size FROM vods WHERE id = ?", (vid,)).fetchone()
    if seq < full["chunks"]:
        return jsonify(ok=True, dup=True)
    if seq != full["chunks"]:
        return err("A piece is missing.", 409, expected=full["chunks"])
    body = request.get_data()
    if not body:
        return err("Empty piece.")
    if full["size"] + len(body) > config.VOD_MAX_BYTES:
        _finalize(db, row_full(db, vid), now())
        db.commit()
        return err("This video reached the size limit and was saved as it is.", 413, closed=True)

    path = vod_path(row)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "r+b" if path.exists() else "w+b") as f:
        f.truncate(full["size"])  # drop what a failed earlier attempt may have left after the saved part
        f.seek(full["size"])
        f.write(body)
    t = now()
    ok = db.execute(
        "UPDATE vods SET size = size + ?, chunks = chunks + 1, updated_at = ? WHERE id = ? AND chunks = ?",
        (len(body), t, vid, seq),
    ).rowcount
    db.commit()
    if not ok:
        return err("A piece is missing.", 409, expected=seq + 1)
    return jsonify(ok=True)


def row_full(db, vid):
    return db.execute("SELECT * FROM vods WHERE id = ?", (vid,)).fetchone()


@bp.post("/api/vod/<vid>/finish")
@login_required
def vod_finish(vid):
    me_row = current_user()
    db = get_db()
    row = _get(db, vid)
    if row is None or row["user_id"] != me_row["id"]:
        return err("Video not found.", 404)
    if row["status"] == "recording":
        ok = _finalize(db, row_full(db, vid), now())
        db.commit()
        if not ok:
            return jsonify(ok=True, saved=False)
    return jsonify(ok=True, saved=True, video=vod_json(_get(db, vid), me_row))


# --------------------------------------------------------------------------
# Watching and managing saved videos
# --------------------------------------------------------------------------
@bp.get("/api/channel/<username>/videos")
def channel_videos(username):
    db = get_db()
    owner = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if owner is None:
        return err("Channel not found.", 404)
    close_stale(db, owner["id"])
    me_row = current_user()
    rows = db.execute(
        f"{VOD_SELECT} WHERE v.user_id = ? AND v.status = 'ready' ORDER BY v.started_at DESC LIMIT 48", (owner["id"],)
    ).fetchall()
    return jsonify(videos=[vod_json(r, me_row) for r in rows if vod_path(r).exists()])


@bp.get("/api/vod/<vid>")
def vod_info(vid):
    db = get_db()
    row = _get(db, vid)
    if row is not None and row["status"] == "recording":
        close_stale(db, row["user_id"])
        row = _get(db, vid)
    me_row = current_user()
    if not _visible(row, me_row):
        return err("Video not found.", 404)
    return jsonify(video=vod_json(row, me_row))


@bp.get("/api/vod/<vid>/video")
def vod_file(vid):
    row = _get(get_db(), vid)
    if row is None or row["status"] != "ready" or not vod_path(row).exists():
        return err("Video not found.", 404)
    resp = send_file(vod_path(row), mimetype=row["mime"], conditional=True, max_age=3600)  # supports Range (seeking)
    resp.headers["Cache-Control"] = "public, max-age=3600"
    return resp


@bp.get("/api/vod/<vid>/cover")
def vod_cover(vid):
    if not VOD_ID.match(vid):
        return err("No cover.", 404)
    row = get_db().execute("SELECT cover, status FROM vods WHERE id = ?", (vid,)).fetchone()
    if row is None or not row["cover"] or row["status"] != "ready":
        return err("No cover.", 404)
    resp = Response(row["cover"], mimetype="image/jpeg")
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp


@bp.post("/api/vod/<vid>/edit")
@login_required
def vod_edit(vid):
    """Change the title, the description and/or the cover. This works ONE time per video."""
    me_row = current_user()
    db = get_db()
    row = _get(db, vid)
    if row is None or row["user_id"] != me_row["id"]:
        return err("Video not found.", 404)
    if row["status"] != "ready":
        return err("You can edit the video once the stream has ended and it has been saved.", 409)
    if row["edited"]:
        return err("You already used your one change for this video.", 403, locked=True)

    data = request.get_json(silent=True) or {}
    title, description, cover = row["title"], row["description"], None
    if "title" in data:
        title = text_field(data, "title", config.VOD_TITLE_MAX)
        if not title:
            return err("Give your video a title.", field="title")
    if "description" in data:
        description = text_field(data, "description", config.VOD_DESC_MAX)
    if data.get("cover"):
        cover = decode_jpeg(data["cover"], config.MAX_COVER_BYTES)
        if cover is None:
            return err("That cover image isn't valid or is too big.", field="cover")
    if title == row["title"] and description == row["description"] and cover is None:
        return err("Nothing to change. Your one change is still available.")

    # The `edited = 0` condition makes the one-time rule safe even if two requests arrive together.
    if cover is not None:
        n = db.execute(
            "UPDATE vods SET title = ?, description = ?, cover = ?, cover_ver = ?, edited = 1 WHERE id = ? AND edited = 0",
            (title, description, cover, now(), vid),
        ).rowcount
    else:
        n = db.execute(
            "UPDATE vods SET title = ?, description = ?, edited = 1 WHERE id = ? AND edited = 0", (title, description, vid)
        ).rowcount
    db.commit()
    if not n:
        return err("You already used your one change for this video.", 403, locked=True)
    return jsonify(ok=True, video=vod_json(_get(db, vid), me_row))


@bp.post("/api/vod/<vid>/delete")
@login_required
def vod_delete(vid):
    me_row = current_user()
    db = get_db()
    row = _get(db, vid)
    if row is None or row["user_id"] != me_row["id"]:
        return err("Video not found.", 404)
    db.execute("DELETE FROM vods WHERE id = ?", (vid,))
    db.commit()
    _remove_file(row)
    return jsonify(ok=True)
