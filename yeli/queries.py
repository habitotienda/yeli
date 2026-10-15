"""Queries shared by several modules: channels, viewer counting and the signaling inbox."""
import json
import re
import secrets
import time

from flask import request

from .config import *
from .core import *
from .db import get_db

__all__ = ['LIVE_COND', 'CHANNEL_SELECT', 'query_channels', 'channel_json', 'count_viewers', 'viewer_identity', 'live_streamer_id', 'push_signal', 'read_signals', 'signal_payload', 'stream_mode']

# Channel queries
LIVE_COND = "COALESCE(s.is_live = 1 AND s.last_seen >= :cut, 0) = 1"

CHANNEL_SELECT = """
SELECT u.id, u.username, u.bio, u.created_at, u.avatar, u.avatar_updated,
       COALESCE(s.is_live = 1 AND s.last_seen >= :cut, 0) AS live,
       s.title AS title, s.category AS category, s.started_at AS started_at, s.mode AS mode,
       (SELECT COUNT(*) FROM follows f WHERE f.followed_id = u.id) AS followers,
       (SELECT COUNT(DISTINCT v.viewer_key) FROM viewers v
         WHERE v.streamer_id = u.id AND v.superseded = 0 AND v.last_seen >= :vcut
           AND v.viewer_key != 'u' || u.id) AS viewers,
       (SELECT t.updated_at FROM thumbnails t WHERE t.user_id = u.id) AS thumb
FROM users u LEFT JOIN streams s ON s.user_id = u.id
"""


def query_channels(where="", params=None, order="", limit=60):
    t = now()
    p = {"cut": t - LIVE_TIMEOUT, "vcut": t - VIEWER_TIMEOUT, "limit": limit}
    p.update(params or {})
    sql = f"{CHANNEL_SELECT} {where} {order} LIMIT :limit"
    return get_db().execute(sql, p).fetchall()


def channel_json(row):
    live = bool(row["live"])
    return {
        "username": row["username"],
        "hue": avatar_hue(row["username"]),
        "avatar": avatar_value(row),
        "bio": row["bio"],
        "live": live,
        "title": (row["title"] or "") if live else "",
        "category": (row["category"] or "") if live else "",
        "viewers": row["viewers"] if live else 0,
        "followers": row["followers"],
        "started_at": row["started_at"] if live else None,
        "mode": row["mode"] if live else None,
        "thumb": row["thumb"] if live else None,
        "joined": row["created_at"],
    }


def count_viewers(db, streamer_id, since):
    """Distinct accounts watching (tabs of the same account count once; the streamer's own tabs don't count)."""
    return db.execute(
        """SELECT COUNT(DISTINCT viewer_key) AS n FROM viewers
           WHERE streamer_id = ? AND superseded = 0 AND last_seen >= ? AND viewer_key != ?""",
        (streamer_id, since, f"u{streamer_id}"),
    ).fetchone()["n"]


def viewer_identity():
    """Who is watching: the account, or for guests a random id kept in a cookie."""
    me_row = current_user()
    if me_row:
        return f"u{me_row['id']}", me_row["id"], None
    cid = request.cookies.get("yv", "")
    fresh = None
    if not re.fullmatch(r"[a-f0-9]{16}", cid):
        cid = secrets.token_hex(8)
        fresh = cid
    return f"a{cid}", None, fresh


def stream_mode(db, streamer_id):
    """'p2p' (viewers connect to the streamer's browser) or 'sfu' (everyone goes through the media server)."""
    row = db.execute("SELECT mode FROM streams WHERE user_id = ?", (streamer_id,)).fetchone()
    return row["mode"] if row else "p2p"


def live_streamer_id(username):
    row = get_db().execute(
        """SELECT u.id FROM users u JOIN streams s ON s.user_id = u.id
           WHERE u.username = ? AND s.is_live = 1 AND s.last_seen >= ?""",
        (username, now() - LIVE_TIMEOUT),
    ).fetchone()
    return row["id"] if row else None


def push_signal(to_key, from_key, kind, payload):
    get_db().execute(
        "INSERT INTO signals (to_key, from_key, kind, payload, created_at) VALUES (?,?,?,?,?)",
        (to_key, from_key, kind, json.dumps(payload), now()),
    )


def read_signals(to_key, after):
    """Acknowledge everything up to `after`, return what is newer."""
    db = get_db()
    db.execute("DELETE FROM signals WHERE to_key = ? AND id <= ?", (to_key, after))
    rows = db.execute(
        "SELECT id, from_key, kind, payload FROM signals WHERE to_key = ? AND id > ? ORDER BY id LIMIT 100",
        (to_key, after),
    ).fetchall()
    return [
        {
            "id": r["id"],
            "from": r["from_key"].split(":", 1)[1],
            "kind": r["kind"],
            "payload": json.loads(r["payload"]),
        }
        for r in rows
    ]


def signal_payload(data):
    payload = data.get("payload")
    if not isinstance(payload, dict) or len(json.dumps(payload)) > 20000:
        return None
    return payload
