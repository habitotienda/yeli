"""The bot's voice inside the stream.

The server turns a !say message into audio with a speech program (espeak-ng); the streamer's studio downloads it and
plays it into the program mix, so it is part of the stream (and of the saved video) instead of being read by each
viewer's browser. Only the streamer can ask for it, and only for messages of their own channel.

Without a speech program on the server (or with the channel set to "viewers"), nothing changes: each viewer's browser
reads the message aloud, as before.
"""
import re
import shutil
import subprocess
from collections import OrderedDict

from flask import Blueprint, Response, request

from . import config
from .core import *
from .db import get_db

bp = Blueprint("voice", __name__)

LANG_RE = re.compile(r"[a-z]{2,3}(-[a-z0-9]{2,8})?")
CACHE_MAX = 48
_cache = OrderedDict()  # message id -> wav bytes (a few seconds each)


def engine():
    """Path of the speech program, or None when the server doesn't have one."""
    return config.TTS_BIN or shutil.which("espeak-ng") or shutil.which("espeak")


def stream_ready(st):
    """True when this channel's voice should play in the stream (and viewers' browsers stay quiet)."""
    return bool(st["tts_enabled"] and st["tts_output"] == "stream" and engine())


def _voices(lang):
    lang = (lang or "").strip().lower().replace("_", "-")
    first = lang if LANG_RE.fullmatch(lang) else "en"
    return list(dict.fromkeys([first, first.split("-")[0], "en"]))


def synth(text, lang):
    """WAV bytes for `text`, or None when the program fails. The text goes as one argument (no shell)."""
    exe = engine()
    if not exe:
        return None
    for voice in _voices(lang):
        try:
            out = subprocess.run([exe, "-v", voice, "-s", "165", "--stdout", "--", text],
                                 capture_output=True, timeout=10, check=False)
        except (OSError, subprocess.TimeoutExpired):
            return None
        if out.returncode == 0 and out.stdout[:4] == b"RIFF":
            return out.stdout
    return None


@bp.get("/api/tts/<username>/<int:mid>")
@login_required
def tts_audio(username, mid):
    from .bot import chat_settings  # imported here: bot.py asks this module whether an engine exists

    me_row = current_user()
    db = get_db()
    channel = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if channel is None:
        return err("Channel not found.", 404)
    if channel["id"] != me_row["id"]:
        return err("Only the streamer can get the voice audio.", 403)
    st = chat_settings(db, channel["id"])
    if not stream_ready(st):
        return err("The voice isn't set to play in the stream.", 409)
    msg = db.execute(
        "SELECT text FROM chat_messages WHERE id = ? AND channel_id = ? AND kind = 'tts' AND deleted = 0", (mid, channel["id"])
    ).fetchone()
    if msg is None:
        return err("Message not found.", 404)
    wav = _cache.get(mid)
    if wav is None:
        wav = synth(msg["text"], st["tts_lang"] or request.accept_languages.best or "en")
        if wav is None:
            return err("The voice engine couldn't read that message.", 503)
        _cache[mid] = wav
        while len(_cache) > CACHE_MAX:
            _cache.popitem(last=False)
    resp = Response(wav, mimetype="audio/wav")
    resp.headers["Cache-Control"] = "private, max-age=600"
    return resp
