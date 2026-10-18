"""Yeli: a small live-streaming platform (Flask + SQLite)."""
import os

from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix

from . import config, db
from .core import err


def create_app():
    app = Flask(
        __name__,
        static_folder=str(config.ROOT_DIR / "static"),
        template_folder=str(config.ROOT_DIR / "templates"),
    )
    app.config.update(
        SECRET_KEY=config.load_secret_key(),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("YELI_HTTPS") == "1",
        PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 30,
        MAX_CONTENT_LENGTH=128 * 1024,
    )
    hosts = [h.strip() for h in os.environ.get("YELI_ALLOWED_HOSTS", "").split(",") if h.strip()]
    if hosts:
        app.config["TRUSTED_HOSTS"] = hosts  # e.g. yeli.onrender.com (Flask 3.1+)
    if os.environ.get("YELI_PROXY") == "1":
        # Behind Render's proxy: trust X-Forwarded-For/Proto/Host so client IPs and https are seen correctly.
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
    db.init_db()
    app.teardown_appcontext(db.close_db)

    @app.get("/healthz")
    def healthz():
        return "ok", 200, {"Cache-Control": "no-store"}

    from . import accounts, bot, channels, chat, media, streaming, upgrades, wallet
    from .security import install as install_security

    for module in (channels, accounts, chat, wallet, upgrades, bot, streaming, media):
        app.register_blueprint(module.bp)
    install_security(app)
    return app
