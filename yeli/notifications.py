"""Notifications: the bell inside the app and, if the person wants, an email too.

Who gets told what (each person can switch every kind on/off, separately for the app and for email):
  follow    someone followed your channel
  donation  someone sent you Yelis or a paid sticker
  comment   someone commented on one of your videos
  like      someone liked one of your videos
  live      a channel you follow went live
"""
import html as htmllib

from flask import Blueprint, Response, current_app, g, jsonify, request
from itsdangerous import BadSignature, URLSafeSerializer

from . import config, mailer
from .core import *
from .db import get_db

bp = Blueprint("notifications", __name__)

KINDS = ("follow", "donation", "comment", "reply", "like", "live")
# (shown in the app, sent by email) when the person never touched the setting.
# Emails default to the things that deserve one; "like" and "live" can be frequent, so they start app-only.
DEFAULTS = {"follow": (1, 1), "donation": (1, 1), "comment": (1, 1), "reply": (1, 1), "like": (1, 0), "live": (1, 0)}
DEDUPE_SECONDS = {"follow": 86400, "like": 86400}  # follow/unfollow or like/unlike spam doesn't ring twice
LIVE_COOLDOWN = 1800  # a streamer who restarts within 30 minutes doesn't notify everybody again
MAX_FOLLOWERS_NOTIFIED = 5000


def _lang(value):
    return "es" if value == "es" else "en"


def clean(text, limit):
    """One line, no control characters: safe for an email subject and for the bell."""
    return " ".join(str(text or "").split())[:limit]


# ---------------------------------------------------------------- links in emails

def base_url():
    """The address used in email links. Never taken from a forged Host header: it comes from YELI_PUBLIC_URL, or from
    the Host header only when the server was told which hosts are allowed (YELI_ALLOWED_HOSTS)."""
    if config.PUBLIC_URL:
        return config.PUBLIC_URL
    if current_app.config.get("TRUSTED_HOSTS"):
        return request.url_root.rstrip("/")
    return "http://localhost:5000" if config.MAIL_CONSOLE else ""


def email_ready():
    return mailer.enabled() and bool(base_url())


def _signer():
    return URLSafeSerializer(current_app.secret_key, salt="yeli-unsubscribe")


def unsubscribe_url(base, user_id):
    return f"{base}/unsubscribe/{_signer().dumps(user_id)}"


# ---------------------------------------------------------------- email text

T = {
    "en": {
        "follow": ("{actor} started following you", "{actor} is now following your channel.", "View their channel", "channel"),
        "donation": ("{actor} sent you {amount} Yelis", "{actor} sent you {amount} Yelis.", "Open my wallet", "wallet"),
        "comment": ("{actor} commented on “{title}”", "{actor} commented on your video “{title}”.", "Read the comment", "video"),
        "reply": ("{actor} replied to your comment", "{actor} replied to your comment on “{title}”.", "Read the reply", "video"),
        "like": ("{actor} liked “{title}”", "{actor} liked your video “{title}”.", "View my video", "video"),
        "live": ("{actor} is live now", "{actor} just went live: {title}", "Watch now", "channel"),
        "test": ("Yeli test email", "This is a test: your notification emails work.", "Open Yeli", "home"),
        "foot": "You get this email because of your notification settings on Yeli.",
        "manage": "Change what you receive",
        "unsub": "Stop all emails from Yeli",
    },
    "es": {
        "follow": ("{actor} empezó a seguirte", "{actor} ahora sigue tu canal.", "Ver su canal", "channel"),
        "donation": ("{actor} te envió {amount} Yelis", "{actor} te envió {amount} Yelis.", "Abrir mi billetera", "wallet"),
        "comment": ("{actor} comentó en «{title}»", "{actor} comentó en tu video «{title}».", "Leer el comentario", "video"),
        "reply": ("{actor} respondió a tu comentario", "{actor} respondió a tu comentario en «{title}».", "Leer la respuesta", "video"),
        "like": ("A {actor} le gustó «{title}»", "A {actor} le gustó tu video «{title}».", "Ver mi video", "video"),
        "live": ("{actor} está en directo", "{actor} acaba de empezar un directo: {title}", "Ver ahora", "channel"),
        "test": ("Correo de prueba de Yeli", "Esto es una prueba: tus correos de notificaciones funcionan.", "Abrir Yeli", "home"),
        "foot": "Recibes este correo por tus ajustes de notificaciones en Yeli.",
        "manage": "Cambiar lo que recibes",
        "unsub": "Dejar de recibir correos de Yeli",
    },
}


def _link(kind_target, base, actor, ref):
    if kind_target == "video":
        return f"{base}/#/video/{ref}"
    if kind_target == "wallet":
        return f"{base}/#/wallet"
    if kind_target == "home":
        return f"{base}/"
    return f"{base}/#/c/{actor}"


def compose(kind, lang, base, unsub, actor="", title="", body="", amount=0, ref=""):
    """(subject, plain text, html) for one notification email."""
    tr = T[_lang(lang)]
    subject_t, line_t, cta, target = tr[kind]
    vals = {"actor": actor, "title": title, "amount": f"{int(amount):,}"}
    subject = subject_t.format(**vals)
    line = line_t.format(**vals)
    url = _link(target, base, actor, ref)
    quote = body if kind in ("comment", "reply", "donation") else ""
    manage = f"{base}/#/settings"
    text = "\n".join(filter(None, [line, f"“{quote}”" if quote else "", "", f"{cta}: {url}", "", "--", tr["foot"], f"{tr['manage']}: {manage}", f"{tr['unsub']}: {unsub}"]))
    e = htmllib.escape
    html = f"""<!doctype html><html><body style="margin:0;padding:24px;background:#16171c;font-family:Arial,Helvetica,sans-serif;color:#f2f2f2">
<div style="max-width:480px;margin:0 auto;background:#1f2026;border:1px solid #35373f;border-radius:12px;padding:28px">
<div style="font-size:22px;font-weight:700;letter-spacing:1px;color:#ffa600;margin-bottom:18px">YELI</div>
<p style="font-size:17px;line-height:1.45;margin:0 0 14px">{e(line)}</p>
{f'<p style="margin:0 0 18px;padding:10px 14px;border-left:3px solid #ffa600;background:#272831;border-radius:6px;color:#d8d8dc">{e(quote)}</p>' if quote else ''}
<p style="margin:22px 0 4px"><a href="{e(url, quote=True)}" style="display:inline-block;background:#ffa600;color:#1a1100;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">{e(cta)}</a></p>
<hr style="border:0;border-top:1px solid #35373f;margin:26px 0 14px">
<p style="font-size:12px;line-height:1.6;color:#9a9ca6;margin:0">{e(tr['foot'])}<br>
<a href="{e(manage, quote=True)}" style="color:#9a9ca6">{e(tr['manage'])}</a> &middot; <a href="{e(unsub, quote=True)}" style="color:#9a9ca6">{e(tr['unsub'])}</a></p>
</div></body></html>"""
    return subject, text, html


def _mail_headers(unsub):
    return {"List-Unsubscribe": f"<{unsub}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}


# ---------------------------------------------------------------- creating notifications

def _recipients(db, ids, kind):
    out = {}
    for i in range(0, len(ids), 400):
        chunk = ids[i:i + 400]
        qs = ",".join("?" * len(chunk))
        rows = db.execute(
            f"""SELECT u.id, u.email, p.in_app, p.email AS mail, m.lang
                FROM users u
                LEFT JOIN notify_prefs p ON p.user_id = u.id AND p.kind = ?
                LEFT JOIN notify_meta m ON m.user_id = u.id
                WHERE u.id IN ({qs})""",
            [kind, *chunk],
        ).fetchall()
        for r in rows:
            out[r["id"]] = r
    return out


def notify_many(db, user_ids, kind, actor="", ref="", title="", body="", amount=0):
    """Tell these people. The caller commits. Emails are sent only after the request succeeded (see flush_mail)."""
    ids = list(dict.fromkeys(user_ids))
    if not ids or kind not in KINDS:
        return 0
    t = now()
    actor, title, body = clean(actor, 40), clean(title, 120), clean(body, 200)
    d_app, d_mail = DEFAULTS[kind]
    dedupe = DEDUPE_SECONDS.get(kind, 0)
    base = base_url()
    rows = _recipients(db, ids, kind)
    made = 0
    for uid in ids:
        r = rows.get(uid)
        if r is None:
            continue
        in_app = d_app if r["in_app"] is None else r["in_app"]
        want_mail = d_mail if r["mail"] is None else r["mail"]
        if not in_app and not (want_mail and base):
            continue
        if dedupe and db.execute(
            "SELECT 1 FROM notifications WHERE user_id = ? AND kind = ? AND actor = ? AND ref = ? AND created_at > ?",
            (uid, kind, actor, ref, t - dedupe),
        ).fetchone():
            continue
        send_mail = bool(want_mail and base and mailer.enabled() and _under_email_cap(db, uid, t))
        db.execute(
            "INSERT INTO notifications (user_id, kind, actor, ref, title, body, amount, shown, emailed, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (uid, kind, actor, ref, title, body, int(amount), 1 if in_app else 0, 1 if send_mail else 0, t),
        )
        made += 1
        if send_mail:
            unsub = unsubscribe_url(base, uid)
            subject, text, html = compose(kind, r["lang"] or "en", base, unsub, actor, title, body, amount, ref)
            g.setdefault("pending_mail", []).append((r["email"], subject, text, html, _mail_headers(unsub)))
    return made


def notify(db, user_id, kind, **fields):
    return notify_many(db, [user_id], kind, **fields)


def _under_email_cap(db, uid, t):
    n = db.execute("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND emailed = 1 AND created_at > ?", (uid, t - 3600)).fetchone()["n"]
    return n < config.NOTIFY_EMAILS_PER_HOUR


def notify_followers_live(db, streamer_id, username, title):
    """A channel went live: tell its followers (once per half hour, so restarting the stream isn't spam)."""
    t = now()
    row = db.execute("SELECT notified_at FROM streams WHERE user_id = ?", (streamer_id,)).fetchone()
    if row is not None and row["notified_at"] and t - row["notified_at"] < LIVE_COOLDOWN:
        return
    db.execute("UPDATE streams SET notified_at = ? WHERE user_id = ?", (t, streamer_id))
    ids = [r["follower_id"] for r in db.execute("SELECT follower_id FROM follows WHERE followed_id = ? LIMIT ?", (streamer_id, MAX_FOLLOWERS_NOTIFIED))]
    notify_many(db, ids, "live", actor=username, title=title)


@bp.after_app_request
def flush_mail(resp):
    jobs = g.pop("pending_mail", None)
    if jobs and resp.status_code < 400:
        for job in jobs:
            mailer.send_async(*job)
    return resp


# ---------------------------------------------------------------- reading them

def _json(r):
    avatar = f"upload:{r['a_updated']}" if r["a_avatar"] == "upload" else (r["a_avatar"] or "")
    return {"id": r["id"], "kind": r["kind"], "actor": r["actor"], "ref": r["ref"], "title": r["title"], "body": r["body"],
            "amount": r["amount"], "created_at": r["created_at"], "read": r["read_at"] is not None,
            "hue": avatar_hue(r["actor"] or ""), "avatar": avatar}


# the person who caused it, with their current picture
SELECT = """SELECT n.id, n.kind, n.actor, n.ref, n.title, n.body, n.amount, n.created_at, n.read_at,
                   a.avatar AS a_avatar, a.avatar_updated AS a_updated
            FROM notifications n LEFT JOIN users a ON a.username = n.actor"""


def _remember_lang(db, uid):
    lang = _lang(request.args.get("lang"))
    if request.args.get("lang"):
        db.execute("INSERT INTO notify_meta (user_id, lang) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET lang = excluded.lang WHERE lang != excluded.lang", (uid, lang))
        db.commit()


def _unread(db, uid):
    return db.execute("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND shown = 1 AND read_at IS NULL", (uid,)).fetchone()["n"]


@bp.get("/api/notifications")
@login_required
def notifications_list():
    db = get_db()
    uid = current_user()["id"]
    _remember_lang(db, uid)
    t = now()
    # housekeeping: the bell keeps the newest NOTIFY_KEEP, and nothing older than 60 days
    db.execute("DELETE FROM notifications WHERE user_id = ? AND created_at < ?", (uid, t - 60 * 86400))
    db.execute(
        "DELETE FROM notifications WHERE user_id = ? AND id <= COALESCE((SELECT id FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?), 0)",
        (uid, uid, config.NOTIFY_KEEP),
    )
    db.commit()
    rows = db.execute(f"{SELECT} WHERE n.user_id = ? AND n.shown = 1 ORDER BY n.id DESC LIMIT 40", (uid,)).fetchall()
    return jsonify(notifications=[_json(r) for r in rows], unread=_unread(db, uid))


@bp.get("/api/notifications/poll")
@login_required
def notifications_poll():
    """Cheap, called every ~30 s: how many unread, plus what's new since `after` (so the app can show a toast)."""
    db = get_db()
    uid = current_user()["id"]
    _remember_lang(db, uid)
    last = db.execute("SELECT COALESCE(MAX(id), 0) AS n FROM notifications WHERE user_id = ?", (uid,)).fetchone()["n"]
    items = []
    if request.args.get("after") is not None:
        after = int_arg("after")
        rows = db.execute(f"{SELECT} WHERE n.user_id = ? AND n.shown = 1 AND n.id > ? ORDER BY n.id DESC LIMIT 5", (uid, after)).fetchall()
        items = [_json(r) for r in rows]
    return jsonify(unread=_unread(db, uid), last=last, notifications=items)


@bp.post("/api/notifications/read")
@login_required
def notifications_read():
    db = get_db()
    uid = current_user()["id"]
    data = request.get_json(silent=True) or {}
    t = now()
    if data.get("all"):
        db.execute("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", (t, uid))
    else:
        ids = [i for i in (data.get("ids") or []) if isinstance(i, int) and not isinstance(i, bool)][:100]
        for i in ids:
            db.execute("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL", (t, i, uid))
    db.commit()
    return jsonify(ok=True, unread=_unread(db, uid))


@bp.post("/api/notifications/clear")
@login_required
def notifications_clear():
    db = get_db()
    uid = current_user()["id"]
    db.execute("DELETE FROM notifications WHERE user_id = ? AND shown = 1", (uid,))
    db.commit()
    return jsonify(ok=True, unread=0)


# ---------------------------------------------------------------- settings

def prefs_for(db, uid):
    out = {k: {"in_app": bool(DEFAULTS[k][0]), "email": bool(DEFAULTS[k][1])} for k in KINDS}
    for r in db.execute("SELECT kind, in_app, email FROM notify_prefs WHERE user_id = ?", (uid,)):
        if r["kind"] in out:
            out[r["kind"]] = {"in_app": bool(r["in_app"]), "email": bool(r["email"])}
    return out


def _prefs_response(db, me):
    return jsonify(prefs=prefs_for(db, me["id"]), email=me["email"], email_ready=email_ready())


@bp.get("/api/notifications/prefs")
@login_required
def prefs_get():
    return _prefs_response(get_db(), current_user())


@bp.post("/api/notifications/prefs")
@login_required
def prefs_set():
    db = get_db()
    me = current_user()
    data = (request.get_json(silent=True) or {}).get("prefs")
    if not isinstance(data, dict):
        return err("Nothing to save.")
    current = prefs_for(db, me["id"])
    for kind, change in data.items():
        if kind not in KINDS or not isinstance(change, dict):
            return err("Unknown notification type.")
        for key in ("in_app", "email"):
            if key in change:
                if not isinstance(change[key], bool):
                    return err("Use true or false.")
                current[kind][key] = change[key]
        db.execute(
            "INSERT INTO notify_prefs (user_id, kind, in_app, email) VALUES (?,?,?,?) ON CONFLICT(user_id, kind) DO UPDATE SET in_app = excluded.in_app, email = excluded.email",
            (me["id"], kind, int(current[kind]["in_app"]), int(current[kind]["email"])),
        )
    db.commit()
    return _prefs_response(db, me)


_test_sent = {}


@bp.post("/api/notifications/test")
@login_required
def send_test():
    """'Send me a test email': the quickest way to see whether the server's email setup works."""
    me = current_user()
    base = base_url()
    if not mailer.enabled() or not base:
        return err("Email isn't set up on this server yet.", 503)
    t = now()
    if t - _test_sent.get(me["id"], 0) < 30:
        return err("Wait a few seconds before sending another test.", 429)
    _test_sent[me["id"]] = t
    lang = _lang((request.get_json(silent=True) or {}).get("lang"))
    unsub = unsubscribe_url(base, me["id"])
    subject, text, html = compose("test", lang, base, unsub)
    try:
        mailer.send(me["email"], subject, text, html, _mail_headers(unsub))
    except Exception:
        return err("The email couldn't be sent. Check the server's email settings.", 502)
    return jsonify(ok=True, to=me["email"])


# ---------------------------------------------------------------- unsubscribe link (works without logging in)

PAGE = """<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Yeli</title><style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#16171c;color:#f2f2f2;font-family:Arial,Helvetica,sans-serif}}
main{{max-width:420px;margin:24px;padding:28px;background:#1f2026;border:1px solid #35373f;border-radius:12px}}
h1{{margin:0 0 12px;font-size:22px;color:#ffa600;letter-spacing:1px}}p{{line-height:1.5;color:#d8d8dc}}
button,a.b{{display:inline-block;font:inherit;font-weight:700;background:#ffa600;color:#1a1100;border:0;border-radius:8px;padding:12px 22px;text-decoration:none;cursor:pointer}}</style></head>
<body><main><h1>YELI</h1>{body}</main></body></html>"""
U = {
    "en": {"ask": "Stop all notification emails from Yeli?", "yes": "Yes, unsubscribe", "done": "Done. You won't get notification emails from Yeli anymore.", "tip": "You can turn them back on in Settings.", "open": "Open Yeli", "bad": "This link isn't valid."},
    "es": {"ask": "¿Dejar de recibir los correos de notificaciones de Yeli?", "yes": "Sí, darme de baja", "done": "Listo. Ya no recibirás correos de notificaciones de Yeli.", "tip": "Puedes volver a activarlos en Ajustes.", "open": "Abrir Yeli", "bad": "Este enlace no es válido."},
}


def _page(lang, html_body, status=200):
    return Response(PAGE.format(lang=lang, body=html_body), status=status, mimetype="text/html", headers={"Cache-Control": "no-store"})


@bp.route("/unsubscribe/<token>", methods=["GET", "POST"])
def unsubscribe(token):
    try:
        uid = _signer().loads(token)
    except BadSignature:
        return _page("en", f"<p>{U['en']['bad']}</p>", 400)
    db = get_db()
    row = db.execute("SELECT u.id, m.lang FROM users u LEFT JOIN notify_meta m ON m.user_id = u.id WHERE u.id = ?", (uid,)).fetchone()
    if row is None:
        return _page("en", f"<p>{U['en']['bad']}</p>", 404)
    lang = _lang(row["lang"])
    u = U[lang]
    if request.method == "GET":
        # A GET never changes anything (mail scanners open links): the person confirms with the button.
        return _page(lang, f"<p>{u['ask']}</p><form method=\"post\"><button type=\"submit\">{u['yes']}</button></form>")
    for kind in KINDS:
        db.execute(
            "INSERT INTO notify_prefs (user_id, kind, in_app, email) VALUES (?,?,?,0) ON CONFLICT(user_id, kind) DO UPDATE SET email = 0",
            (uid, kind, DEFAULTS[kind][0]),
        )
    db.commit()
    return _page(lang, f"<p>{u['done']}</p><p>{u['tip']}</p><a class=\"b\" href=\"/\">{u['open']}</a>")
