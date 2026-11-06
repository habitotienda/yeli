"""Saved streams: when a live ends, the recording is kept as a private CLIP of the streamer.

A clip is only visible to its owner. From there the streamer can open it in the video editor (cut, join, speed,
filters, text...), and publish it (or the edited result) when it is ready: only published videos show up on the
channel. Videos saved before clips existed stay published.

How it works
  * the streamer's browser records the program output (MediaRecorder) and uploads it in ~5 s pieces while live
    (POST /api/vod/<id>/chunk), so closing the tab loses almost nothing
  * when the stream ends the browser calls /finish and the recording becomes a private clip of the channel owner
  * the editor exports its result with POST /api/vod/new + the same /chunk and /finish routes (a clip with source "edit")
  * POST /api/vod/<id>/publish makes a clip public (and /unpublish takes it back to a private clip)
  * if the browser disappears, a recording that sent nothing for VOD_STALE_SECONDS is closed with what it has
  * a clip can be changed freely; once published, the streamer may change the cover, title and description ONE time

Streams started from OBS over WHIP don't pass through the streamer's browser, so they are not recorded.
"""
import os
import re
import secrets
from pathlib import Path
from urllib.parse import urlparse

from flask import Blueprint, Response, jsonify, request, send_file

from . import config
from .config import *
from .core import *
from .db import get_db
from .bot import LINK_RE, chat_settings
from .moderation import active_ban, can_moderate
from .notifications import notify

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


def _finalize(db, row, at, duration=None):
    """Close a recording: it becomes a (private) clip, or disappears when nothing was recorded."""
    if row["size"] <= 0:
        db.execute("DELETE FROM vods WHERE id = ?", (row["id"],))
        _remove_file(row)
        return False
    db.execute(
        "UPDATE vods SET status = 'ready', ended_at = ?, duration = ?, updated_at = ? WHERE id = ?",
        (at, max(0, at - row["started_at"]) if duration is None else duration, at, row["id"]),
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
        "visibility": row["visibility"],
        "is_clip": row["visibility"] == "private",
        "source": row["source"],
        # a clip can be changed freely; a published video only once
        "can_edit": bool(mine and row["status"] == "ready" and (row["visibility"] == "private" or not row["edited"])),
        "likes": row["likes"],
        "comment_count": row["comment_count"],
        "liked": bool(me_row and get_db().execute(
            "SELECT 1 FROM vod_likes WHERE vod_id = ? AND user_id = ?", (row["id"], me_row["id"])).fetchone()),
    }
    return out


VOD_SELECT = """
SELECT v.id, v.user_id, v.title, v.description, v.category, v.mime, v.status, v.size, v.duration, v.started_at,
       v.cover_ver, v.edited, v.visibility, v.source, (v.cover IS NOT NULL AND LENGTH(v.cover) > 0) AS has_cover,
       (SELECT COUNT(*) FROM vod_likes l WHERE l.vod_id = v.id) AS likes,
       (SELECT COUNT(*) FROM vod_comments c WHERE c.vod_id = v.id) AS comment_count,
       u.username, u.avatar, u.avatar_updated
FROM vods v JOIN users u ON u.id = v.user_id
"""


def _get(db, vid):
    if not VOD_ID.match(vid or ""):
        return None
    return db.execute(f"{VOD_SELECT} WHERE v.id = ?", (vid,)).fetchone()


def _follows(db, me_row, owner_id):
    return bool(me_row and db.execute(
        "SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?", (me_row["id"], owner_id)).fetchone())


def _visible(row, me_row):
    """Public videos are for everyone, 'followers' videos for the owner's followers; clips (private) and recordings in
    progress are only known to their owner."""
    if row is None:
        return False
    mine = bool(me_row and me_row["id"] == row["user_id"])
    if row["status"] == "ready":
        if not vod_path(row).exists():
            return False
        return mine or row["visibility"] == "public" or (
            row["visibility"] == "followers" and _follows(get_db(), me_row, row["user_id"]))
    return mine


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
        return err(f"You have {saved} saved clips and videos, which is the limit. Delete one to save your next stream.", 409, limit=True)

    Path(config.VOD_DIR).mkdir(parents=True, exist_ok=True)
    vid = secrets.token_hex(8)
    t = now()
    db.execute(
        """INSERT INTO vods (id, user_id, title, category, mime, status, started_at, updated_at, cover, cover_ver, visibility)
           VALUES (?,?,?,?,?,'recording',?,?,(SELECT data FROM thumbnails WHERE user_id = ?),?,'private')""",
        (vid, me_row["id"], stream["title"] or f"{me_row['username']}'s stream", stream["category"] or "Other", mime, t, t,
         me_row["id"], t),
    )
    db.commit()
    row = db.execute("SELECT id, mime FROM vods WHERE id = ?", (vid,)).fetchone()
    vod_path(row).touch()
    return jsonify(ok=True, id=vid, max_bytes=config.VOD_MAX_BYTES)


@bp.post("/api/vod/new")
@login_required
def vod_new():
    """Start an upload that is not a live stream (the editor's export). The pieces go to /chunk like a recording."""
    me_row = current_user()
    data = request.get_json(silent=True) or {}
    mime = text_field(data, "mime", 80).split(";")[0].strip().lower()
    if mime not in MIMES:
        return err("This video format isn't supported.")
    db = get_db()
    project = None
    if data.get("project") not in (None, ""):  # exporting a draft: the clip remembers where it came from
        project = db.execute("SELECT id, name, title FROM edit_projects WHERE id = ? AND user_id = ?", (str(data["project"]), me_row["id"])).fetchone()
        if project is None:
            return err("Project not found.", 404)
    title = text_field(data, "title", config.VOD_TITLE_MAX) or (project and (project["title"] or project["name"])) or "Edited video"
    for old in db.execute("SELECT * FROM vods WHERE user_id = ? AND status = 'recording' AND source = 'edit'", (me_row["id"],)).fetchall():
        _finalize(db, old, old["updated_at"])  # an export that was abandoned
    saved = db.execute("SELECT COUNT(*) AS n FROM vods WHERE user_id = ? AND status = 'ready'", (me_row["id"],)).fetchone()["n"]
    if saved >= config.VOD_MAX_PER_USER:
        db.commit()
        return err(f"You have {saved} saved clips and videos, which is the limit. Delete one to save this one.", 409, limit=True)
    Path(config.VOD_DIR).mkdir(parents=True, exist_ok=True)
    vid = secrets.token_hex(8)
    t = now()
    db.execute(
        """INSERT INTO vods (id, user_id, title, category, mime, status, started_at, updated_at, visibility, source, project_id)
           VALUES (?,?,?,'Other',?,'recording',?,?,'private','edit',?)""",
        (vid, me_row["id"], title, mime, t, t, project and project["id"]),
    )
    db.commit()
    vod_path(db.execute("SELECT id, mime FROM vods WHERE id = ?", (vid,)).fetchone()).touch()
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
        data = request.get_json(silent=True) or {}
        duration = None
        if row["source"] == "edit":  # an export is not a live: its length is what the editor says, not the wall clock
            try:
                duration = min(max(int(round(float(data.get("duration")))), 0), 24 * 3600)
            except (TypeError, ValueError):
                duration = None
            cover = decode_jpeg(data.get("cover"), config.MAX_COVER_BYTES) if data.get("cover") else None
            if cover is not None:
                db.execute("UPDATE vods SET cover = ?, cover_ver = ? WHERE id = ?", (cover, now(), vid))
        full = row_full(db, vid)
        ok = _finalize(db, full, now(), duration)
        if ok and full["project_id"]:
            _link_export(db, full["project_id"], vid, data.get("state_rev"))
        db.commit()
        if not ok:
            return jsonify(ok=True, saved=False)
    return jsonify(ok=True, saved=True, video=vod_json(_get(db, vid), me_row))


def _link_export(db, project_id, vid, state_rev):
    """The draft now points to its newest export. It counts as 'exported' only if its timeline is still the one that was
    rendered: `state_rev` is what the editor says it exported; if the draft was saved with other edits meanwhile it stays a draft."""
    try:
        state_rev = int(state_rev)
    except (TypeError, ValueError):
        state_rev = None
    db.execute(
        "UPDATE edit_projects SET vod_id = ?, status = CASE WHEN state_rev = ? THEN 'exported' ELSE 'draft' END WHERE id = ?",
        (vid, state_rev, project_id))


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
    see_followers = bool(me_row and (me_row["id"] == owner["id"] or _follows(db, me_row, owner["id"])))
    rows = db.execute(
        f"{VOD_SELECT} WHERE v.user_id = ? AND v.status = 'ready' AND (v.visibility = 'public' OR (v.visibility = 'followers' AND ?)) "
        "ORDER BY v.started_at DESC LIMIT 48",
        (owner["id"], 1 if see_followers else 0)
    ).fetchall()
    return jsonify(videos=[vod_json(r, me_row) for r in rows if vod_path(r).exists()])


@bp.get("/api/me/videos")
@login_required
def my_videos():
    """Everything I have saved, clips and published videos, newest first. This is what the editor and the Clips page use."""
    me_row = current_user()
    db = get_db()
    close_stale(db, me_row["id"])
    rows = db.execute(
        f"{VOD_SELECT} WHERE v.user_id = ? AND v.status = 'ready' ORDER BY v.started_at DESC LIMIT 200", (me_row["id"],)
    ).fetchall()
    return jsonify(videos=[vod_json(r, me_row) for r in rows if vod_path(r).exists()], limit=config.VOD_MAX_PER_USER)


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


def _direct_download_attempt():
    """True when the request looks like the file being opened, saved or fetched by a script, not played by a <video>.

    Browsers that send Fetch Metadata (Chrome, Edge, Firefox, Safari 16.4+) say what the response is for: a <video>
    element sends `Sec-Fetch-Dest: video`; typing the URL (`document`), "save link as" or fetch()/XHR (`empty`) don't.
    Older browsers send nothing, so there the page must have been the Referer, which a pasted URL doesn't have.
    This closes the casual routes. It is not DRM: whatever a browser can play, a determined person with the
    developer tools or a custom client can still copy, and the signed-URL step (next) narrows that further."""
    if not config.VOD_BLOCK_DIRECT:
        return False
    dest = request.headers.get("Sec-Fetch-Dest")
    if dest is not None:
        return dest not in ("video", "audio")
    return urlparse(request.headers.get("Referer", "")).netloc != request.host


@bp.get("/api/vod/<vid>/video")
def vod_file(vid):
    row = _get(get_db(), vid)
    if row is None or row["status"] != "ready" or not _visible(row, current_user()):
        return err("Video not found.", 404)
    if _direct_download_attempt():  # after the visibility check, so it tells nobody that a hidden video exists
        return err("This video can only be watched on Yeli.", 403, protected=True)
    resp = send_file(vod_path(row), mimetype=row["mime"], conditional=True, max_age=3600)  # supports Range (seeking)
    resp.headers["Cache-Control"] = ("public" if row["visibility"] == "public" else "private") + ", max-age=3600"
    resp.headers["Content-Disposition"] = "inline"
    resp.headers["Cross-Origin-Resource-Policy"] = "same-origin"  # other sites can't embed or hotlink it
    return resp


@bp.get("/api/vod/<vid>/cover")
def vod_cover(vid):
    if not VOD_ID.match(vid):
        return err("No cover.", 404)
    row = get_db().execute("SELECT cover, status, visibility, user_id FROM vods WHERE id = ?", (vid,)).fetchone()
    if row is None or not row["cover"] or row["status"] != "ready":
        return err("No cover.", 404)
    me_row = current_user()
    public = row["visibility"] == "public"
    mine = bool(me_row and me_row["id"] == row["user_id"])
    if not public and not mine and not (row["visibility"] == "followers" and _follows(get_db(), me_row, row["user_id"])):
        return err("No cover.", 404)
    resp = Response(row["cover"], mimetype="image/jpeg")
    resp.headers["Cache-Control"] = ("public" if public else "private") + ", max-age=86400"
    return resp


@bp.post("/api/vod/<vid>/edit")
@login_required
def vod_edit(vid):
    """Change the title, the description and/or the cover: freely on a clip, ONE time once the video is published."""
    me_row = current_user()
    db = get_db()
    row = _get(db, vid)
    if row is None or row["user_id"] != me_row["id"]:
        return err("Video not found.", 404)
    if row["status"] != "ready":
        return err("You can edit the video once the stream has ended and it has been saved.", 409)
    published = row["visibility"] != "private"
    if published and row["edited"]:
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
        return err("Nothing to change." + (" Your one change is still available." if published else ""))

    # The `edited = 0` condition makes the one-time rule safe even if two requests arrive together.
    # A clip (not published) never uses it up.
    lock = ", edited = 1" if published else ""
    guard = " AND edited = 0" if published else ""
    if cover is not None:
        n = db.execute(
            f"UPDATE vods SET title = ?, description = ?, cover = ?, cover_ver = ?{lock} WHERE id = ?{guard}",
            (title, description, cover, now(), vid),
        ).rowcount
    else:
        n = db.execute(f"UPDATE vods SET title = ?, description = ?{lock} WHERE id = ?{guard}", (title, description, vid)).rowcount
    db.commit()
    if not n:
        return err("You already used your one change for this video.", 403, locked=True)
    return jsonify(ok=True, video=vod_json(_get(db, vid), me_row))


def apply_publish(db, row, target, title, description, category, cover=None):
    """Make a clip visible ('public' or 'followers') with its final details. `cover` is JPEG bytes or None to keep the current one."""
    if cover is not None:
        db.execute("UPDATE vods SET visibility = ?, title = ?, description = ?, category = ?, cover = ?, cover_ver = ? WHERE id = ?",
                   (target, title, description, category, cover, now(), row["id"]))
    else:
        db.execute("UPDATE vods SET visibility = ?, title = ?, description = ?, category = ? WHERE id = ?",
                   (target, title, description, category, row["id"]))


@bp.post("/api/vod/<vid>/publish")
@login_required
def vod_publish(vid):
    """Make a clip public on the channel. Title, description, category and cover can be set in the same step."""
    me_row = current_user()
    db = get_db()
    row = _get(db, vid)
    if row is None or row["user_id"] != me_row["id"]:
        return err("Video not found.", 404)
    if row["status"] != "ready":
        return err("This recording is still being saved.", 409)
    data = request.get_json(silent=True) or {}
    if row["visibility"] == "private":
        target = data.get("visibility", "public")
        if target not in ("public", "followers"):
            return err("Unknown privacy option.")
        title, description, category, cover = row["title"], row["description"], row["category"], None
        if "title" in data:
            title = text_field(data, "title", config.VOD_TITLE_MAX)
        if not title:
            return err("Give your video a title.", field="title")
        if "description" in data:
            description = text_field(data, "description", config.VOD_DESC_MAX)
        if "category" in data:
            if data["category"] not in config.CATEGORIES:
                return err("Unknown category.", field="category")
            category = data["category"]
        if data.get("cover"):
            cover = decode_jpeg(data["cover"], config.MAX_COVER_BYTES)
            if cover is None:
                return err("That cover image isn't valid or is too big.", field="cover")
        apply_publish(db, row, target, title, description, category, cover)
        db.commit()
    return jsonify(ok=True, video=vod_json(_get(db, vid), me_row))


@bp.post("/api/vod/<vid>/unpublish")
@login_required
def vod_unpublish(vid):
    """Take a published video back to a private clip. Its likes and comments are kept for when it is published again."""
    me_row = current_user()
    db = get_db()
    row = _get(db, vid)
    if row is None or row["user_id"] != me_row["id"]:
        return err("Video not found.", 404)
    db.execute("UPDATE vods SET visibility = 'private' WHERE id = ?", (vid,))
    db.commit()
    return jsonify(ok=True, video=vod_json(_get(db, vid), me_row))


@bp.post("/api/vod/<vid>/visibility")
@login_required
def vod_visibility(vid):
    """Set who can watch a video: 'private' (only me), 'followers' or 'public'. Likes and comments are kept when it changes."""
    me_row = current_user()
    db = get_db()
    row = _get(db, vid)
    if row is None or row["user_id"] != me_row["id"]:
        return err("Video not found.", 404)
    if row["status"] != "ready":
        return err("This recording is still being saved.", 409)
    target = (request.get_json(silent=True) or {}).get("visibility")
    if target not in ("private", "followers", "public"):
        return err("Unknown privacy option.")
    db.execute("UPDATE vods SET visibility = ? WHERE id = ?", (target, vid))
    db.commit()
    return jsonify(ok=True, video=vod_json(_get(db, vid), me_row))


@bp.post("/api/vod/<vid>/delete")
@login_required
def vod_delete(vid):
    me_row = current_user()
    db = get_db()
    row = _get(db, vid)
    if row is None or row["user_id"] != me_row["id"]:
        return err("Video not found.", 404)
    db.execute("DELETE FROM vod_likes WHERE vod_id = ?", (vid,))
    db.execute("DELETE FROM vod_comment_likes WHERE comment_id IN (SELECT id FROM vod_comments WHERE vod_id = ?)", (vid,))
    db.execute("DELETE FROM vod_comments WHERE vod_id = ?", (vid,))
    db.execute("DELETE FROM vods WHERE id = ?", (vid,))
    db.commit()
    _remove_file(row)
    return jsonify(ok=True)


# --------------------------------------------------------------------------
# Likes and comments on saved videos
# --------------------------------------------------------------------------
COMMENTS_PAGE = 20


def _watchable(db, vid):
    """The video row if it is saved and published, else None. Clips (private) take no likes or comments."""
    row = _get(db, vid)
    if row is None or row["status"] != "ready" or row["visibility"] == "private":
        return None
    return row if _visible(row, current_user()) else None


@bp.post("/api/vod/<vid>/like")
@login_required
def vod_like(vid):
    """Set (or remove) my like. Sending the same value twice is harmless."""
    me_row = current_user()
    db = get_db()
    row = _watchable(db, vid)
    if row is None:
        return err("Video not found.", 404)
    liked = (request.get_json(silent=True) or {}).get("liked")
    if not isinstance(liked, bool):
        return err("Say whether you like it.")
    if liked:
        added = db.execute("INSERT OR IGNORE INTO vod_likes (vod_id, user_id, created_at) VALUES (?,?,?)", (vid, me_row["id"], now())).rowcount == 1
        if added and row["user_id"] != me_row["id"]:
            notify(db, row["user_id"], "like", actor=me_row["username"], ref=vid, title=row["title"])
    else:
        db.execute("DELETE FROM vod_likes WHERE vod_id = ? AND user_id = ?", (vid, me_row["id"]))
    db.commit()
    n = db.execute("SELECT COUNT(*) AS n FROM vod_likes WHERE vod_id = ?", (vid,)).fetchone()["n"]
    return jsonify(ok=True, liked=liked, likes=n)


def _comment_json(r, me_row, can_mod):
    mine = bool(me_row and me_row["id"] == r["user_id"])
    return {
        "id": r["id"],
        "text": r["text"],
        "created_at": r["created_at"],
        "username": r["username"],
        "hue": avatar_hue(r["username"]),
        "avatar": avatar_value(r),
        "is_mine": mine,
        "can_delete": mine or can_mod,
        "likes": r["likes"],
        "liked": bool(r["liked"]),
        "parent": r["parent_id"],              # None for a top-level comment
        "reply_to": r["reply_to_name"],        # the username being answered (replies only)
        "reply_count": r["reply_count"],
    }


COMMENT_SELECT = """
SELECT c.id, c.user_id, c.text, c.created_at, c.parent_id, u.username, u.avatar, u.avatar_updated, ru.username AS reply_to_name,
       (SELECT COUNT(*) FROM vod_comment_likes cl WHERE cl.comment_id = c.id) AS likes,
       EXISTS(SELECT 1 FROM vod_comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = :me) AS liked,
       (SELECT COUNT(*) FROM vod_comments x WHERE x.parent_id = c.id) AS reply_count
FROM vod_comments c JOIN users u ON u.id = c.user_id LEFT JOIN users ru ON ru.id = c.reply_to
"""


def _me_id(me_row):
    return me_row["id"] if me_row else 0


def _comment_total(db, vid):
    """Every comment, replies included."""
    return db.execute("SELECT COUNT(*) AS n FROM vod_comments WHERE vod_id = ?", (vid,)).fetchone()["n"]


@bp.get("/api/vod/<vid>/comments")
def vod_comments(vid):
    """Top-level comments, newest first, COMMENTS_PAGE at a time. `before` is the id of the oldest one already shown.
    Replies are fetched per comment (see vod_replies)."""
    db = get_db()
    row = _watchable(db, vid)
    if row is None:
        return err("Video not found.", 404)
    me_row = current_user()
    can_mod = bool(me_row and can_moderate(db, row["user_id"], me_row["id"]))
    before = int_arg("before", 0)
    sql = f"{COMMENT_SELECT} WHERE c.vod_id = :vid AND c.parent_id IS NULL"
    args = {"me": _me_id(me_row), "vid": vid, "limit": COMMENTS_PAGE + 1}
    if before:
        sql += " AND c.id < :before"
        args["before"] = before
    rows = db.execute(sql + " ORDER BY c.id DESC LIMIT :limit", args).fetchall()
    return jsonify(comments=[_comment_json(r, me_row, can_mod) for r in rows[:COMMENTS_PAGE]],
                   more=len(rows) > COMMENTS_PAGE, total=_comment_total(db, vid))


@bp.get("/api/vod/<vid>/comments/<int:cid>/replies")
def vod_replies(vid, cid):
    """The replies to one comment, oldest first (a conversation reads top to bottom). `after` is the last id already shown."""
    db = get_db()
    row = _watchable(db, vid)
    if row is None:
        return err("Video not found.", 404)
    me_row = current_user()
    can_mod = bool(me_row and can_moderate(db, row["user_id"], me_row["id"]))
    after = int_arg("after", 0)
    rows = db.execute(
        f"{COMMENT_SELECT} WHERE c.vod_id = :vid AND c.parent_id = :cid AND c.id > :after ORDER BY c.id ASC LIMIT :limit",
        {"me": _me_id(me_row), "vid": vid, "cid": cid, "after": after, "limit": COMMENTS_PAGE + 1},
    ).fetchall()
    return jsonify(comments=[_comment_json(r, me_row, can_mod) for r in rows[:COMMENTS_PAGE]], more=len(rows) > COMMENTS_PAGE)


def _comment_blocked(db, channel_id, user_id, text):
    """The channel's chat rules that make sense for a comment: bans, blocked words, links, capitals."""
    ban = active_ban(db, channel_id, user_id)
    if ban:
        return "You're banned from this channel." + (f" Reason: {ban['reason']}" if ban["reason"] else ""), 403
    if can_moderate(db, channel_id, user_id):
        return None
    st = chat_settings(db, channel_id)
    if st["block_links"] and LINK_RE.search(text):
        return "Links aren't allowed here.", 400
    low = text.lower()
    if any(w and w in low for w in (x.strip().lower() for x in st["banned_words"].split(","))):
        return "That comment has a word this channel doesn't allow.", 400
    letters = [c for c in text if c.isalpha()]
    if st["caps_percent"] and len(letters) >= 10 and 100 * sum(c.isupper() for c in letters) / len(letters) > st["caps_percent"]:
        return "Too many capital letters.", 400
    return None


@bp.post("/api/vod/<vid>/comments")
@login_required
def vod_comment_add(vid):
    """Add a comment, or a reply when `parent` (a comment id) is given. A reply to a reply is attached to the top-level
    comment of that conversation and remembers who it answers."""
    me_row = current_user()
    db = get_db()
    row = _watchable(db, vid)
    if row is None:
        return err("Video not found.", 404)
    data = request.get_json(silent=True) or {}
    text = " ".join(text_field(data, "text", config.VOD_COMMENT_MAX * 2).split())[: config.VOD_COMMENT_MAX]
    if not text:
        return err("Write a comment first.")
    parent_id = reply_to = None
    answered = None
    if data.get("parent") not in (None, ""):
        try:
            asked = int(data["parent"])
        except (TypeError, ValueError):
            return err("That comment doesn't exist.", 404)
        answered = db.execute("SELECT id, user_id, parent_id FROM vod_comments WHERE id = ? AND vod_id = ?", (asked, vid)).fetchone()
        if answered is None:
            return err("That comment doesn't exist anymore.", 404)
        parent_id = answered["parent_id"] or answered["id"]
        reply_to = answered["user_id"]
    t = now()
    recent = db.execute("SELECT COUNT(*) AS n FROM vod_comments WHERE user_id = ? AND created_at >= ?", (me_row["id"], t - 60)).fetchone()["n"]
    if recent >= 5:
        return err("You're commenting too fast. Wait a moment.", 429)
    blocked = _comment_blocked(db, row["user_id"], me_row["id"], text)
    if blocked:
        return err(blocked[0], blocked[1])
    cur = db.execute(
        "INSERT INTO vod_comments (vod_id, user_id, text, created_at, parent_id, reply_to) VALUES (?,?,?,?,?,?)",
        (vid, me_row["id"], text, t, parent_id, reply_to),
    )
    told = {me_row["id"]}
    if answered is not None and answered["user_id"] not in told:
        notify(db, answered["user_id"], "reply", actor=me_row["username"], ref=vid, title=row["title"], body=text)
        told.add(answered["user_id"])
    if row["user_id"] not in told:
        notify(db, row["user_id"], "comment", actor=me_row["username"], ref=vid, title=row["title"], body=text)
    db.commit()
    created = db.execute(f"{COMMENT_SELECT} WHERE c.id = :id", {"me": me_row["id"], "id": cur.lastrowid}).fetchone()
    return jsonify(comment=_comment_json(created, me_row, can_moderate(db, row["user_id"], me_row["id"])), total=_comment_total(db, vid)), 201


@bp.post("/api/vod/<vid>/comments/<int:cid>/like")
@login_required
def vod_comment_like(vid, cid):
    """Set (or remove) my like on a comment or a reply. Sending the same value twice is harmless."""
    me_row = current_user()
    db = get_db()
    if _watchable(db, vid) is None:
        return err("Video not found.", 404)
    if db.execute("SELECT 1 FROM vod_comments WHERE id = ? AND vod_id = ?", (cid, vid)).fetchone() is None:
        return err("Comment not found.", 404)
    liked = (request.get_json(silent=True) or {}).get("liked")
    if not isinstance(liked, bool):
        return err("Say whether you like it.")
    if liked:
        db.execute("INSERT OR IGNORE INTO vod_comment_likes (comment_id, user_id, created_at) VALUES (?,?,?)", (cid, me_row["id"], now()))
    else:
        db.execute("DELETE FROM vod_comment_likes WHERE comment_id = ? AND user_id = ?", (cid, me_row["id"]))
    db.commit()
    n = db.execute("SELECT COUNT(*) AS n FROM vod_comment_likes WHERE comment_id = ?", (cid,)).fetchone()["n"]
    return jsonify(ok=True, liked=liked, likes=n)


@bp.post("/api/vod/<vid>/comments/<int:cid>/delete")
@login_required
def vod_comment_delete(vid, cid):
    """The author, the streamer and the channel's moderators can remove a comment."""
    me_row = current_user()
    db = get_db()
    row = _watchable(db, vid)
    if row is None:
        return err("Video not found.", 404)
    c = db.execute("SELECT user_id FROM vod_comments WHERE id = ? AND vod_id = ?", (cid, vid)).fetchone()
    if c is None:
        return err("Comment not found.", 404)
    if c["user_id"] != me_row["id"] and not can_moderate(db, row["user_id"], me_row["id"]):
        return err("You can't remove that comment.", 403)
    db.execute("DELETE FROM vod_comments WHERE parent_id = ?", (cid,))  # its replies go with it
    db.execute("DELETE FROM vod_comments WHERE id = ?", (cid,))
    db.commit()
    return jsonify(ok=True, total=_comment_total(db, vid))
