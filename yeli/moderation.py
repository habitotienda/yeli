"""Chat moderation: moderators and bans (the owner and the channel's moderators can ban; only the owner picks moderators)."""
from flask import Blueprint, jsonify, request

from .core import *
from .db import get_db
from .queries import *

bp = Blueprint("moderation", __name__)


def is_mod(db, channel_id, user_id):
    return bool(db.execute("SELECT 1 FROM chat_mods WHERE channel_id = ? AND user_id = ?", (channel_id, user_id)).fetchone())


def can_moderate(db, channel_id, user_id):
    return user_id == channel_id or is_mod(db, channel_id, user_id)


def active_ban(db, channel_id, user_id):
    """The ban row if this user is currently banned from the channel's chat, else None."""
    return db.execute(
        "SELECT until, reason FROM chat_bans WHERE channel_id = ? AND user_id = ? AND (until = 0 OR until > ?)",
        (channel_id, user_id, now()),
    ).fetchone()


def user_row(db, name):
    return db.execute("SELECT id, username FROM users WHERE username = ?", (name,)).fetchone()


def channel_by_name(db, name):
    return db.execute("SELECT id, username FROM users WHERE username = ?", (name,)).fetchone()


def listing(db, channel_id):
    bans = db.execute(
        """SELECT u.username, b.until, b.reason, b.created_at, m.username AS by_name
           FROM chat_bans b JOIN users u ON u.id = b.user_id JOIN users m ON m.id = b.by_user
           WHERE b.channel_id = ? AND (b.until = 0 OR b.until > ?) ORDER BY b.created_at DESC""",
        (channel_id, now()),
    ).fetchall()
    mods = db.execute(
        "SELECT u.username FROM chat_mods c JOIN users u ON u.id = c.user_id WHERE c.channel_id = ? ORDER BY u.username",
        (channel_id,),
    ).fetchall()
    return {"bans": [dict(r) for r in bans], "mods": [r["username"] for r in mods]}


@bp.get("/api/mod/<channel>")
@login_required
def mod_state(channel):
    me_row = current_user()
    db = get_db()
    ch = channel_by_name(db, channel)
    if ch is None:
        return err("Channel not found.", 404)
    if not can_moderate(db, ch["id"], me_row["id"]):
        return err("Only the streamer and their moderators can do that.", 403)
    return jsonify(channel=ch["username"], is_owner=ch["id"] == me_row["id"], **listing(db, ch["id"]))


@bp.get("/api/mod/channels")
@login_required
def my_mod_channels():
    """Channels where I'm a moderator (for the moderation page)."""
    rows = get_db().execute(
        "SELECT u.username FROM chat_mods c JOIN users u ON u.id = c.channel_id WHERE c.user_id = ? ORDER BY u.username",
        (current_user()["id"],),
    ).fetchall()
    return jsonify(channels=[r["username"] for r in rows])


@bp.post("/api/mod/<channel>/ban")
@login_required
def ban(channel):
    me_row = current_user()
    db = get_db()
    ch = channel_by_name(db, channel)
    if ch is None:
        return err("Channel not found.", 404)
    if not can_moderate(db, ch["id"], me_row["id"]):
        return err("Only the streamer and their moderators can do that.", 403)
    d = request.get_json(silent=True) or {}
    target = user_row(db, text_field(d, "user", 40))
    minutes = d.get("minutes", 0)
    if target is None:
        return err("That user doesn't exist.", 404, field="user")
    if target["id"] == ch["id"]:
        return err("You can't ban the streamer.")
    if target["id"] == me_row["id"]:
        return err("You can't ban yourself.")
    if is_mod(db, ch["id"], target["id"]) and me_row["id"] != ch["id"]:
        return err("Only the streamer can ban a moderator.", 403)
    if isinstance(minutes, bool) or not isinstance(minutes, int) or not 0 <= minutes <= 60 * 24 * 365:
        return err("Choose how long the ban lasts (minutes, 0 = permanent).")
    until = 0 if minutes == 0 else now() + minutes * 60
    reason = text_field(d, "reason", 120)
    db.execute(
        """INSERT INTO chat_bans (channel_id, user_id, until, reason, by_user, created_at) VALUES (?,?,?,?,?,?)
           ON CONFLICT(channel_id, user_id) DO UPDATE SET until = excluded.until, reason = excluded.reason,
               by_user = excluded.by_user, created_at = excluded.created_at""",
        (ch["id"], target["id"], until, reason, me_row["id"], now()),
    )
    db.execute("DELETE FROM chat_mods WHERE channel_id = ? AND user_id = ?", (ch["id"], target["id"]))
    if d.get("purge"):  # also hide what they already wrote; clients drop the messages on their next poll
        db.execute(
            "UPDATE chat_messages SET deleted = 1, deleted_at = ? WHERE channel_id = ? AND user_id = ? AND deleted = 0",
            (now(), ch["id"], target["id"]),
        )
    db.commit()
    return jsonify(**listing(db, ch["id"]))


@bp.post("/api/mod/<channel>/unban")
@login_required
def unban(channel):
    me_row = current_user()
    db = get_db()
    ch = channel_by_name(db, channel)
    if ch is None:
        return err("Channel not found.", 404)
    if not can_moderate(db, ch["id"], me_row["id"]):
        return err("Only the streamer and their moderators can do that.", 403)
    target = user_row(db, text_field(request.get_json(silent=True) or {}, "user", 40))
    if target:
        db.execute("DELETE FROM chat_bans WHERE channel_id = ? AND user_id = ?", (ch["id"], target["id"]))
        db.commit()
    return jsonify(**listing(db, ch["id"]))


MAX_MODS = 20


@bp.post("/api/mods/add")
@login_required
def add_mod():
    me_row = current_user()
    db = get_db()
    target = user_row(db, text_field(request.get_json(silent=True) or {}, "user", 40))
    if target is None:
        return err("That user doesn't exist.", 404, field="user")
    if target["id"] == me_row["id"]:
        return err("You're already the streamer.")
    if db.execute("SELECT COUNT(*) FROM chat_mods WHERE channel_id = ?", (me_row["id"],)).fetchone()[0] >= MAX_MODS:
        return err(f"You can have up to {MAX_MODS} moderators.")
    db.execute("INSERT OR IGNORE INTO chat_mods (channel_id, user_id, created_at) VALUES (?,?,?)", (me_row["id"], target["id"], now()))
    db.execute("DELETE FROM chat_bans WHERE channel_id = ? AND user_id = ?", (me_row["id"], target["id"]))  # a moderator isn't banned
    db.commit()
    return jsonify(**listing(db, me_row["id"]))


@bp.post("/api/mods/remove")
@login_required
def remove_mod():
    me_row = current_user()
    db = get_db()
    target = user_row(db, text_field(request.get_json(silent=True) or {}, "user", 40))
    if target:
        db.execute("DELETE FROM chat_mods WHERE channel_id = ? AND user_id = ?", (me_row["id"], target["id"]))
        db.commit()
    return jsonify(**listing(db, me_row["id"]))
