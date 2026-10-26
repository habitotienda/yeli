"""Free upgrade points: a viewer who keeps watching for an hour without leaving earns the streamer 1 point.

Because points are worth money, this has limits: the viewer must be a logged-in account (not the streamer, not on the
streamer's network, not brand new), each viewer can give a given streamer one point per day, and a streamer can earn
at most FREE_POINTS_PER_DAY a day.
"""
from . import config
from .core import *
from .db import get_db

SESSION_GAP = 60  # seconds between heartbeats that still count as "still watching"


def touch_session(db, streamer_id, key, user_id, ip, t):
    """Called on each viewer heartbeat. Starts a new session when the viewer had left, and awards the point at one hour."""
    started = db.execute("SELECT started_at FROM streams WHERE user_id = ?", (streamer_id,)).fetchone()
    stream_started = started["started_at"] if started and started["started_at"] else 0
    row = db.execute(
        "SELECT id, started_at, last_seen, awarded, stream_started FROM watch_sessions WHERE streamer_id = ? AND viewer_key = ?",
        (streamer_id, key),
    ).fetchone()
    if row is None or t - row["last_seen"] > SESSION_GAP or row["stream_started"] != stream_started:
        if row is None:
            db.execute(
                "INSERT INTO watch_sessions (streamer_id, viewer_key, user_id, ip, started_at, last_seen, awarded, stream_started) VALUES (?,?,?,?,?,?,0,?)",
                (streamer_id, key, user_id, ip, t, t, stream_started),
            )
        else:
            db.execute(
                "UPDATE watch_sessions SET user_id = ?, ip = ?, started_at = ?, last_seen = ?, awarded = 0, stream_started = ? WHERE id = ?",
                (user_id, ip, t, t, stream_started, row["id"]),
            )
        return False
    db.execute("UPDATE watch_sessions SET last_seen = ? WHERE id = ?", (t, row["id"]))
    if not row["awarded"] and user_id and t - row["started_at"] >= config.FREE_POINT_SECONDS:
        return award(db, streamer_id, key, user_id, ip, row["id"], t)
    return False


def award(db, streamer_id, key, user_id, ip, session_id, t):
    if user_id == streamer_id:
        return False
    streamer = db.execute("SELECT ip FROM streams WHERE user_id = ?", (streamer_id,)).fetchone()
    if streamer and streamer["ip"] and streamer["ip"] == ip:
        return False
    viewer = db.execute("SELECT created_at FROM users WHERE id = ?", (user_id,)).fetchone()
    if viewer is None or t - viewer["created_at"] < config.FREE_POINT_MIN_ACCOUNT_AGE:
        return False
    today = db.execute("SELECT COUNT(*) FROM free_points WHERE user_id = ? AND created_at >= ?", (streamer_id, t - 86400)).fetchone()[0]
    if today >= config.FREE_POINTS_PER_DAY:
        return False
    if db.execute("SELECT 1 FROM free_points WHERE user_id = ? AND viewer_key = ? AND created_at >= ?", (streamer_id, key, t - 86400)).fetchone():
        return False
    db.execute("INSERT INTO free_points (user_id, viewer_key, created_at, notified) VALUES (?,?,?,0)", (streamer_id, key, t))
    db.execute(
        "INSERT INTO upgrade_points (user_id, points) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET points = points + 1",
        (streamer_id,),
    )
    db.execute("UPDATE watch_sessions SET awarded = 1 WHERE id = ?", (session_id,))
    return True


def progress_for_streamer(db, streamer_id, t):
    """(points just earned and not yet announced, seconds until the next free point or None)."""
    fresh = db.execute("SELECT COUNT(*) FROM free_points WHERE user_id = ? AND notified = 0", (streamer_id,)).fetchone()[0]
    if fresh:
        db.execute("UPDATE free_points SET notified = 1 WHERE user_id = ? AND notified = 0", (streamer_id,))
    best = db.execute(
        """SELECT MAX(last_seen - started_at) AS span FROM watch_sessions
           WHERE streamer_id = ? AND user_id IS NOT NULL AND user_id != ? AND awarded = 0 AND last_seen >= ?""",
        (streamer_id, streamer_id, t - SESSION_GAP),
    ).fetchone()["span"]
    today = db.execute("SELECT COUNT(*) FROM free_points WHERE user_id = ? AND created_at >= ?", (streamer_id, t - 86400)).fetchone()[0]
    eta = None if best is None or today >= config.FREE_POINTS_PER_DAY else max(0, config.FREE_POINT_SECONDS - best)
    return fresh, eta, today
