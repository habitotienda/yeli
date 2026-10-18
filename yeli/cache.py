"""A tiny in-process cache for public JSON lists.

Home, Explore and Search refresh every few seconds for every visitor. The answer is the same for everybody,
so computing it once per couple of seconds keeps the database calm when many people are watching.
"""
import time
from functools import wraps

from flask import Response, request

from . import config

_MAX_ENTRIES = 256


def cached_json(fn):
    store = {}

    @wraps(fn)
    def wrapper(*args, **kwargs):
        ttl = config.LIST_CACHE_SECONDS
        if ttl <= 0:
            return fn(*args, **kwargs)
        key = request.full_path
        now = time.monotonic()
        hit = store.get(key)
        if hit and now - hit[0] < ttl:
            return Response(hit[1], mimetype="application/json")
        resp = fn(*args, **kwargs)
        if len(store) >= _MAX_ENTRIES:
            store.clear()
        store[key] = (now, resp.get_data())
        return resp

    return wrapper
