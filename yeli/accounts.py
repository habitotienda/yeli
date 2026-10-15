"""Accounts and profile: register, log in, avatar, bio, password."""
import sqlite3

from flask import Blueprint, Response, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from . import config, economy
from .config import *
from .core import *
from .db import get_db
from .queries import *

bp = Blueprint("accounts", __name__)


@bp.get("/api/me")
def me():
    user = current_user()
    return jsonify(
        user=user_json(user) if user else None,
        config={
            "categories": CATEGORIES,
            "iceServers": load_ice_servers(),
            "economy": economy.public_config(),
            "media": {"enabled": bool(config.MEDIA_URL), "url": config.MEDIA_URL},
        },
    )


@bp.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}
    username = text_field(data, "username", 40)
    email = text_field(data, "email", 254).lower()
    password = data.get("password") if isinstance(data.get("password"), str) else ""

    if not USERNAME_RE.match(username):
        return err("Username must be 3–20 characters: letters, numbers or underscores.", field="username")
    if not EMAIL_RE.match(email):
        return err("Enter a valid email address.", field="email")
    if not 8 <= len(password) <= 128:
        return err("Password must be at least 8 characters.", field="password")

    db = get_db()
    if db.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
        return err("That username is taken.", 409, field="username")
    if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        return err("An account with that email already exists.", 409, field="email")

    try:
        cur = db.execute(
            "INSERT INTO users (username, email, password_hash, created_at) VALUES (?,?,?,?)",
            (username, email, generate_password_hash(password), now()),
        )
        db.execute("INSERT INTO streams (user_id) VALUES (?)", (cur.lastrowid,))
        db.execute("INSERT OR IGNORE INTO wallets (user_id, bought) VALUES (?, 0)", (cur.lastrowid,))
        db.commit()
    except sqlite3.IntegrityError:
        return err("That username or email is already in use.", 409)

    session.clear()
    session.permanent = True
    session["uid"] = cur.lastrowid
    user = db.execute(f"SELECT {USER_COLS} FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(user=user_json(user)), 201


@bp.post("/api/login")
def login():
    ip = request.remote_addr or "?"
    if rate_limited(ip):
        return err("Too many attempts. Try again in a few minutes.", 429)

    data = request.get_json(silent=True) or {}
    identifier = text_field(data, "identifier", 254)
    password = data.get("password") if isinstance(data.get("password"), str) else ""

    row = get_db().execute(
        f"SELECT {USER_COLS}, password_hash FROM users WHERE username = ? OR email = ?",
        (identifier, identifier),
    ).fetchone()
    if row is None or not check_password_hash(row["password_hash"], password):
        record_failure(ip)
        return err("Wrong username or password.", 401)

    session.clear()
    session.permanent = True
    session["uid"] = row["id"]
    return jsonify(user=user_json(row))


@bp.post("/api/logout")
def logout():
    user = current_user()
    if user:
        db = get_db()
        db.execute("UPDATE streams SET is_live = 0 WHERE user_id = ?", (user["id"],))
        db.execute("DELETE FROM viewers WHERE streamer_id = ?", (user["id"],))
        db.commit()
    session.clear()
    return jsonify(ok=True)





def fresh_user(uid):
    return get_db().execute(f"SELECT {USER_COLS} FROM users WHERE id = ?", (uid,)).fetchone()


@bp.post("/api/me/profile")
@login_required
def update_profile():
    uid = current_user()["id"]
    data = request.get_json(silent=True) or {}
    db = get_db()
    if "bio" in data:
        bio = data["bio"] if isinstance(data["bio"], str) else ""
        db.execute("UPDATE users SET bio = ? WHERE id = ?", (bio.strip()[:200], uid))
    if "avatar" in data:
        avatar = data["avatar"]
        m = PRESET_RE.match(avatar) if isinstance(avatar, str) else None
        if avatar == "" or (m and int(m.group(1)) < PRESET_COUNT):
            db.execute("UPDATE users SET avatar = ?, avatar_updated = ? WHERE id = ?", (avatar, now(), uid))
        elif avatar == "upload" and db.execute("SELECT 1 FROM avatars WHERE user_id = ?", (uid,)).fetchone():
            db.execute("UPDATE users SET avatar = 'upload' WHERE id = ?", (uid,))
        else:
            return err("Invalid avatar.")
    db.commit()
    return jsonify(user=user_json(fresh_user(uid)))


@bp.post("/api/me/avatar")
@login_required
def upload_avatar():
    uid = current_user()["id"]
    raw = decode_jpeg((request.get_json(silent=True) or {}).get("image"), MAX_AVATAR_BYTES)
    if raw is None:
        return err("Upload a JPEG image under 60 KB.")
    db = get_db()
    t = now()
    db.execute("INSERT OR REPLACE INTO avatars (user_id, data, updated_at) VALUES (?,?,?)", (uid, raw, t))
    db.execute("UPDATE users SET avatar = 'upload', avatar_updated = ? WHERE id = ?", (t, uid))
    db.commit()
    return jsonify(user=user_json(fresh_user(uid)))


@bp.get("/api/avatar/<username>")
def avatar_image(username):
    row = get_db().execute(
        "SELECT a.data FROM avatars a JOIN users u ON u.id = a.user_id WHERE u.username = ?", (username,)
    ).fetchone()
    if row is None:
        return err("No avatar.", 404)
    resp = Response(row["data"], mimetype="image/jpeg")
    resp.headers["Cache-Control"] = "private, max-age=86400"
    return resp


@bp.post("/api/me/password")
@login_required
def change_password():
    uid = current_user()["id"]
    data = request.get_json(silent=True) or {}
    current = data.get("current") if isinstance(data.get("current"), str) else ""
    new = data.get("new") if isinstance(data.get("new"), str) else ""
    db = get_db()
    row = db.execute("SELECT password_hash FROM users WHERE id = ?", (uid,)).fetchone()
    if not check_password_hash(row["password_hash"], current):
        return err("Your current password is wrong.", 403, field="current")
    if not 8 <= len(new) <= 128:
        return err("The new password must be at least 8 characters.", field="new")
    db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (generate_password_hash(new), uid))
    db.commit()
    return jsonify(ok=True)
