"""Gallery: pictures taken from a stream, with an optional price in Yelis.

A streamer publishes a clip in a SQUARE (1:1) or PORTRAIT (4:5) format; that doesn't make a video, it makes a picture of the
stream. The picture goes in the channel's gallery and can have a price (for example 120 Yelis). Whoever buys it keeps it as a
GIF that they can send in the chat of any channel, like a sticker.

How it works
  * the browser builds two things from the clip: the picture (JPEG) and a short animated GIF made of the same moment
  * POST /api/gallery        creates the item with its picture (JSON, like a cover)
  * POST /api/gallery/<id>/gif   uploads the GIF (binary); the item only shows up once it has its GIF
  * POST /api/gallery/<id>/buy   charges the buyer and pays the author like a donation (same wallet rules); the buyer then owns it
  * chat: an owner sends it with the sticker id "g:<id>" (see chat.py)
  * removing an item hides it from the gallery; people who already own it keep its GIF
"""
import re
import secrets
import struct

from flask import Blueprint, Response, jsonify, request

from . import config
from .core import *
from .db import get_db
from .notifications import notify
from .wallet import add_ledger, ensure_wallet, wallet_summary

bp = Blueprint("gallery", __name__)

ITEM_ID = re.compile(r"^[a-f0-9]{16}$")
ASPECTS = ("1:1", "4:5")
TITLE_MAX = 60
PAGE = 24
MIN_PRICE = 10  # a price is 0 (free) or at least this many Yelis
MAX_GIF_SIDE = 512

SELECT = """
SELECT g.id, g.user_id, g.title, g.aspect, g.price, g.sales, g.removed, g.created_at, (g.gif IS NOT NULL) AS ready,
       u.username, u.avatar, u.avatar_updated,
       EXISTS(SELECT 1 FROM gallery_owned o WHERE o.item_id = g.id AND o.user_id = :me) AS owned
FROM gallery_items g JOIN users u ON u.id = g.user_id
"""


def item_json(row, me_row):
    mine = bool(me_row and me_row["id"] == row["user_id"])
    return {
        "id": row["id"],
        "title": row["title"],
        "aspect": row["aspect"],
        "price": row["price"],
        "sales": row["sales"],
        "created_at": row["created_at"],
        "username": row["username"],
        "hue": avatar_hue(row["username"]),
        "avatar": avatar_value(row),
        "is_mine": mine,
        "owned": bool(row["owned"]),
        "removed": bool(row["removed"]),
    }


def valid_gif(raw):
    """A real GIF, not too big in bytes or in pixels (the chat shows it small)."""
    if not raw or len(raw) > config.GALLERY_GIF_MAX or raw[:6] not in (b"GIF87a", b"GIF89a") or len(raw) < 14:
        return False
    w, h = struct.unpack("<HH", raw[6:10])
    return 0 < w <= MAX_GIF_SIDE and 0 < h <= MAX_GIF_SIDE and raw.rstrip(b"\x00")[-1:] == b";"


def _me(me_row):
    return me_row["id"] if me_row else 0


@bp.post("/api/gallery")
@login_required
def gallery_create():
    me_row = current_user()
    data = request.get_json(silent=True) or {}
    db = get_db()
    vid = text_field(data, "vod_id", 40)
    vod = db.execute("SELECT id, user_id, title, status FROM vods WHERE id = ?", (vid,)).fetchone()
    if vod is None or vod["user_id"] != me_row["id"]:
        return err("Video not found.", 404)
    if vod["status"] != "ready":
        return err("This recording is still being saved.", 409)
    aspect = data.get("aspect")
    if aspect not in ASPECTS:
        return err("Choose the square (1:1) or the 4:5 format.", field="format")
    title = text_field(data, "title", TITLE_MAX) or vod["title"][:TITLE_MAX] or "Gallery picture"
    price = data.get("price", 0)
    if isinstance(price, bool) or not isinstance(price, int) or not (price == 0 or MIN_PRICE <= price <= config.GALLERY_PRICE_MAX):
        return err(f"The price is 0 (free) or between {MIN_PRICE} and {config.GALLERY_PRICE_MAX:,} Yelis.", field="price")
    image = decode_jpeg(data.get("image"), config.MAX_COVER_BYTES)
    if image is None:
        return err("That picture isn't valid or is too big.", field="image")
    t = now()
    # a picture whose GIF never arrived (the browser closed) is thrown away
    db.execute("DELETE FROM gallery_items WHERE user_id = ? AND gif IS NULL AND created_at < ?", (me_row["id"], t - 600))
    have = db.execute("SELECT COUNT(*) AS n FROM gallery_items WHERE user_id = ? AND removed = 0", (me_row["id"],)).fetchone()["n"]
    if have >= config.GALLERY_MAX_PER_USER:
        db.commit()
        return err(f"Your gallery has {have} pictures, which is the limit. Remove one to add another.", 409, limit=True)
    gid = secrets.token_hex(8)
    db.execute(
        "INSERT INTO gallery_items (id, user_id, vod_id, title, aspect, price, image, created_at) VALUES (?,?,?,?,?,?,?,?)",
        (gid, me_row["id"], vid, title, aspect, price, image, t),
    )
    db.commit()
    return jsonify(ok=True, id=gid, max_gif=config.GALLERY_GIF_MAX), 201


@bp.post("/api/gallery/<gid>/gif")
@login_required
def gallery_gif_upload(gid):
    """The GIF of a picture (binary body). It completes the item: from now on it is in the gallery and its author owns it."""
    me_row = current_user()
    db = get_db()
    row = db.execute("SELECT user_id, (gif IS NOT NULL) AS ready FROM gallery_items WHERE id = ?", (gid,)).fetchone() if ITEM_ID.match(gid) else None
    if row is None or row["user_id"] != me_row["id"]:
        return err("Picture not found.", 404)
    if row["ready"]:
        return err("This picture already has its GIF.", 409)
    raw = request.get_data()
    if not valid_gif(raw):
        return err("That GIF isn't valid or is too big.", field="gif")
    db.execute("UPDATE gallery_items SET gif = ? WHERE id = ?", (raw, gid))
    db.execute("INSERT OR IGNORE INTO gallery_owned (item_id, user_id, paid, created_at) VALUES (?,?,0,?)", (gid, me_row["id"], now()))
    db.commit()
    created = db.execute(f"{SELECT} WHERE g.id = :id", {"me": me_row["id"], "id": gid}).fetchone()
    return jsonify(ok=True, item=item_json(created, me_row))


@bp.get("/api/gallery")
def gallery_list():
    """scope=all: the gallery of the whole site. scope=mine: what I published. scope=owned: what I own (my GIFs for the chat).
    `channel` limits `all` to one channel."""
    me_row = current_user()
    db = get_db()
    scope = request.args.get("scope", "all")
    offset = max(0, int_arg("offset", 0))
    args = {"me": _me(me_row), "limit": PAGE + 1, "offset": offset}
    if scope in ("mine", "owned") and me_row is None:
        return err("Log in first.", 401)
    if scope == "mine":
        where = "WHERE g.user_id = :me AND g.removed = 0 AND g.gif IS NOT NULL"
    elif scope == "owned":
        where = "WHERE g.gif IS NOT NULL AND EXISTS(SELECT 1 FROM gallery_owned o WHERE o.item_id = g.id AND o.user_id = :me)"
    else:
        where = "WHERE g.removed = 0 AND g.gif IS NOT NULL"
        channel = request.args.get("channel", "")[:40]
        if channel:
            where += " AND u.username = :channel"
            args["channel"] = channel
        q = (request.args.get("q") or "").strip()[:50]
        if q:  # Content search: the title or the person
            where += " AND (g.title LIKE :q ESCAPE '\\' OR u.username LIKE :q ESCAPE '\\')"
            args["q"] = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    rows = db.execute(f"{SELECT} {where} ORDER BY g.created_at DESC, g.id DESC LIMIT :limit OFFSET :offset", args).fetchall()
    return jsonify(items=[item_json(r, me_row) for r in rows[:PAGE]], more=len(rows) > PAGE, next_offset=offset + PAGE)


def _blob(gid, column, mime):
    if not ITEM_ID.match(gid):
        return err("Picture not found.", 404)
    row = get_db().execute(f"SELECT {column} AS data FROM gallery_items WHERE id = ?", (gid,)).fetchone()
    if row is None or not row["data"]:
        return err("Picture not found.", 404)
    resp = Response(bytes(row["data"]), mimetype=mime)
    resp.headers["Cache-Control"] = "public, max-age=86400"  # pictures never change once they exist
    resp.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    return resp


@bp.get("/api/gallery/<gid>/image")
def gallery_image(gid):
    return _blob(gid, "image", "image/jpeg")


@bp.get("/api/gallery/<gid>/gif")
def gallery_gif(gid):
    """Anyone in the chat sees the GIF when an owner sends it; only owners can send it (checked by the chat)."""
    return _blob(gid, "gif", "image/gif")


@bp.post("/api/gallery/<gid>/buy")
@login_required
def gallery_buy(gid):
    me_row = current_user()
    db = get_db()
    row = db.execute(f"{SELECT} WHERE g.id = :id", {"me": me_row["id"], "id": gid}).fetchone() if ITEM_ID.match(gid) else None
    if row is None or row["removed"] or not row["ready"]:
        return err("Picture not found.", 404)
    if row["user_id"] == me_row["id"]:
        return err("This is your own picture: it is already in your GIFs.")
    if row["owned"]:
        return err("You already own this picture.", 409, owned=True)
    price, t = row["price"], now()
    if price > 0:
        ensure_wallet(db, me_row["id"])
        # Atomic check-and-debit: fails (and changes nothing) if the balance is too low.
        cur = db.execute("UPDATE wallets SET bought = bought - ? WHERE user_id = ? AND bought >= ?", (price, me_row["id"], price))
        if cur.rowcount != 1:
            db.rollback()
            return err("You don't have enough Yelis.", 402, balance=wallet_summary(db, me_row["id"])["bought"])
        # The author is paid exactly like a donation, so it follows the same hold period and payout rules.
        db.execute(
            "INSERT INTO donations (from_user, to_user, coins, message, sticker, created_at) VALUES (?,?,?,?,?,?)",
            (me_row["id"], row["user_id"], price, f"Gallery: {row['title']}"[:100], "", t),
        )
        add_ledger(db, me_row["id"], "bought", "gallery_buy", -price, f"{row['username']}: {row['title']}"[:100])
        add_ledger(db, row["user_id"], "earned", "gallery_sale", price, f"to {me_row['username']}")
        notify(db, row["user_id"], "donation", actor=me_row["username"], amount=price, body=f"Bought \u201c{row['title']}\u201d")
    inserted = db.execute("INSERT OR IGNORE INTO gallery_owned (item_id, user_id, paid, created_at) VALUES (?,?,?,?)", (gid, me_row["id"], price, t)).rowcount
    if inserted:
        db.execute("UPDATE gallery_items SET sales = sales + 1 WHERE id = ?", (gid,))
    db.commit()
    fresh = db.execute(f"{SELECT} WHERE g.id = :id", {"me": me_row["id"], "id": gid}).fetchone()
    return jsonify(ok=True, item=item_json(fresh, me_row), balance=wallet_summary(db, me_row["id"])["bought"])


@bp.post("/api/gallery/<gid>/delete")
@login_required
def gallery_delete(gid):
    """Take a picture out of the gallery. People who bought it keep its GIF."""
    me_row = current_user()
    db = get_db()
    row = db.execute("SELECT user_id FROM gallery_items WHERE id = ?", (gid,)).fetchone() if ITEM_ID.match(gid) else None
    if row is None or row["user_id"] != me_row["id"]:
        return err("Picture not found.", 404)
    db.execute("UPDATE gallery_items SET removed = 1 WHERE id = ?", (gid,))
    db.commit()
    return jsonify(ok=True)


def owns(db, user_id, gid):
    """Does this person own the picture? Used by the chat before it lets them send its GIF."""
    return bool(ITEM_ID.match(gid or "") and db.execute(
        "SELECT 1 FROM gallery_owned WHERE item_id = ? AND user_id = ?", (gid, user_id)).fetchone())
