"""SQLite: schema, migrations and the per-request connection."""
import sqlite3

from flask import g

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    bio           TEXT NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL,
    avatar        TEXT NOT NULL DEFAULT '',
    avatar_updated INTEGER NOT NULL DEFAULT 0,
    stream_key    TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS avatars (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data       BLOB NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    deleted    INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER,
    kind       TEXT NOT NULL DEFAULT 'msg',
    sticker    TEXT NOT NULL DEFAULT '',
    amount     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chat_channel ON chat_messages(channel_id, id);
CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (follower_id, followed_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows(followed_id);
CREATE TABLE IF NOT EXISTS streams (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    is_live    INTEGER NOT NULL DEFAULT 0,
    title      TEXT NOT NULL DEFAULT '',
    category   TEXT NOT NULL DEFAULT 'Other',
    started_at INTEGER,
    last_seen  INTEGER,
    mode       TEXT NOT NULL DEFAULT 'p2p'
);
CREATE TABLE IF NOT EXISTS thumbnails (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data       BLOB NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS viewers (
    peer_id     TEXT PRIMARY KEY,
    streamer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_seen   INTEGER NOT NULL,
    viewer_key  TEXT NOT NULL DEFAULT '',
    user_id     INTEGER,
    superseded  INTEGER NOT NULL DEFAULT 0,
    ip          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_viewers_streamer ON viewers(streamer_id);
CREATE TABLE IF NOT EXISTS signals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    to_key     TEXT NOT NULL,
    from_key   TEXT NOT NULL,
    kind       TEXT NOT NULL,
    payload    TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signals_to ON signals(to_key, id);
CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at);

-- Money. Coins are integers, money is integer cents. Rows are never deleted.
CREATE TABLE IF NOT EXISTS wallets (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    bought  INTEGER NOT NULL DEFAULT 0 CHECK (bought >= 0)
);
CREATE TABLE IF NOT EXISTS purchases (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    pack_id     TEXT NOT NULL,
    coins       INTEGER NOT NULL,
    gross_cents INTEGER NOT NULL,
    tax_cents   INTEGER NOT NULL,
    fee_cents   INTEGER NOT NULL,
    net_cents   INTEGER NOT NULL,
    provider    TEXT NOT NULL,
    provider_ref TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  INTEGER NOT NULL,
    paid_at     INTEGER
);
CREATE TABLE IF NOT EXISTS donations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user  INTEGER NOT NULL REFERENCES users(id),
    to_user    INTEGER NOT NULL REFERENCES users(id),
    coins      INTEGER NOT NULL CHECK (coins > 0),
    message    TEXT NOT NULL DEFAULT '',
    sticker    TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_donations_to ON donations(to_user, created_at);
CREATE TABLE IF NOT EXISTS payouts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    coins          INTEGER NOT NULL,
    gross_cents    INTEGER NOT NULL,
    withheld_cents INTEGER NOT NULL,
    fee_cents      INTEGER NOT NULL,
    net_cents      INTEGER NOT NULL,
    method         TEXT NOT NULL,
    destination    TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'requested',
    note           TEXT NOT NULL DEFAULT '',
    test           INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    pool       TEXT NOT NULL,
    kind       TEXT NOT NULL,
    coins      INTEGER NOT NULL,
    ref        TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id, id);
"""


def init_db(path=None):
    con = sqlite3.connect(path or config.DB_PATH)
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(SCHEMA)
    # Databases created by earlier versions don't have the avatar columns yet.
    cols = {r[1] for r in con.execute("PRAGMA table_info(users)")}
    if "avatar" not in cols:
        con.execute("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''")
    if "avatar_updated" not in cols:
        con.execute("ALTER TABLE users ADD COLUMN avatar_updated INTEGER NOT NULL DEFAULT 0")
    for table, columns in {
        "users": [("stream_key", "TEXT NOT NULL DEFAULT ''")],
        "streams": [("mode", "TEXT NOT NULL DEFAULT 'p2p'")],
        "chat_messages": [("kind", "TEXT NOT NULL DEFAULT 'msg'"), ("sticker", "TEXT NOT NULL DEFAULT ''"), ("amount", "INTEGER NOT NULL DEFAULT 0")],
        "viewers": [("viewer_key", "TEXT NOT NULL DEFAULT ''"), ("user_id", "INTEGER"), ("superseded", "INTEGER NOT NULL DEFAULT 0"), ("ip", "TEXT NOT NULL DEFAULT ''")],
    }.items():
        have = {r[1] for r in con.execute(f"PRAGMA table_info({table})")}
        for name, ddl in columns:
            if name not in have:
                con.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
    con.commit()
    con.close()


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(config.DB_PATH, timeout=15)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
        g.db.execute("PRAGMA synchronous = NORMAL")  # safe with WAL, much faster writes
    return g.db


def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()
