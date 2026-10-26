"""Going live and watching: stream lifecycle, thumbnails and peer-to-peer signaling."""

from flask import Blueprint, Response, current_app, jsonify, request

from . import config, economy
from .config import *
from .core import *
from .db import get_db
from . import rewards
from .bot import run_timers
from .queries import *

bp = Blueprint("streaming", __name__)


@bp.post("/api/stream/start")
@login_required
def stream_start():
    me_row = current_user()
    data = request.get_json(silent=True) or {}
    title = text_field(data, "title", 80) or f"{me_row['username']}'s stream"
    category = text_field(data, "category", 40)
    if category not in CATEGORIES:
        category = "Other"
    mode = data.get("mode", "p2p")
    if mode not in ("p2p", "sfu"):
        return err("Unknown stream mode.")
    if mode == "sfu" and not config.MEDIA_URL:
        return err("This server has no media server configured.")
    t = now()
    db = get_db()
    db.execute(
        """INSERT INTO streams (user_id, is_live, title, category, started_at, last_seen, mode, ip)
           VALUES (?,1,?,?,?,?,?,?)
           ON CONFLICT(user_id) DO UPDATE SET is_live = 1, title = excluded.title,
               category = excluded.category, started_at = excluded.started_at,
               last_seen = excluded.last_seen, mode = excluded.mode, ip = excluded.ip""",
        (me_row["id"], title, category, t, t, mode, request.remote_addr or ""),
    )
    db.execute("DELETE FROM viewers WHERE streamer_id = ?", (me_row["id"],))
    db.execute("DELETE FROM signals WHERE to_key = ?", (f"u:{me_row['id']}",))
    db.execute("DELETE FROM thumbnails WHERE user_id = ?", (me_row["id"],))
    db.commit()
    return jsonify(ok=True, title=title, category=category, started_at=t, mode=mode)


@bp.post("/api/stream/stop")
@login_required
def stream_stop():
    uid = current_user()["id"]
    db = get_db()
    db.execute("UPDATE streams SET is_live = 0 WHERE user_id = ?", (uid,))
    db.execute("DELETE FROM viewers WHERE streamer_id = ?", (uid,))
    db.execute("DELETE FROM signals WHERE to_key = ?", (f"u:{uid}",))
    db.execute("DELETE FROM thumbnails WHERE user_id = ?", (uid,))
    db.commit()
    return jsonify(ok=True)


@bp.get("/api/stream/poll")
@login_required
def stream_poll():
    """Heartbeat + inbox of the broadcaster."""
    uid = current_user()["id"]
    db = get_db()
    row = db.execute("SELECT is_live FROM streams WHERE user_id = ?", (uid,)).fetchone()
    if row is None or not row["is_live"]:
        return jsonify(live=False)

    t = now()
    key = f"u:{uid}"
    db.execute("UPDATE streams SET last_seen = ? WHERE user_id = ?", (t, uid))
    run_timers(db, uid)  # auto-posted bot messages
    fresh_points, free_eta, free_today = rewards.progress_for_streamer(db, uid, t)

    # Viewers that stopped polling (closed tab, lost connection): tell the broadcaster to drop them.
    stale = db.execute(
        "SELECT peer_id FROM viewers WHERE streamer_id = ? AND last_seen < ?", (uid, t - VIEWER_TIMEOUT)
    ).fetchall()
    for v in stale:
        db.execute("DELETE FROM viewers WHERE peer_id = ?", (v["peer_id"],))
        push_signal(key, f"p:{v['peer_id']}", "leave", {})
    db.execute("DELETE FROM signals WHERE created_at < ?", (t - 120,))

    signals = read_signals(key, int_arg("after"))
    viewers = count_viewers(db, uid, t - VIEWER_TIMEOUT)
    db.commit()
    return jsonify(live=True, signals=signals, viewers=viewers, free_points=fresh_points, free_eta=free_eta,
                   free_today=free_today, free_cap=config.FREE_POINTS_PER_DAY)


@bp.post("/api/stream/thumbnail")
@login_required
def stream_thumbnail():
    """The broadcaster's browser sends a small JPEG snapshot every few seconds."""
    uid = current_user()["id"]
    raw = decode_jpeg((request.get_json(silent=True) or {}).get("image"), MAX_THUMB_BYTES)
    if raw is None:
        return err("Invalid image.")
    db = get_db()
    row = db.execute("SELECT is_live FROM streams WHERE user_id = ?", (uid,)).fetchone()
    if row is None or not row["is_live"]:
        return err("You are not live.", 409)
    db.execute(
        "INSERT OR REPLACE INTO thumbnails (user_id, data, updated_at) VALUES (?,?,?)", (uid, raw, now())
    )
    db.commit()
    return jsonify(ok=True)


@bp.get("/api/thumb/<username>")
def thumbnail(username):
    row = get_db().execute(
        """SELECT t.data FROM thumbnails t JOIN users u ON u.id = t.user_id
           JOIN streams s ON s.user_id = u.id
           WHERE u.username = ? AND s.is_live = 1""",
        (username,),
    ).fetchone()
    if row is None:
        return err("No thumbnail.", 404)
    resp = Response(row["data"], mimetype="image/jpeg")
    resp.headers["Cache-Control"] = "private, max-age=300"
    return resp


@bp.post("/api/stream/signal")
@login_required
def stream_signal():
    """Broadcaster -> viewer (offer / ICE candidate)."""
    uid = current_user()["id"]
    data = request.get_json(silent=True) or {}
    peer = text_field(data, "peer", 64)
    kind = data.get("kind")
    payload = signal_payload(data)
    if not PEER_RE.match(peer) or kind not in ("offer", "candidate") or payload is None:
        return err("Invalid signal.")
    db = get_db()
    if not db.execute(
        "SELECT 1 FROM viewers WHERE peer_id = ? AND streamer_id = ?", (peer, uid)
    ).fetchone():
        return err("Viewer is gone.", 410)
    push_signal(f"p:{peer}", f"u:{uid}", kind, payload)
    db.commit()
    return jsonify(ok=True)


# --------------------------------------------------------------------------
# Watching (called by viewers; no account needed)
# --------------------------------------------------------------------------
@bp.post("/api/watch/<username>/join")
def watch_join(username):
    peer = text_field(request.get_json(silent=True) or {}, "peer", 64)
    if not PEER_RE.match(peer):
        return err("Invalid viewer id.")
    streamer = live_streamer_id(username)
    if streamer is None:
        return err("This channel isn't live.", 404)
    key, user_id, fresh_cookie = viewer_identity()
    db = get_db()
    sfu = stream_mode(db, streamer) == "sfu"  # media server: no per-viewer signaling with the streamer
    cap = config.MAX_VIEWERS_SFU if sfu else config.MAX_VIEWERS
    t = now()
    ip = request.remote_addr or ""
    active = t - VIEWER_TIMEOUT

    already = db.execute(
        "SELECT 1 FROM viewers WHERE streamer_id = ? AND viewer_key = ? AND superseded = 0 AND last_seen >= ?",
        (streamer, key, active),
    ).fetchone()
    if not already and key != f"u{streamer}":
        if count_viewers(db, streamer, active) >= cap:
            return err("This stream is full right now.", 429)
        if user_id is None:
            same_net = db.execute(
                """SELECT COUNT(DISTINCT viewer_key) AS n FROM viewers WHERE streamer_id = ? AND superseded = 0
                   AND last_seen >= ? AND user_id IS NULL AND ip = ?""",
                (streamer, active, ip),
            ).fetchone()["n"]
            if same_net >= config.MAX_ANON_PER_IP:
                return err("Too many guests are watching from your network. Log in to join.", 429)

    # One connection per account: a newer tab replaces the older one instead of adding a viewer.
    older = db.execute(
        "SELECT peer_id FROM viewers WHERE streamer_id = ? AND viewer_key = ? AND superseded = 0 AND peer_id != ?",
        (streamer, key, peer),
    ).fetchall()
    for o in older:
        db.execute("UPDATE viewers SET superseded = 1 WHERE peer_id = ?", (o["peer_id"],))
        if not sfu:
            push_signal(f"u:{streamer}", f"p:{o['peer_id']}", "leave", {})
    db.execute(
        "INSERT OR REPLACE INTO viewers (peer_id, streamer_id, last_seen, viewer_key, user_id, superseded, ip) VALUES (?,?,?,?,?,0,?)",
        (peer, streamer, t, key, user_id, ip),
    )
    if not sfu:
        push_signal(f"u:{streamer}", f"p:{peer}", "join", {})
    db.commit()
    resp = jsonify(ok=True, replaced=bool(older))
    if fresh_cookie:
        resp.set_cookie("yv", fresh_cookie, max_age=60 * 60 * 24 * 365, httponly=True, samesite="Lax",
                        secure=current_app.config["SESSION_COOKIE_SECURE"])
    return resp


@bp.post("/api/watch/<username>/signal")
def watch_signal(username):
    """Viewer -> broadcaster (answer / ICE candidate)."""
    data = request.get_json(silent=True) or {}
    peer = text_field(data, "peer", 64)
    kind = data.get("kind")
    payload = signal_payload(data)
    if not PEER_RE.match(peer) or kind not in ("answer", "candidate", "quality") or payload is None:
        return err("Invalid signal.")
    db = get_db()
    row = db.execute(
        """SELECT v.streamer_id FROM viewers v JOIN users u ON u.id = v.streamer_id
           WHERE v.peer_id = ? AND u.username = ?""",
        (peer, username),
    ).fetchone()
    if row is None:
        return err("Not joined.", 410)
    push_signal(f"u:{row['streamer_id']}", f"p:{peer}", kind, payload)
    db.commit()
    return jsonify(ok=True)


@bp.get("/api/watch/<username>/poll")
def watch_poll(username):
    peer = request.args.get("peer", "")
    if not PEER_RE.match(peer):
        return err("Invalid viewer id.")
    db = get_db()
    row = db.execute(
        """SELECT u.id, COALESCE(s.is_live = 1 AND s.last_seen >= ?, 0) AS live
           FROM users u LEFT JOIN streams s ON s.user_id = u.id WHERE u.username = ?""",
        (now() - LIVE_TIMEOUT, username),
    ).fetchone()
    if row is None:
        return err("Channel not found.", 404)
    if not row["live"]:
        return jsonify(live=False)

    t = now()
    mine = db.execute("SELECT superseded FROM viewers WHERE peer_id = ? AND streamer_id = ?", (peer, row["id"])).fetchone()
    if mine is None:
        return jsonify(live=True, joined=False)
    if mine["superseded"]:  # the same account opened this stream in another tab
        return jsonify(live=True, joined=True, superseded=True)
    db.execute("UPDATE viewers SET last_seen = ? WHERE peer_id = ?", (t, peer))
    vkey, vuser, _ = viewer_identity()
    rewards.touch_session(db, row["id"], vkey, vuser, request.remote_addr or "", t)  # may earn the streamer a free point

    signals = read_signals(f"p:{peer}", int_arg("after"))
    viewers = count_viewers(db, row["id"], t - VIEWER_TIMEOUT)
    db.commit()
    return jsonify(live=True, joined=True, signals=signals, viewers=viewers)


@bp.post("/api/watch/<username>/leave")
def watch_leave(username):
    peer = text_field(request.get_json(silent=True) or {}, "peer", 64)
    if not PEER_RE.match(peer):
        return err("Invalid viewer id.")
    db = get_db()
    row = db.execute(
        """SELECT v.streamer_id FROM viewers v JOIN users u ON u.id = v.streamer_id
           WHERE v.peer_id = ? AND u.username = ?""",
        (peer, username),
    ).fetchone()
    if row:
        db.execute("DELETE FROM viewers WHERE peer_id = ?", (peer,))
        push_signal(f"u:{row['streamer_id']}", f"p:{peer}", "leave", {})
        db.commit()
    return jsonify(ok=True)
