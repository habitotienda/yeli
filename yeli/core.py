"""Small helpers shared by every module: responses, the signed-in user, rate limiting."""
import base64
import time
from functools import wraps

from flask import g, jsonify, request, session

from .config import *
from .db import get_db

__all__ = ['now', 'err', 'text_field', 'int_arg', 'USER_COLS', 'is_admin', 'avatar_value', 'current_user', 'login_required', 'avatar_hue', 'user_json', 'rate_limited', 'record_failure', 'decode_jpeg']

def now():
    return int(time.time())


def err(message, status=400, **extra):
    return jsonify(error=message, **extra), status


def text_field(data, key, max_len=500):
    value = data.get(key)
    return value.strip()[:max_len] if isinstance(value, str) else ""


def int_arg(name, default=0):
    try:
        return max(0, int(request.args.get(name, default)))
    except (TypeError, ValueError):
        return default


USER_COLS = (
    "id, username, email, bio, created_at, avatar, avatar_updated, name_color,"
    " COALESCE((SELECT bought FROM wallets w WHERE w.user_id = users.id), 0) AS balance,"
    " (SELECT COUNT(*) FROM avatars a WHERE a.user_id = users.id) AS has_upload"
)

def is_admin(username):
    return username.lower() in ADMINS


def avatar_value(row):
    if row["avatar"] == "upload":
        return f"upload:{row['avatar_updated']}"
    return row["avatar"]


def current_user():
    if not hasattr(g, "_user"):
        row = None
        uid = session.get("uid")
        if uid:
            row = get_db().execute(f"SELECT {USER_COLS} FROM users WHERE id = ?", (uid,)).fetchone()
            if row is None:
                session.clear()
        g._user = row
    return g._user


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if current_user() is None:
            return err("Log in to continue.", 401)
        return view(*args, **kwargs)

    return wrapper


def avatar_hue(username):
    return sum(ord(c) * (i + 7) for i, c in enumerate(username.lower())) % 360


def user_json(row):
    return {
        "username": row["username"],
        "email": row["email"],
        "bio": row["bio"],
        "hue": avatar_hue(row["username"]),
        "avatar": avatar_value(row),
        "has_upload": bool(row["has_upload"]),
        "balance": row["balance"],
        "name_color": row["name_color"],
        "is_admin": is_admin(row["username"]),
    }


_failed_logins = {}


def rate_limited(ip, limit=8, window=600):
    t = time.time()
    recent = [x for x in _failed_logins.get(ip, []) if t - x < window]
    _failed_logins[ip] = recent
    return len(recent) >= limit


def record_failure(ip):
    _failed_logins.setdefault(ip, []).append(time.time())




def decode_jpeg(data_url, limit):
    prefix = "data:image/jpeg;base64,"
    if not isinstance(data_url, str) or not data_url.startswith(prefix):
        return None
    try:
        raw = base64.b64decode(data_url[len(prefix):], validate=True)
    except ValueError:
        return None
    if len(raw) > limit or not raw.startswith(b"\xff\xd8\xff"):
        return None
    return raw
