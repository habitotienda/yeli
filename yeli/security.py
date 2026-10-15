"""Request hooks: CSRF guard for the JSON API and security headers (CSP)."""
from urllib.parse import urlparse

from flask import request

from . import config
from .core import err


def media_origin():
    u = urlparse(config.MEDIA_URL)
    return f"{u.scheme}://{u.netloc}" if u.scheme and u.netloc else ""


def csp():
    connect = "'self'" + (f" {media_origin()}" if config.MEDIA_URL else "")
    return (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "media-src 'self' blob:; "
        "worker-src 'self'; "
        f"connect-src {connect}; "
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    )


def install(app):
    @app.before_request
    def require_json_for_writes():
        # A cross-site <form> cannot send application/json, which blocks CSRF.
        if request.path.startswith("/api/") and request.path != "/api/media/auth" and request.method not in ("GET", "HEAD", "OPTIONS"):
            if request.mimetype != "application/json":
                return err("Expected a JSON request.", 415)

    @app.after_request
    def security_headers(resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "same-origin"
        resp.headers["Permissions-Policy"] = "camera=(self), microphone=(self), display-capture=(self)"
        resp.headers["Content-Security-Policy"] = csp()
        if request.path.startswith("/api/"):
            resp.headers.setdefault("Cache-Control", "no-store")
        return resp
