"""Bring the chat of other platforms (Kick, TikTok, Twitch, YouTube...) into Yeli's chat, with the bot included.

A message that comes from outside shows in the chat with the platform's tag, appears in the chat overlay of the stream,
can be removed by the streamer and the moderators like any other, follows the channel's chat rules (blocked words, links,
capitals), and the bot answers its commands: custom commands, !dice, !8ball... and the voice (!say) which goes into
the stream. The bot's reply appears in Yeli's chat; the webhook also returns it, so a tool that can post to the other chat
can say it there.

Two ways in:
  * Twitch is read directly: an anonymous, read-only IRC connection to the channel the streamer names (no account needed).
  * Everything else (TikTok, Kick, YouTube...) arrives through a private webhook link: the streamer pastes it into any tool
    that listens to that platform's chat and can call a URL, and it sends {"platform": "tiktok", "user": "ana", "text": "hola"}.
    Kick and TikTok don't offer a public way to read their chat that works without logging in as the streamer, which is why
    the connection is made by a tool the streamer already uses.
"""
import random
import re
import secrets
import socket
import ssl
import threading
import time
import zlib
from collections import deque

from flask import Blueprint, jsonify, request

from . import config
from .config import CHAT_KEEP, CHAT_MAX_LEN
from .core import *
from .db import connect as db_connect, get_db
from .bot import chat_settings, post_bot, run_command, text_rules

bp = Blueprint("bridge", __name__)

TWITCH_RE = re.compile(r"^[a-z0-9_]{3,25}$")
IRC_MSG = re.compile(r"^(?:@\S+ )?:([^!\s]+)![^ ]+ PRIVMSG #[^ ]+ :(.*)$")
STALE_AFTER = 60

_flood = {}  # channel id -> times of its latest messages from outside


def clean_name(name):
    name = re.sub(r"[\x00-\x1f\x7f<>]", "", str(name or "")).strip()
    return name[:25] or "viewer"


def clean_platform(platform):
    platform = str(platform or "").strip().lower()
    return platform if re.fullmatch(r"[a-z0-9]{1,12}", platform) else "other"


def ingest(db, channel_id, platform, name, text):
    """Add a message from another platform to the chat and run the bot on it. Returns the bot's reply text ('' if none)
    or None when the message was dropped (empty, too fast, or against the chat rules)."""
    text = " ".join(str(text or "").split())[:CHAT_MAX_LEN]
    if not text:
        return None
    name, platform = clean_name(name), clean_platform(platform)
    t = time.monotonic()
    recent = _flood.setdefault(channel_id, deque())
    while recent and t - recent[0] > 10:
        recent.popleft()
    if len(recent) >= 40:  # a flood from outside must not bury the chat or fill the database
        return None
    recent.append(t)
    if text_rules(chat_settings(db, channel_id), text):
        return None
    cur = db.execute(
        "INSERT INTO chat_messages (channel_id, user_id, text, created_at, kind, platform, ext_name) VALUES (?,?,?,?, 'ext', ?, ?)",
        (channel_id, channel_id, text, now(), platform, name))
    db.execute("DELETE FROM chat_messages WHERE channel_id = ? AND id <= ?", (channel_id, cur.lastrowid - CHAT_KEEP))
    reply = ""
    if text.startswith("!"):
        who = {"id": -1 - zlib.crc32(f"{platform}:{name.lower()}".encode()), "username": name}  # not a Yeli account: no follows, no moderation
        try:
            out = run_command(db, channel_id, who, text)
        except Exception:  # a broken command must never stop the connection
            out = None
        if out and out[0] == "tts":
            db.execute("INSERT INTO chat_messages (channel_id, user_id, text, created_at, kind, platform, ext_name) VALUES (?,?,?,?, 'tts', ?, ?)",
                       (channel_id, channel_id, out[1][:300], now(), platform, name))
        elif out:
            post_bot(db, channel_id, out[1])
            reply = out[1][:300]
    db.commit()
    return reply


# ---------------------------------------------------------------- the webhook link

def bridge_row(db, uid):
    row = db.execute("SELECT * FROM bridges WHERE user_id = ?", (uid,)).fetchone()
    if row is None:
        db.execute("INSERT INTO bridges (user_id, token) VALUES (?, ?)", (uid, secrets.token_urlsafe(24)))
        db.commit()
        row = db.execute("SELECT * FROM bridges WHERE user_id = ?", (uid,)).fetchone()
    return row


@bp.post("/api/bridge/<token>")
def bridge_hook(token):
    ip = request.remote_addr or "?"
    if rate_limited(ip, limit=30, window=600):
        return err("Too many wrong attempts. Try again later.", 429)
    db = get_db()
    row = db.execute("SELECT user_id FROM bridges WHERE token = ?", (token,)).fetchone()
    if row is None:
        record_failure(ip)
        return err("Unknown bridge link.", 404)
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        data = request.form.to_dict()
    reply = ingest(db, row["user_id"], data.get("platform"), data.get("user") or data.get("username") or data.get("name"),
                   data.get("text") or data.get("message"))
    if reply is None:
        return jsonify(ok=False, reply=""), 202
    return jsonify(ok=True, reply=reply)


# ---------------------------------------------------------------- Twitch, read directly

class TwitchReader(threading.Thread):
    def __init__(self, uid, channel):
        super().__init__(daemon=True)
        self.uid, self.channel = uid, channel
        self.stop_event = threading.Event()
        self.status = "connecting"   # connecting, connected, error
        self.sock = None

    def halt(self):
        self.stop_event.set()
        try:
            if self.sock:
                self.sock.close()
        except OSError:
            pass

    def run(self):
        con = db_connect()
        backoff = 2
        try:
            while not self.stop_event.is_set():
                try:
                    self._session(con)
                    backoff = 2
                except (OSError, ssl.SSLError):
                    if not self.stop_event.is_set():
                        self.status = "error"
                self.stop_event.wait(backoff)
                backoff = min(backoff * 2, 60)
        finally:
            con.close()

    def _still_live(self, con):
        row = con.execute("SELECT is_live, last_seen FROM streams WHERE user_id = ?", (self.uid,)).fetchone()
        return bool(row and row["is_live"] and (row["last_seen"] or 0) >= now() - STALE_AFTER)

    def _session(self, con):
        host, _, port = config.TWITCH_IRC.partition(":")
        sock = socket.create_connection((host, int(port or 6697)), timeout=15)
        if config.TWITCH_TLS:
            sock = ssl.create_default_context().wrap_socket(sock, server_hostname=host)
        sock.settimeout(15)
        self.sock = sock
        sock.sendall(f"PASS SCHMOOPIIE\r\nNICK justinfan{random.randint(10000, 99999)}\r\nJOIN #{self.channel}\r\n".encode())
        buf, checked = b"", time.monotonic()
        while not self.stop_event.is_set():
            try:
                chunk = sock.recv(4096)
                if chunk == b"":
                    raise OSError("connection closed")
                buf += chunk
            except socket.timeout:
                pass
            while b"\r\n" in buf:
                line, buf = buf.split(b"\r\n", 1)
                self._line(con, sock, line.decode("utf-8", "replace"))
            if time.monotonic() - checked > 20:
                checked = time.monotonic()
                if not self._still_live(con):
                    self.stop_event.set()
        sock.close()

    def _line(self, con, sock, line):
        if line.startswith("PING"):
            sock.sendall(("PONG" + line[4:] + "\r\n").encode())
            return
        if " 001 " in line:
            self.status = "connected"
            return
        m = IRC_MSG.match(line)
        if m:
            text = m.group(2)
            if text.startswith("\x01ACTION "):
                text = text[8:].rstrip("\x01")
            ingest(con, self.uid, "twitch", m.group(1), text)


_lock = threading.RLock()
_readers = {}  # user id -> TwitchReader


def sync(db, uid):
    """Run (or stop) the Twitch reader so it matches the settings and whether the streamer is live."""
    row = db.execute("SELECT twitch_channel, twitch_enabled FROM bridges WHERE user_id = ?", (uid,)).fetchone()
    live = db.execute("SELECT is_live FROM streams WHERE user_id = ?", (uid,)).fetchone()
    want = row["twitch_channel"] if row and row["twitch_enabled"] and live and live["is_live"] else ""
    with _lock:
        reader = _readers.get(uid)
        if reader and (not want or reader.channel != want or not reader.is_alive()):
            reader.halt()
            _readers.pop(uid, None)
            reader = None
        if want and reader is None:
            reader = _readers[uid] = TwitchReader(uid, want)
            reader.start()


def stop_all():
    with _lock:
        for r in _readers.values():
            r.halt()
        _readers.clear()


def twitch_status(uid):
    r = _readers.get(uid)
    return r.status if r and r.is_alive() else "off"


# ---------------------------------------------------------------- settings (streamer only)

def state_json(db, uid):
    row = bridge_row(db, uid)
    return {"token": row["token"], "url": request.host_url.rstrip("/") + "/api/bridge/" + row["token"],
            "twitch": {"channel": row["twitch_channel"], "enabled": bool(row["twitch_enabled"]), "status": twitch_status(uid)}}


@bp.get("/api/bridge")
@login_required
def bridge_state():
    return jsonify(**state_json(get_db(), current_user()["id"]))


@bp.post("/api/bridge/twitch")
@login_required
def bridge_twitch():
    uid = current_user()["id"]
    db = get_db()
    data = request.get_json(silent=True) or {}
    channel = text_field(data, "channel", 60).lower().lstrip("#").removeprefix("https://www.twitch.tv/").removeprefix("twitch.tv/").strip("/")
    enabled = bool(data.get("enabled"))
    if channel and not TWITCH_RE.match(channel):
        return err("Enter the Twitch channel name, for example ibai.")
    if enabled and not channel:
        return err("Enter the Twitch channel name first.")
    bridge_row(db, uid)
    db.execute("UPDATE bridges SET twitch_channel = ?, twitch_enabled = ? WHERE user_id = ?", (channel, 1 if enabled else 0, uid))
    db.commit()
    sync(db, uid)
    return jsonify(**state_json(db, uid))


@bp.post("/api/bridge/token/reset")
@login_required
def bridge_token_reset():
    uid = current_user()["id"]
    db = get_db()
    bridge_row(db, uid)
    db.execute("UPDATE bridges SET token = ? WHERE user_id = ?", (secrets.token_urlsafe(24), uid))
    db.commit()
    return jsonify(**state_json(db, uid))
