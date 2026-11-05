"""Sending email without blocking requests. Standard library only.

Pick ONE way in the environment (see config.py / .env.example):
  * YELI_RESEND_API_KEY  - an HTTPS email API (Resend). Use this on hosts that block SMTP (Render's free plan does).
  * YELI_SMTP_HOST       - any SMTP server (Gmail app password, Brevo, Mailgun, your own...).
  * YELI_MAIL_CONSOLE=1  - development: print the email instead of sending it.
"""
import json
import logging
import queue
import smtplib
import ssl
import threading
import urllib.request
from email.message import EmailMessage
from email.utils import formataddr, parseaddr

from . import config

log = logging.getLogger("yeli.mail")

_queue = queue.Queue(maxsize=500)
_worker = None
_lock = threading.Lock()
sent_log = []  # the last few emails that were handed over (for tests and console mode)


def enabled():
    """True when emails can really go out (or are printed, in development)."""
    return bool(config.MAIL_CONSOLE or config.RESEND_API_KEY or (config.SMTP_HOST and config.MAIL_FROM))


def sender():
    return config.MAIL_FROM or "Yeli <no-reply@localhost>"


def _build(to, subject, text, html, headers):
    msg = EmailMessage()
    name, addr = parseaddr(sender())
    msg["From"] = formataddr((name, addr)) if addr else sender()
    msg["To"] = to
    msg["Subject"] = subject
    for k, v in (headers or {}).items():
        msg[k] = v
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    return msg


def _send_resend(to, subject, text, html, headers):
    body = {"from": sender(), "to": [to], "subject": subject, "text": text}
    if html:
        body["html"] = html
    if headers:
        body["headers"] = headers
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {config.RESEND_API_KEY}", "Content-Type": "application/json", "User-Agent": "yeli/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        r.read()


def _send_smtp(to, subject, text, html, headers):
    msg = _build(to, subject, text, html, headers)
    ctx = ssl.create_default_context()
    if config.SMTP_SECURITY == "ssl":
        server = smtplib.SMTP_SSL(config.SMTP_HOST, config.SMTP_PORT, timeout=15, context=ctx)
    else:
        server = smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=15)
    with server:
        if config.SMTP_SECURITY == "starttls":
            server.starttls(context=ctx)
        if config.SMTP_USER:
            server.login(config.SMTP_USER, config.SMTP_PASSWORD)
        server.send_message(msg)


def send(to, subject, text, html=None, headers=None):
    """Send now (blocking). Raises on failure. Used by the background worker and by the 'test email' button."""
    sent_log.append({"to": to, "subject": subject, "text": text, "html": html, "headers": headers or {}})
    del sent_log[:-20]
    if config.RESEND_API_KEY:
        _send_resend(to, subject, text, html, headers)
    elif config.SMTP_HOST and config.MAIL_FROM:
        _send_smtp(to, subject, text, html, headers)
    elif config.MAIL_CONSOLE:
        log.warning("EMAIL to %s | %s\n%s", to, subject, text)
    else:
        raise RuntimeError("Email isn't set up on this server.")


def _run():
    while True:
        job = _queue.get()
        try:
            send(*job)
        except Exception as exc:  # a bad address or a provider outage must never take the app down
            log.warning("Couldn't send email to %s: %s", job[0], exc)
        finally:
            _queue.task_done()


def send_async(to, subject, text, html=None, headers=None):
    """Queue an email for the background thread. Returns False when email is off or the queue is full."""
    global _worker
    if not enabled():
        return False
    with _lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_run, name="yeli-mail", daemon=True)
            _worker.start()
    try:
        _queue.put_nowait((to, subject, text, html, headers))
        return True
    except queue.Full:
        return False
