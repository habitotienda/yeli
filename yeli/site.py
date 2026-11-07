"""The site around the streams: footer social links, news (updates) and the Support inbox.

  GET    /api/site/socials                 the footer links (public)
  POST   /api/admin/socials                add one              (admin)
  DELETE /api/admin/socials/<id>           remove one           (admin)
  GET    /api/site/updates                 news, newest first (public)
  POST   /api/admin/updates                publish a news item  (admin)
  DELETE /api/admin/updates/<id>           remove one           (admin)

  Support. A person writes to the admin and the admin answers; each side gets a notification (the bell, and an
  email if they asked for it), see notifications.py ("ticket" goes to the admins, "support" to the person).
  POST   /api/support/tickets              open a request       (signed in)
  GET    /api/support/tickets              my requests
  GET    /api/support/tickets/<id>         one request with its messages (its owner or an admin)
  POST   /api/support/tickets/<id>/messages  write in it (its owner or an admin; an admin's message is the answer)
  POST   /api/support/tickets/<id>/close   close it (its owner or an admin)
  GET    /api/admin/support                the admins' inbox
"""
from functools import wraps
from urllib.parse import urlparse

from flask import Blueprint, jsonify, request

from . import config
from .config import *
from .core import *
from .db import get_db
from .notifications import notify_many

bp = Blueprint("site", __name__)

# Platforms the admin can pick for a footer link. The icons are drawn in static/js/site.js.
PLATFORMS = {
    "youtube": "YouTube", "twitch": "Twitch", "kick": "Kick", "tiktok": "TikTok", "instagram": "Instagram",
    "x": "X", "facebook": "Facebook", "discord": "Discord", "telegram": "Telegram", "whatsapp": "WhatsApp",
    "reddit": "Reddit", "github": "GitHub", "web": "Website",
}
TOPICS = ("account", "payments", "streaming", "bug", "report", "other")
STATUSES = ("open", "answered", "closed")


def admin_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        me = current_user()
        if me is None:
            return err("Log in to continue.", 401)
        if not is_admin(me["username"]):
            return err("Admins only.", 403)
        return view(*args, **kwargs)

    return wrapper


def _body(data, key, limit):
    value = data.get(key)
    return value.strip()[:limit] if isinstance(value, str) else ""


# ---------------------------------------------------------------- footer: social networks

def _social_json(r):
    return {"id": r["id"], "platform": r["platform"], "name": PLATFORMS.get(r["platform"], r["platform"]), "label": r["label"], "url": r["url"]}


@bp.get("/api/site/socials")
def socials_list():
    rows = get_db().execute("SELECT id, platform, label, url FROM site_socials ORDER BY position, id").fetchall()
    resp = jsonify(socials=[_social_json(r) for r in rows], platforms=[[k, n] for k, n in PLATFORMS.items()])  # a list: keeps the order
    resp.headers["Cache-Control"] = "no-cache"
    return resp


def clean_url(raw):
    """Only plain https:// addresses: a footer link must never be a javascript: or data: URL."""
    raw = (raw or "").strip()
    if not raw or len(raw) > 300 or any(c.isspace() for c in raw) or any(ord(c) < 32 for c in raw):
        return None
    if "://" not in raw:
        raw = "https://" + raw
    u = urlparse(raw)
    if u.scheme != "https" or not u.netloc or "." not in u.hostname or u.username or u.password:
        return None
    return raw


@bp.post("/api/admin/socials")
@admin_required
def socials_add():
    data = request.get_json(silent=True) or {}
    platform = _body(data, "platform", 20)
    if platform not in PLATFORMS:
        return err("Pick a network from the list.", field="platform")
    url = clean_url(data.get("url"))
    if url is None:
        return err("Enter a valid https:// address.", field="url")
    label = _body(data, "label", 30)
    db = get_db()
    if db.execute("SELECT COUNT(*) AS n FROM site_socials").fetchone()["n"] >= config.SOCIALS_MAX:
        return err(f"You can add up to {config.SOCIALS_MAX} social networks.")
    pos = db.execute("SELECT COALESCE(MAX(position), 0) + 1 AS n FROM site_socials").fetchone()["n"]
    db.execute("INSERT INTO site_socials (platform, label, url, position, created_at) VALUES (?,?,?,?,?)", (platform, label, url, pos, now()))
    db.commit()
    return socials_list()


@bp.delete("/api/admin/socials/<int:sid>")
@admin_required
def socials_remove(sid):
    db = get_db()
    db.execute("DELETE FROM site_socials WHERE id = ?", (sid,))
    db.commit()
    return socials_list()


# ---------------------------------------------------------------- news

def _update_json(r):
    return {"id": r["id"], "title": r["title"], "body": r["body"], "tag": r["tag"], "created_at": r["created_at"]}


@bp.get("/api/site/updates")
def updates_list():
    limit = min(max(int_arg("limit", 20), 1), 50)
    before = int_arg("before", 0)
    db = get_db()
    if before:
        rows = db.execute("SELECT id, title, body, tag, created_at FROM site_updates WHERE id < ? ORDER BY id DESC LIMIT ?", (before, limit + 1)).fetchall()
    else:
        rows = db.execute("SELECT id, title, body, tag, created_at FROM site_updates ORDER BY id DESC LIMIT ?", (limit + 1,)).fetchall()
    return jsonify(updates=[_update_json(r) for r in rows[:limit]], more=len(rows) > limit)


@bp.post("/api/admin/updates")
@admin_required
def updates_add():
    data = request.get_json(silent=True) or {}
    title = _body(data, "title", 100)
    body = _body(data, "body", 4000)
    tag = _body(data, "tag", 20)
    if len(title) < 3:
        return err("Write a title (at least 3 characters).", field="title")
    if len(body) < 3:
        return err("Write the text of the update.", field="body")
    db = get_db()
    cur = db.execute("INSERT INTO site_updates (title, body, tag, created_at) VALUES (?,?,?,?)", (title, body, tag, now()))
    db.commit()
    row = db.execute("SELECT id, title, body, tag, created_at FROM site_updates WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(update=_update_json(row)), 201


@bp.delete("/api/admin/updates/<int:uid_>")
@admin_required
def updates_remove(uid_):
    db = get_db()
    db.execute("DELETE FROM site_updates WHERE id = ?", (uid_,))
    db.commit()
    return jsonify(ok=True)


# ---------------------------------------------------------------- support

_last_ticket = {}


def _admin_ids(db):
    names = sorted(config.ADMINS)
    if not names:
        return []
    qs = ",".join("?" * len(names))
    return [r["id"] for r in db.execute(f"SELECT id FROM users WHERE LOWER(username) IN ({qs})", names)]


def _ticket_json(r, with_user=False):
    out = {"id": r["id"], "subject": r["subject"], "category": r["category"], "status": r["status"],
           "created_at": r["created_at"], "updated_at": r["updated_at"]}
    keys = r.keys()
    if "last_body" in keys:
        out["preview"] = (r["last_body"] or "")[:140]
        out["last_from_staff"] = bool(r["last_staff"])
    if with_user:
        out["username"] = r["username"]
        out["hue"] = avatar_hue(r["username"])
    return out


TICKET_SELECT = """SELECT t.id, t.user_id, t.subject, t.category, t.status, t.created_at, t.updated_at, u.username,
    (SELECT m.body FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body,
    (SELECT m.from_staff FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_staff
    FROM support_tickets t JOIN users u ON u.id = t.user_id"""


def _load_ticket(db, tid):
    """(ticket row, is the viewer staff). None when it doesn't exist or isn't theirs (same answer: nobody can probe ids)."""
    me = current_user()
    row = db.execute(f"{TICKET_SELECT} WHERE t.id = ?", (tid,)).fetchone()
    if row is None:
        return None, False
    staff = is_admin(me["username"])
    if row["user_id"] != me["id"] and not staff:
        return None, False
    return row, staff


def _messages(db, tid):
    rows = db.execute(
        "SELECT m.id, m.body, m.from_staff, m.created_at, u.username FROM support_messages m JOIN users u ON u.id = m.sender_id WHERE m.ticket_id = ? ORDER BY m.id",
        (tid,),
    ).fetchall()
    return [{"id": m["id"], "body": m["body"], "staff": bool(m["from_staff"]), "created_at": m["created_at"], "username": m["username"]} for m in rows]


@bp.post("/api/support/tickets")
@login_required
def ticket_create():
    me = current_user()
    data = request.get_json(silent=True) or {}
    subject = " ".join(_body(data, "subject", 100).split())
    message = _body(data, "message", 2000)
    category = _body(data, "category", 20) or "other"
    if category not in TOPICS:
        return err("Pick a topic from the list.", field="category")
    if len(subject) < 3:
        return err("Write a subject (at least 3 characters).", field="subject")
    if len(message) < 10:
        return err("Tell us a bit more (at least 10 characters).", field="message")
    db = get_db()
    open_now = db.execute("SELECT COUNT(*) AS n FROM support_tickets WHERE user_id = ? AND status != 'closed'", (me["id"],)).fetchone()["n"]
    if open_now >= config.SUPPORT_MAX_OPEN:
        return err(f"You already have {config.SUPPORT_MAX_OPEN} open requests. Close one or wait for an answer.", 429)
    t = now()
    if t - _last_ticket.get(me["id"], 0) < config.SUPPORT_COOLDOWN:
        return err("Wait a few seconds before sending another request.", 429)
    _last_ticket[me["id"]] = t
    cur = db.execute("INSERT INTO support_tickets (user_id, subject, category, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
                     (me["id"], subject, category, "open", t, t))
    tid = cur.lastrowid
    db.execute("INSERT INTO support_messages (ticket_id, sender_id, from_staff, body, created_at) VALUES (?,?,?,?,?)", (tid, me["id"], 0, message, t))
    notify_many(db, [i for i in _admin_ids(db) if i != me["id"]], "ticket", actor=me["username"], ref=str(tid), title=subject, body=message)
    db.commit()
    return jsonify(ticket=_ticket_json(db.execute(f"{TICKET_SELECT} WHERE t.id = ?", (tid,)).fetchone())), 201


@bp.get("/api/support/tickets")
@login_required
def ticket_mine():
    me = current_user()
    rows = get_db().execute(f"{TICKET_SELECT} WHERE t.user_id = ? ORDER BY t.updated_at DESC, t.id DESC LIMIT 100", (me["id"],)).fetchall()
    return jsonify(tickets=[_ticket_json(r) for r in rows])


@bp.get("/api/support/tickets/<int:tid>")
@login_required
def ticket_get(tid):
    db = get_db()
    row, staff = _load_ticket(db, tid)
    if row is None:
        return err("That request doesn't exist.", 404)
    return jsonify(ticket=_ticket_json(row, with_user=True), messages=_messages(db, tid), staff=staff)


@bp.post("/api/support/tickets/<int:tid>/messages")
@login_required
def ticket_reply(tid):
    me = current_user()
    db = get_db()
    row, staff = _load_ticket(db, tid)
    if row is None:
        return err("That request doesn't exist.", 404)
    text = _body(request.get_json(silent=True) or {}, "message", 2000)
    if len(text) < 2:
        return err("Write your message.", field="message")
    if row["status"] == "closed":
        return err("This request is closed. Open a new one if you still need help.", 409)
    count = db.execute("SELECT COUNT(*) AS n FROM support_messages WHERE ticket_id = ?", (tid,)).fetchone()["n"]
    if count >= config.SUPPORT_MAX_MESSAGES:
        return err("This conversation is too long. Open a new request.", 409)
    answering = staff and row["user_id"] != me["id"]  # an admin's own request, written by themselves, is not "an answer"
    t = now()
    db.execute("INSERT INTO support_messages (ticket_id, sender_id, from_staff, body, created_at) VALUES (?,?,?,?,?)", (tid, me["id"], 1 if answering else 0, text, t))
    db.execute("UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?", ("answered" if answering else "open", t, tid))
    if answering:
        notify_many(db, [row["user_id"]], "support", actor=me["username"], ref=str(tid), title=row["subject"], body=text)
    else:
        notify_many(db, [i for i in _admin_ids(db) if i != me["id"]], "ticket", actor=me["username"], ref=str(tid), title=row["subject"], body=text)
    db.commit()
    row, _ = _load_ticket(db, tid)
    return jsonify(ticket=_ticket_json(row, with_user=True), messages=_messages(db, tid), staff=staff), 201


@bp.post("/api/support/tickets/<int:tid>/close")
@login_required
def ticket_close(tid):
    db = get_db()
    row, _staff = _load_ticket(db, tid)
    if row is None:
        return err("That request doesn't exist.", 404)
    db.execute("UPDATE support_tickets SET status = 'closed', updated_at = ? WHERE id = ?", (now(), tid))
    db.commit()
    return jsonify(ok=True)


@bp.get("/api/admin/support")
@admin_required
def support_inbox():
    status = request.args.get("status", "open")
    db = get_db()
    if status in STATUSES:
        rows = db.execute(f"{TICKET_SELECT} WHERE t.status = ? ORDER BY t.updated_at DESC, t.id DESC LIMIT 100", (status,)).fetchall()
    else:
        rows = db.execute(f"{TICKET_SELECT} ORDER BY t.updated_at DESC, t.id DESC LIMIT 100").fetchall()
    counts = {r["status"]: r["n"] for r in db.execute("SELECT status, COUNT(*) AS n FROM support_tickets GROUP BY status")}
    return jsonify(tickets=[_ticket_json(r, with_user=True) for r in rows], counts={s: counts.get(s, 0) for s in STATUSES})
