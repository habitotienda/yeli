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
MAX_COVER_BYTES = 80 * 1024  # a video cover; as base64 inside the JSON it stays under the 128 KB request limit

ADMINS = {n.strip().lower() for n in os.environ.get("YELI_ADMINS", "").split(",") if n.strip()}

# Seconds the public lists (live, channels, categories) are cached, so many visitors cost one query.
LIST_CACHE_SECONDS = float(os.environ.get("YELI_LIST_CACHE", "2"))

# Media server (SFU), see README. Empty = peer-to-peer mode.
# MEDIA_URL is the address the *browser* uses to reach MediaMTX's WebRTC (WHIP/WHEP) port.
MEDIA_URL = os.environ.get("YELI_MEDIA_URL", "").rstrip("/")
MEDIA_RTSP = os.environ.get("YELI_MEDIA_RTSP", "").rstrip("/")  # where ffmpeg reads the stream to send it to other platforms (rtsp://127.0.0.1:8554)
FFMPEG_BIN = os.environ.get("YELI_FFMPEG", "")  # empty = look for ffmpeg on the PATH
TWITCH_IRC = os.environ.get("YELI_TWITCH_IRC", "irc.chat.twitch.tv:6697")  # host:port; only changed in tests
TWITCH_TLS = os.environ.get("YELI_TWITCH_TLS", "1") != "0"
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


# Saved streams (videos on the profile). The streamer's browser records the program output and uploads it in
# small pieces while live; when the stream ends the recording becomes a video on the channel.
# Files live next to the database, so a persistent disk (YELI_DB=/var/data/yeli.db) keeps them too.
VOD_DIR = os.environ.get("YELI_VOD_DIR", str(Path(DB_PATH).resolve().parent / "vods"))
VOD_MAX_BYTES = int(float(os.environ.get("YELI_VOD_MAX_MB", "1024")) * 1024 * 1024)  # per video
VOD_MAX_PER_USER = int(os.environ.get("YELI_VOD_MAX_PER_USER", "30"))  # saved videos per channel
VOD_CHUNK_MAX = 8 * 1024 * 1024  # one upload piece (the browser sends ~5 s at a time)
VOD_STALE_SECONDS = 120  # a recording that stops sending data this long is closed with what it has
VOD_TITLE_MAX = 80
VOD_DESC_MAX = 500
VOD_COMMENT_MAX = 300
# Edited videos must be mostly made of footage from the streamer's own live streams.
EDIT_MIN_LIVE_PCT = int(os.environ.get("YELI_EDIT_MIN_LIVE_PCT", "70"))
EDIT_MAX_PROJECTS = int(os.environ.get("YELI_EDIT_MAX_PROJECTS", "20"))  # saved editor projects (drafts) per channel
EDIT_PROJECT_MAX_BYTES = 100 * 1024  # a project is only a list of cuts, so this is a lot
TTS_BIN = os.environ.get("YELI_TTS_BIN", "")  # speech program (espeak-ng); empty = look for espeak-ng / espeak on the PATH


# Notifications (see notifications.py). In-app ones need nothing. Email needs ONE of these:
#   - an HTTPS email API (Resend): YELI_RESEND_API_KEY. Works on hosts that block SMTP ports (Render's free plan does).
#   - an SMTP server: YELI_SMTP_HOST (+ PORT / USER / PASSWORD / SECURITY = starttls | ssl | none).
# YELI_MAIL_FROM is the sender ("Yeli <no-reply@your-domain>"); YELI_PUBLIC_URL is the address used in the links of the emails.
MAIL_FROM = os.environ.get("YELI_MAIL_FROM", "")
PUBLIC_URL = os.environ.get("YELI_PUBLIC_URL", "").rstrip("/")
RESEND_API_KEY = os.environ.get("YELI_RESEND_API_KEY", "")
SMTP_HOST = os.environ.get("YELI_SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("YELI_SMTP_PORT", "587"))
SMTP_USER = os.environ.get("YELI_SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("YELI_SMTP_PASSWORD", "")
SMTP_SECURITY = os.environ.get("YELI_SMTP_SECURITY", "starttls").lower()
MAIL_CONSOLE = os.environ.get("YELI_MAIL_CONSOLE") == "1"  # development: print the emails instead of sending them
NOTIFY_EMAILS_PER_HOUR = int(os.environ.get("YELI_NOTIFY_EMAILS_PER_HOUR", "12"))  # per person, so nobody can flood an inbox
NOTIFY_KEEP = 100  # notifications kept per person in the bell
