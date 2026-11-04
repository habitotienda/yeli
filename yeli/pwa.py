"""Makes Yeli installable: the web manifest and the service worker (both must live at the site root)."""
import hashlib

from flask import Blueprint, Response, current_app

from . import config

bp = Blueprint("pwa", __name__)

_STATIC = config.ROOT_DIR / "static"
_SHELL_SUFFIXES = {".css", ".js", ".svg", ".png", ".webmanifest"}


def _shell_files():
    files = sorted(p for p in _STATIC.rglob("*") if p.is_file() and p.suffix in _SHELL_SUFFIXES and p.name != "sw.js")
    return files


@bp.get("/manifest.webmanifest")
def manifest():
    body = (_STATIC / "manifest.webmanifest").read_text(encoding="utf-8")
    return Response(body, mimetype="application/manifest+json", headers={"Cache-Control": "no-cache"})


@bp.get("/sw.js")
def service_worker():
    files = _shell_files()
    # The version changes whenever any shipped file (or the worker itself) changes.
    digest = hashlib.sha1()
    for p in files + [_STATIC / "sw.js", config.ROOT_DIR / "templates" / "index.html"]:
        st = p.stat()
        digest.update(f"{p.name}:{st.st_size}:{int(st.st_mtime)}".encode())
    urls = ["/"] + ["/static/" + p.relative_to(_STATIC).as_posix() for p in files]
    import json

    head = f"const CACHE_VERSION = {json.dumps('yeli-' + digest.hexdigest()[:12])};\nconst PRECACHE = {json.dumps(urls)};\n"
    body = head + (_STATIC / "sw.js").read_text(encoding="utf-8")
    return Response(body, mimetype="text/javascript", headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"})
