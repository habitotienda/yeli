"""Home page and browsing: live list, categories, search, channels, following."""

import math
import random

from flask import Blueprint, jsonify, render_template, request

from . import config, economy
from .config import *
from .core import *
from .db import get_db
from .alerts import add_event
from .bot import chat_settings, post_bot, render
from .moderation import is_mod
from .cache import cached_json
from .queries import *

bp = Blueprint("channels", __name__)


@bp.get("/")
def index():
    return render_template("index.html")




@bp.get("/api/categories")
@cached_json
def categories():
    rows = get_db().execute(
        "SELECT category, COUNT(*) AS n FROM streams WHERE is_live = 1 AND last_seen >= ? GROUP BY category",
        (now() - LIVE_TIMEOUT,),
    ).fetchall()
    counts = {r["category"]: r["n"] for r in rows}
    return jsonify(categories=[{"name": c, "live": counts.get(c, 0)} for c in CATEGORIES])


@bp.get("/api/live")
@cached_json
def live():
    category = (request.args.get("category") or "").strip()
    where = f"WHERE {LIVE_COND}"
    params = {}
    if category in CATEGORIES:
        where += " AND s.category = :cat"
        params["cat"] = category
    rows = query_channels(where, params, "ORDER BY viewers DESC, followers DESC, s.started_at DESC", 48)
    return jsonify(streams=[channel_json(r) for r in rows])


@bp.get("/api/channels")
@cached_json
def channels():
    rows = query_channels("", None, "ORDER BY live DESC, followers DESC, u.created_at DESC", 48)
    return jsonify(channels=[channel_json(r) for r in rows])


@bp.get("/api/search")
def search():
    q = (request.args.get("q") or "").strip()[:50]
    limit = min(max(int_arg("limit", 24), 1), 48)
    if not q:
        return jsonify(query=q, results=[])
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    where = (
        "WHERE u.username LIKE :like ESCAPE '\\' "
        f"OR ({LIVE_COND} AND (s.title LIKE :like ESCAPE '\\' OR s.category LIKE :like ESCAPE '\\'))"
    )
    order = "ORDER BY live DESC, (u.username LIKE :prefix ESCAPE '\\') DESC, followers DESC, u.username"
    rows = query_channels(where, {"like": f"%{escaped}%", "prefix": f"{escaped}%"}, order, limit)
    return jsonify(query=q, results=[channel_json(r) for r in rows])


@bp.get("/api/following")
@login_required
def following():
    where = "WHERE u.id IN (SELECT followed_id FROM follows WHERE follower_id = :me)"
    rows = query_channels(where, {"me": current_user()["id"]}, "ORDER BY live DESC, u.username COLLATE NOCASE", 200)
    return jsonify(channels=[channel_json(r) for r in rows])


@bp.get("/api/channel/<username>")
def channel(username):
    rows = query_channels("WHERE u.username = :name", {"name": username}, "", 1)
    if not rows:
        return err("Channel not found.", 404)
    row = rows[0]
    out = channel_json(row)
    me_row = current_user()
    out["is_me"] = bool(me_row and me_row["id"] == row["id"])
    out["is_mod"] = bool(me_row and is_mod(get_db(), row["id"], me_row["id"]))
    out["following"] = bool(
        me_row
        and get_db().execute(
            "SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?", (me_row["id"], row["id"])
        ).fetchone()
    )
    return jsonify(channel=out)


@bp.post("/api/follow/<username>")
@login_required
def follow(username):
    db = get_db()
    me_row = current_user()
    target = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if target is None:
        return err("Channel not found.", 404)
    if target["id"] == me_row["id"]:
        return err("You can't follow your own channel.", 400)

    want = bool((request.get_json(silent=True) or {}).get("follow", True))
    if want:
        added = db.execute(
            "INSERT OR IGNORE INTO follows (follower_id, followed_id, created_at) VALUES (?,?,?)",
            (me_row["id"], target["id"], now()),
        ).rowcount == 1
        st = chat_settings(db, target["id"])
        if added:
            add_event(db, target["id"], "follow", me_row["username"])
        if added and st["welcome"]:
            post_bot(db, target["id"], render(st["welcome_text"], {"user": me_row["username"], "channel": username}))
    else:
        db.execute("DELETE FROM follows WHERE follower_id = ? AND followed_id = ?", (me_row["id"], target["id"]))
    db.commit()
    followers = db.execute("SELECT COUNT(*) AS n FROM follows WHERE followed_id = ?", (target["id"],)).fetchone()["n"]
    return jsonify(following=want, followers=followers)


@bp.get("/api/recommended")
@cached_json
def recommended():
    """Live channels first; the Recommendation upgrade adds weight and also promotes offline channels."""
    rows = query_channels("", None, "ORDER BY live DESC, followers DESC", 200)
    rng = random.Random(now() // 60)  # the order is stable for a minute
    scored = []
    for r in rows:
        live = bool(r["live"])
        if not live and r["boost"] == 0:
            continue
        weight = economy.level_value("boost", r["boost"])
        score = weight * (0.5 + rng.random()) + ((5 + 2 * math.log(r["viewers"] + 1)) if live else 0)
        scored.append((score, channel_json(r)))
    scored.sort(key=lambda x: -x[0])
    return jsonify(channels=[c for _, c in scored[:6]])
