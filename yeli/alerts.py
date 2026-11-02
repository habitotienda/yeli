"""Stream alerts: events (donations, follows) and the rules that say how to show them (text, image, sound)."""
import base64
import re
import secrets

from flask import Blueprint, Response, jsonify, request

from . import economy
from .core import *
from .db import get_db
from .queries import *

bp = Blueprint("alerts", __name__)

SOUND_PRESETS = ("ding", "chime", "coin", "fanfare", "laser", "bell")  # synthesized in the browser
EVENTS = ("donation", "follow")
MAX_RULES = 20
MAX_ASSETS = 30
LIMITS = {"image": 60 * 1024, "sound": 90 * 1024}
MIME = {
    "image": {"image/png": b"\x89PNG", "image/jpeg": b"\xff\xd8\xff", "image/gif": b"GIF8", "image/webp": b"RIFF"},
    "sound": {"audio/mpeg": None, "audio/ogg": b"OggS", "audio/wav": b"RIFF"},
}


def add_event(db, channel_id, kind, username, amount=0, sticker="", message=""):
    db.execute(
        "INSERT INTO events (channel_id, kind, username, amount, sticker, message, created_at) VALUES (?,?,?,?,?,?,?)",
        (channel_id, kind, username, amount, sticker[:20], message[:100], now()),
    )


def rule_json(r):
    return {k: r[k] for k in ("id", "event", "min_amount", "title", "image", "sound", "volume", "seconds", "enabled")}


def rules_of(db, uid):
    return [rule_json(r) for r in db.execute("SELECT * FROM alert_rules WHERE channel_id = ? ORDER BY event, min_amount, id", (uid,))]


def valid_mp3(raw):
    return raw[:3] == b"ID3" or (len(raw) > 2 and raw[0] == 0xFF and raw[1] & 0xE0 == 0xE0)


@bp.get("/api/alerts")
@login_required
def alerts_state():
    uid = current_user()["id"]
    db = get_db()
    assets = db.execute("SELECT id, kind, mime FROM assets WHERE user_id = ? ORDER BY created_at", (uid,)).fetchall()
    return jsonify(rules=rules_of(db, uid), assets=[dict(a) for a in assets], sounds=list(SOUND_PRESETS),
                   stickers=[s for s, c in economy.STICKERS.items()], max_rules=MAX_RULES)


@bp.post("/api/alerts/rules")
@login_required
def save_rule():
    uid = current_user()["id"]
    d = request.get_json(silent=True) or {}
    db = get_db()
    event = d.get("event")
    amount, volume, seconds = d.get("min_amount", 0), d.get("volume", 80), d.get("seconds", 5)
    image, sound = d.get("image", "") or "", d.get("sound", "") or ""
    title = text_field(d, "title", 80)
    for name, v, lo, hi in (("min_amount", amount, 0, 100000), ("volume", volume, 0, 100), ("seconds", seconds, 2, 10)):
        if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
            return err(f"{name.replace('_', ' ').capitalize()} must be between {lo} and {hi}.", field=name)
    if event not in EVENTS:
        return err("Choose what triggers this alert.")

    def owned(ref, kind):
        return ref.startswith("asset:") and db.execute(
            "SELECT 1 FROM assets WHERE id = ? AND user_id = ? AND kind = ?", (ref[6:], uid, kind)).fetchone()

    if image and not (image.startswith("sticker:") and image[8:] in economy.STICKERS or owned(image, "image")):
        return err("Unknown image.", field="image")
    if sound and not (sound.startswith("preset:") and sound[7:] in SOUND_PRESETS or owned(sound, "sound")):
        return err("Unknown sound.", field="sound")
    enabled = 0 if d.get("enabled") is False else 1
    vals = (event, amount if event == "donation" else 0, title, image, sound, volume, seconds, enabled)
    rid = d.get("id")
    if rid is not None:
        cur = db.execute(
            "UPDATE alert_rules SET event=?, min_amount=?, title=?, image=?, sound=?, volume=?, seconds=?, enabled=? WHERE id = ? AND channel_id = ?",
            (*vals, rid, uid))
        if cur.rowcount != 1:
            return err("Alert not found.", 404)
    else:
        if db.execute("SELECT COUNT(*) FROM alert_rules WHERE channel_id = ?", (uid,)).fetchone()[0] >= MAX_RULES:
            return err(f"You can have up to {MAX_RULES} alerts.")
        db.execute(
            "INSERT INTO alert_rules (channel_id, event, min_amount, title, image, sound, volume, seconds, enabled) VALUES (?,?,?,?,?,?,?,?,?)",
            (uid, *vals))
    db.commit()
    return jsonify(rules=rules_of(db, uid)), 201


@bp.post("/api/alerts/rules/delete")
@login_required
def delete_rule():
    uid = current_user()["id"]
    db = get_db()
    db.execute("DELETE FROM alert_rules WHERE id = ? AND channel_id = ?", ((request.get_json(silent=True) or {}).get("id"), uid))
    db.commit()
    return jsonify(rules=rules_of(db, uid))


@bp.post("/api/alerts/assets")
@login_required
def upload_asset():
    uid = current_user()["id"]
    d = request.get_json(silent=True) or {}
    kind, data = d.get("kind"), d.get("data")
    if kind not in LIMITS or not isinstance(data, str) or not data.startswith("data:") or ";base64," not in data:
        return err("Upload an image or a sound file.")
    head, b64 = data[5:].split(";base64,", 1)
    mime = head.lower()
    if mime not in MIME[kind]:
        return err("Images can be PNG, JPG, GIF or WebP. Sounds can be MP3, OGG or WAV.")
    try:
        raw = base64.b64decode(b64, validate=True)
    except ValueError:
        return err("That file couldn't be read.")
    magic = MIME[kind][mime]
    ok = valid_mp3(raw) if mime == "audio/mpeg" else raw.startswith(magic)
    if mime in ("image/webp", "audio/wav"):
        ok = ok and raw[8:12] == (b"WEBP" if mime == "image/webp" else b"WAVE")
    if not ok:
        return err("That file doesn't look like a real " + ("image." if kind == "image" else "sound."))
    if len(raw) > LIMITS[kind]:
        return err(f"That file is too big (limit {LIMITS[kind] // 1024} KB).")
    db = get_db()
    if db.execute("SELECT COUNT(*) FROM assets WHERE user_id = ?", (uid,)).fetchone()[0] >= MAX_ASSETS:
        return err(f"You can store up to {MAX_ASSETS} files.")
    asset_id = secrets.token_hex(8)
    db.execute("INSERT INTO assets (id, user_id, kind, mime, data, created_at) VALUES (?,?,?,?,?,?)", (asset_id, uid, kind, mime, raw, now()))
    db.commit()
    return jsonify(id=asset_id, kind=kind, mime=mime), 201


@bp.get("/api/asset/<asset_id>")
def asset(asset_id):
    row = get_db().execute("SELECT mime, data FROM assets WHERE id = ?", (asset_id,)).fetchone() if re.fullmatch(r"[a-f0-9]{16}", asset_id) else None
    if row is None:
        return err("Not found.", 404)
    resp = Response(row["data"], mimetype=row["mime"])
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp


@bp.get("/api/alerts/events")
@login_required
def alert_events():
    """What the studio shows. Without `after` it only returns the latest id, so old events don't replay."""
    uid = current_user()["id"]
    db = get_db()
    if request.args.get("after") is None:
        last = db.execute("SELECT COALESCE(MAX(id), 0) FROM events WHERE channel_id = ?", (uid,)).fetchone()[0]
        return jsonify(events=[], last=last)
    after = int_arg("after")
    rows = db.execute(
        "SELECT id, kind, username, amount, sticker, message, created_at FROM events WHERE channel_id = ? AND id > ? ORDER BY id LIMIT 20",
        (uid, after)).fetchall()
    return jsonify(events=[dict(r) for r in rows], last=rows[-1]["id"] if rows else after)
