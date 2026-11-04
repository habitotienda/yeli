"""Daily chest: watch live streams for an hour in a day and the chest unlocks; opening it gives one random reward.

Rewards (weights in economy.CHEST_WEIGHTS, shown to the player on the chest page):
  sticker  an exclusive sticker the account can then send in any chat for free
  color    a chat name color the account can use without the Chat name color upgrade
  points   one upgrade point (the rare one, because points are worth Yelis)

Rules, because a reward is worth something:
  * only logged-in accounts earn time, and only while watching somebody else's live stream
  * time counts while the viewer's page keeps sending heartbeats (gaps longer than SESSION_GAP count for nothing)
    and is shared between streams, so watching two streams at once doesn't double it
  * the account can't be on the streamer's network (new accounts can earn the chest from the very first second)
  * one chest per account per UTC day; the day resets at 00:00 UTC
"""
import secrets

from flask import Blueprint, jsonify

from . import config, economy
from .core import *
from .db import get_db
from .rewards import SESSION_GAP

bp = Blueprint("chest", __name__)


def day_of(t):
    return t // 86400


def owned(db, uid, kind):
    return [r["value"] for r in db.execute("SELECT value FROM chest_items WHERE user_id = ? AND kind = ? ORDER BY got_at", (uid, kind))]


def owned_colors(db, uid):
    return owned(db, uid, "color")


def owns_sticker(db, uid, sticker):
    return db.execute("SELECT 1 FROM chest_items WHERE user_id = ? AND kind = 'sticker' AND value = ?", (uid, sticker)).fetchone() is not None


def _opened_today(db, uid, day):
    return db.execute("SELECT kind, value FROM chest_opens WHERE user_id = ? AND day = ?", (uid, day)).fetchone()


def _summary(seconds, opened, t, **extra):
    needed = economy.CHEST_SECONDS
    return {
        "seconds": min(seconds, needed), "needed": needed,
        "ready": seconds >= needed and opened is None,
        "opened": opened is not None, "resets_in": 86400 - t % 86400, **extra,
    }


def tick(db, streamer_id, user_id, ip, t):
    """Called on every viewer heartbeat. Adds the time since the last one and returns the viewer's progress (or None for guests)."""
    if not user_id or user_id == streamer_id:
        return None
    day = day_of(t)
    row = db.execute("SELECT seconds, last_tick FROM chest_progress WHERE user_id = ? AND day = ?", (user_id, day)).fetchone()
    seconds = row["seconds"] if row else 0
    stream = db.execute("SELECT ip FROM streams WHERE user_id = ?", (streamer_id,)).fetchone()
    reason = None
    if stream and stream["ip"] and stream["ip"] == ip:
        reason = "network"
    if reason is None and seconds < economy.CHEST_SECONDS:
        if row is None:
            db.execute("INSERT INTO chest_progress (user_id, day, seconds, last_tick) VALUES (?,?,0,?)", (user_id, day, t))
        else:
            delta = t - row["last_tick"]
            if delta > 0:
                if delta <= SESSION_GAP:
                    seconds = min(economy.CHEST_SECONDS, seconds + delta)
                db.execute("UPDATE chest_progress SET seconds = ?, last_tick = ? WHERE user_id = ? AND day = ?", (seconds, t, user_id, day))
    opened = _opened_today(db, user_id, day) if seconds >= economy.CHEST_SECONDS else None
    return _summary(seconds, opened, t, **({"blocked": reason} if reason else {}))


def _roll(db, uid):
    """Pick the reward. Kinds the account has completely collected are skipped; upgrade points never run out."""
    sticker_left = [s for s in economy.CHEST_STICKERS if s not in set(owned(db, uid, "sticker"))]
    color_left = [c for c in economy.CHEST_COLORS if c not in set(owned_colors(db, uid))]
    pool = {"points": (economy.CHEST_WEIGHTS["points"], ["1"])}
    if sticker_left:
        pool["sticker"] = (economy.CHEST_WEIGHTS["sticker"], sticker_left)
    if color_left:
        pool["color"] = (economy.CHEST_WEIGHTS["color"], color_left)
    total = sum(w for w, _ in pool.values())
    if total <= 0:  # only possible if the owner set the points weight to 0 and the account has everything
        return "points", "1"
    pick = secrets.randbelow(total)
    for kind, (weight, values) in pool.items():
        if pick < weight:
            return kind, secrets.choice(values)
        pick -= weight
    return "points", "1"


def collection(db, uid):
    return {
        "stickers": owned(db, uid, "sticker"), "colors": owned_colors(db, uid),
        "total_stickers": len(economy.CHEST_STICKERS), "total_colors": len(economy.CHEST_COLORS),
    }


@bp.get("/api/chest")
@login_required
def chest_state():
    me_row = current_user()
    uid, t = me_row["id"], now()
    db = get_db()
    day = day_of(t)
    prog = db.execute("SELECT seconds FROM chest_progress WHERE user_id = ? AND day = ?", (uid, day)).fetchone()
    opened = _opened_today(db, uid, day)
    history = [
        {"kind": r["kind"], "value": r["value"], "at": r["opened_at"]}
        for r in db.execute("SELECT kind, value, opened_at FROM chest_opens WHERE user_id = ? ORDER BY id DESC LIMIT 7", (uid,))
    ]
    out = _summary(prog["seconds"] if prog else 0, opened, t)
    out.update(
        collection=collection(db, uid), history=history, color=me_row["name_color"],
        today=None if opened is None else {"kind": opened["kind"], "value": opened["value"]},
    )
    return jsonify(out)


@bp.post("/api/chest/open")
@login_required
def chest_open():
    uid, t = current_user()["id"], now()
    db = get_db()
    day = day_of(t)
    db.execute("BEGIN IMMEDIATE")
    if _opened_today(db, uid, day):
        db.rollback()
        return err("You already opened today's chest. A new one comes at 00:00 UTC.", 409, resets_in=86400 - t % 86400)
    prog = db.execute("SELECT seconds FROM chest_progress WHERE user_id = ? AND day = ?", (uid, day)).fetchone()
    seconds = prog["seconds"] if prog else 0
    if seconds < economy.CHEST_SECONDS:
        db.rollback()
        return err("The chest is still locked. Keep watching a live stream.", 403, seconds=seconds, needed=economy.CHEST_SECONDS)
    kind, value = _roll(db, uid)
    db.execute("INSERT INTO chest_opens (user_id, day, kind, value, opened_at) VALUES (?,?,?,?,?)", (uid, day, kind, value, t))
    if kind == "points":
        db.execute(
            "INSERT INTO upgrade_points (user_id, points) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET points = points + 1",
            (uid,),
        )
    else:
        db.execute("INSERT OR IGNORE INTO chest_items (user_id, kind, value, got_at) VALUES (?,?,?,?)", (uid, kind, value, t))
    db.commit()
    return jsonify(reward={"kind": kind, "value": value}, collection=collection(db, uid), resets_in=86400 - t % 86400), 201
