"""Media server (SFU) integration with MediaMTX, which is free and open source.

Why: in peer-to-peer mode the streamer's browser encodes the video once per viewer. With an SFU the streamer
uploads once and the media server fans it out, so many people can go live at the same time and each one can
have many viewers.

How it fits together
  * the streamer publishes with WHIP (from the studio, or from OBS 30+) using a private stream key
  * viewers play with WHEP, no key needed
  * MediaMTX asks this server (POST /api/media/auth) whether each publish/read is allowed
  * the studio page still sends heartbeats to /api/stream/poll, which is what keeps the channel marked as live
"""
import hmac
import re
import secrets
from urllib.parse import parse_qs

from flask import Blueprint, jsonify, request

from . import config
from .core import *
from .db import get_db

bp = Blueprint("media", __name__)

PUBLISH_PATH = re.compile(r"^[a-z0-9_]{3,20}$")  # always the lowercase username, one path per channel


def media_path(username):
    return username.lower()


def ensure_stream_key(db, uid):
    row = db.execute("SELECT stream_key FROM users WHERE id = ?", (uid,)).fetchone()
    if row["stream_key"]:
        return row["stream_key"]
    key = secrets.token_urlsafe(24)
    db.execute("UPDATE users SET stream_key = ? WHERE id = ?", (key, uid))
    db.commit()
    return key


def connection_info(user_row, key):
    path = media_path(user_row["username"])
    return {
        "enabled": bool(config.MEDIA_URL),
        "path": path,
        "key": key,
        "whip": f"{config.MEDIA_URL}/{path}/whip" if config.MEDIA_URL else "",
        "rtmp": f"{config.MEDIA_RTMP}/{path}" if config.MEDIA_RTMP else "",
    }


@bp.get("/api/stream/key")
@login_required
def stream_key():
    me_row = current_user()
    key = ensure_stream_key(get_db(), me_row["id"])
    return jsonify(**connection_info(me_row, key))


@bp.post("/api/stream/key/reset")
@login_required
def stream_key_reset():
    me_row = current_user()
    db = get_db()
    key = secrets.token_urlsafe(24)
    db.execute("UPDATE users SET stream_key = ? WHERE id = ?", (key, me_row["id"]))
    db.commit()
    return jsonify(**connection_info(me_row, key))


def given_secrets(d):
    """Every place MediaMTX/OBS may put the stream key: token, password, 'user:pass' bearer, or ?key= / ?pass=."""
    out = []
    for field in ("token", "password"):
        v = d.get(field)
        if isinstance(v, str) and v:
            out.append(v)
            if ":" in v:  # "Authorization: Bearer user:pass"
                out.append(v.split(":", 1)[1])
    q = parse_qs(d.get("query") or "")
    for name in ("key", "pass", "token"):
        out.extend(q.get(name, []))
    return out


@bp.post("/api/media/auth")
def media_auth():
    """Called by MediaMTX (authMethod: http). 20x = allowed. Reading is public; publishing needs the stream key."""
    d = request.get_json(force=True, silent=True) or {}
    action = d.get("action")
    path = d.get("path") or ""
    ip = d.get("ip") or request.remote_addr or "?"
    if not PUBLISH_PATH.match(path):
        return "", 403
    if action == "read":
        return "", 200
    if action != "publish":
        return "", 403  # api, metrics, playback, pprof: never through the public port
    if rate_limited(ip, limit=20, window=300):
        return "", 429
    given = given_secrets(d)
    if not given:
        return "", 401  # no credentials yet: ask the client to send them
    row = get_db().execute("SELECT stream_key FROM users WHERE username = ?", (path,)).fetchone()
    if row and row["stream_key"] and any(hmac.compare_digest(g, row["stream_key"]) for g in given):
        return "", 200
    record_failure(ip)
    return "", 401
