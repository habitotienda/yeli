"""Yeli: a small live-streaming platform (Flask + SQLite)."""
from flask import Flask

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
        SESSION_COOKIE_SECURE=__import__("os").environ.get("YELI_HTTPS") == "1",
        PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 30,
        MAX_CONTENT_LENGTH=128 * 1024,
    )
    db.init_db()
    app.teardown_appcontext(db.close_db)

    from . import accounts, channels, chat, media, streaming, wallet
    from .security import install as install_security

    for module in (channels, accounts, chat, wallet, streaming, media):
        app.register_blueprint(module.bp)
    install_security(app)
    return app
