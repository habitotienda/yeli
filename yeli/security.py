"""Request hooks: CSRF guard for the JSON API and security headers (CSP)."""
import re
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


VOD_CHUNK_PATH = re.compile(r"^/api/vod/[a-f0-9]{16}/chunk$")
GALLERY_GIF_PATH = re.compile(r"^/api/gallery/[a-f0-9]{16}/gif$")


def install(app):
    @app.before_request
    def require_json_for_writes():
        # A cross-site <form> cannot send application/json (nor application/octet-stream), which blocks CSRF.
        if request.path.startswith("/api/") and request.path != "/api/media/auth" and request.method not in ("GET", "HEAD", "OPTIONS"):
            if VOD_CHUNK_PATH.match(request.path):
                # The only route that takes a big body: a piece of a recorded stream.
                if request.mimetype != "application/octet-stream":
                    return err("Expected a binary upload.", 415)
                request.max_content_length = config.VOD_CHUNK_MAX
            elif GALLERY_GIF_PATH.match(request.path):
                # The GIF of a gallery picture: small, but bigger than a normal JSON request.
                if request.mimetype != "application/octet-stream":
                    return err("Expected a binary upload.", 415)
                request.max_content_length = config.GALLERY_GIF_MAX + 1024
            elif request.mimetype != "application/json":
                return err("Expected a JSON request.", 415)

    @app.after_request
    def security_headers(resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "same-origin"
        resp.headers["Permissions-Policy"] = "camera=(self), microphone=(self), display-capture=(self)"
        resp.headers["Content-Security-Policy"] = csp()
        if request.is_secure:
            resp.headers["Strict-Transport-Security"] = "max-age=31536000"
        if request.path.startswith("/api/"):
            resp.headers.setdefault("Cache-Control", "no-store")
        return resp
