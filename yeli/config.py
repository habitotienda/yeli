"""Settings. Everything can be overridden with environment variables (see .env.example)."""
import json
import os
import re
import secrets
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
INSTANCE_DIR = ROOT_DIR / "instance"
INSTANCE_DIR.mkdir(exist_ok=True)
DB_PATH = os.environ.get("YELI_DB", str(INSTANCE_DIR / "yeli.db"))

# A stream counts as live while its broadcaster keeps sending heartbeats.
LIVE_TIMEOUT = 25
# A viewer counts as watching while its page keeps sending heartbeats.
VIEWER_TIMEOUT = 20
# Peer-to-peer mode only: every viewer costs the streamer an extra video encode, so cap them.
MAX_VIEWERS = int(os.environ.get("YELI_MAX_VIEWERS", "25"))
MAX_VIEWERS_SFU = int(os.environ.get("YELI_MAX_VIEWERS_SFU", "2000"))  # with a media server the streamer is not the bottleneck
MAX_ANON_PER_IP = 5
# Free upgrade point for an hour-long viewer (see rewards.py)
FREE_POINT_SECONDS = int(os.environ.get("YELI_FREE_POINT_SECONDS", "3600"))
FREE_POINTS_PER_DAY = int(os.environ.get("YELI_FREE_POINTS_PER_DAY", "3"))
FREE_POINT_MIN_ACCOUNT_AGE = int(os.environ.get("YELI_FREE_POINT_MIN_ACCOUNT_AGE", "1800"))  # guests per network per stream (people with several accounts aren't limited)

CATEGORIES = ["Gaming", "Music", "Talk", "Art", "Cooking", "Sports", "Learning", "Tech", "Other"]

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PEER_RE = re.compile(r"^[a-f0-9]{32}$")
PRESET_COUNT = 12  # built-in SVG avatars (drawn in static/js/avatars.js)
PRESET_RE = re.compile(r"^preset:(\d{1,2})$")
CHAT_MAX_LEN = 300
CHAT_KEEP = 500  # messages kept per channel
MAX_AVATAR_BYTES = 60 * 1024
MAX_THUMB_BYTES = 45 * 1024

ADMINS = {n.strip().lower() for n in os.environ.get("YELI_ADMINS", "").split(",") if n.strip()}

# Seconds the public lists (live, channels, categories) are cached, so many visitors cost one query.
LIST_CACHE_SECONDS = float(os.environ.get("YELI_LIST_CACHE", "2"))

# Media server (SFU), see README. Empty = peer-to-peer mode.
# MEDIA_URL is the address the *browser* uses to reach MediaMTX's WebRTC (WHIP/WHEP) port.
MEDIA_URL = os.environ.get("YELI_MEDIA_URL", "").rstrip("/")
MEDIA_RTMP = os.environ.get("YELI_MEDIA_RTMP", "").rstrip("/")  # only shown to streamers who use OBS over RTMP


def load_secret_key():
    env = os.environ.get("YELI_SECRET_KEY")
    if env:
        return env
    path = INSTANCE_DIR / "secret_key"
    if not path.exists():
        path.write_text(secrets.token_hex(32))
        try:
            path.chmod(0o600)
        except OSError:
            pass
    return path.read_text().strip()


def load_ice_servers():
    raw = os.environ.get("YELI_ICE_SERVERS")  # JSON list, e.g. to add a TURN server
    if raw:
        try:
            return json.loads(raw)
        except ValueError:
            pass
    return [{"urls": "stun:stun.l.google.com:19302"}]
