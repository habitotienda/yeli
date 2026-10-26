"""Live chat and stickers."""
import re

from flask import Blueprint, jsonify, request

from . import config, economy
from .config import *
from .core import *
from .db import get_db
from .bot import BOT_NAME, chat_settings, moderate, post_bot, post_tts, run_command
from .moderation import is_mod
from .queries import *

bp = Blueprint("chat", __name__)


def chat_json(row, channel_id):
    bot = row["kind"] == "bot"
    return {
        "id": row["id"],
        "user": BOT_NAME if bot else row["username"],
        "hue": 200 if bot else avatar_hue(row["username"]),
        "text": row["text"],
        "ts": row["created_at"],
        "owner": row["user_id"] == channel_id and not bot,
        "badge": 0 if bot or "badge" not in row.keys() else economy.level_value("badge", row["badge"]),
        "color": "" if bot or "name_color" not in row.keys() else row["name_color"],
        "mod": bool("is_mod" in row.keys() and row["is_mod"]) and not bot,
        "kind": row["kind"],
        "sticker": row["sticker"],
        "amount": row["amount"],
    }


def channel_row(username):
    return get_db().execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()


CHAT_BASE = """SELECT m.id, m.text, m.created_at, m.user_id, m.kind, m.sticker, m.amount, u.username,
               u.name_color,
               EXISTS(SELECT 1 FROM chat_mods cm WHERE cm.channel_id = m.channel_id AND cm.user_id = m.user_id) AS is_mod,
               COALESCE((SELECT level FROM upgrades up WHERE up.user_id = m.user_id AND up.track = 'badge'), 0) AS badge
               FROM chat_messages m JOIN users u ON u.id = m.user_id
               WHERE m.channel_id = ? AND m.deleted = 0 AND m.id > ?"""


@bp.get("/api/chat/<username>")
def chat_poll(username):
    channel = channel_row(username)
    if channel is None:
        return err("Channel not found.", 404)
    db = get_db()
    after = int_arg("after")
    since = int_arg("since")
    if after == 0:
        rows = db.execute(
            f"SELECT * FROM ({CHAT_BASE} ORDER BY m.id DESC LIMIT 50) ORDER BY id", (channel["id"], 0)
        ).fetchall()
    else:
        rows = db.execute(f"{CHAT_BASE} ORDER BY m.id LIMIT 100", (channel["id"], after)).fetchall()
    removed = []
    if since:
        removed = [
            r["id"]
            for r in db.execute(
                "SELECT id FROM chat_messages WHERE channel_id = ? AND deleted = 1 AND deleted_at >= ?",
                (channel["id"], since - 1),
            )
        ]
    st = chat_settings(db, channel["id"])
    return jsonify(messages=[chat_json(r, channel["id"]) for r in rows], removed=removed, t=now(),
                   tts_lang=st["tts_lang"] if st["tts_enabled"] else None)


@bp.post("/api/chat/<username>")
@login_required
def chat_send(username):
    me_row = current_user()
    channel = channel_row(username)
    if channel is None:
        return err("Channel not found.", 404)
    data = request.get_json(silent=True) or {}
    sticker = data.get("sticker")
    if sticker is not None:
        if not isinstance(sticker, str) or sticker not in economy.STICKERS:
            return err("Unknown sticker.")
        if economy.STICKERS[sticker] > 0:
            return err("That sticker costs Yelis.", 402)
        kind, text = "sticker", ""
    else:
        kind, sticker = "msg", ""
        text = " ".join(text_field(data, "text", CHAT_MAX_LEN * 2).split())[:CHAT_MAX_LEN]
        if not text:
            return err("Write a message first.")
    db = get_db()
    t = now()
    recent = db.execute(
        "SELECT COUNT(*) AS n FROM chat_messages WHERE user_id = ? AND created_at >= ? AND kind IN ('msg', 'sticker')", (me_row["id"], t - 10)
    ).fetchone()["n"]
    if recent >= 6:
        return err("You're sending messages too fast. Wait a few seconds.", 429)
    blocked = moderate(db, channel["id"], me_row["id"], text)
    if blocked:
        return err(blocked[0], blocked[1])
    cur = db.execute(
        "INSERT INTO chat_messages (channel_id, user_id, text, created_at, kind, sticker) VALUES (?,?,?,?,?,?)",
        (channel["id"], me_row["id"], text, t, kind, sticker),
    )
    db.execute(
        "DELETE FROM chat_messages WHERE channel_id = ? AND id <= ?", (channel["id"], cur.lastrowid - CHAT_KEEP)
    )
    db.commit()
    row = {"id": cur.lastrowid, "text": text, "created_at": t, "user_id": me_row["id"], "username": me_row["username"],
           "kind": kind, "sticker": sticker, "amount": 0,
           "badge": user_level(db, me_row["id"], "badge"), "name_color": me_row["name_color"],
           "is_mod": 1 if is_mod(db, channel["id"], me_row["id"]) else 0}
    replies = []
    if kind == "msg" and text.startswith("!"):
        out = run_command(db, channel["id"], me_row, text)
        if out and out[0] == "tts":  # read aloud by the viewers' browsers
            tid = post_tts(db, channel["id"], me_row["id"], out[1])
            db.commit()
            replies.append(chat_json({"id": tid, "text": out[1], "created_at": now(), "user_id": me_row["id"],
                                      "username": me_row["username"], "kind": "tts", "sticker": "", "amount": 0,
                                      "name_color": me_row["name_color"]}, channel["id"]))
        elif out:
            bot_id = post_bot(db, channel["id"], out[1])
            db.commit()
            replies.append(chat_json({"id": bot_id, "text": out[1][:300], "created_at": now(), "user_id": channel["id"],
                                      "username": BOT_NAME, "kind": "bot", "sticker": "", "amount": 0}, channel["id"]))
    return jsonify(message=chat_json(row, channel["id"]), bot=replies), 201


@bp.post("/api/chat/<username>/delete")
@login_required
def chat_delete(username):
    me_row = current_user()
    channel = channel_row(username)
    if channel is None:
        return err("Channel not found.", 404)
    try:
        msg_id = int((request.get_json(silent=True) or {}).get("id"))
    except (TypeError, ValueError):
        return err("Invalid message.")
    db = get_db()
    msg = db.execute(
        "SELECT user_id FROM chat_messages WHERE id = ? AND channel_id = ?", (msg_id, channel["id"])
    ).fetchone()
    if msg is None:
        return err("Message not found.", 404)
    if me_row["id"] not in (channel["id"], msg["user_id"]) and not is_mod(db, channel["id"], me_row["id"]):
        return err("You can't remove that message.", 403)
    db.execute("UPDATE chat_messages SET deleted = 1, deleted_at = ? WHERE id = ?", (now(), msg_id))
    db.commit()
    return jsonify(ok=True)
