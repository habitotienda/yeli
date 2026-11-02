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
    stream_key    TEXT NOT NULL DEFAULT '',
    name_color    TEXT NOT NULL DEFAULT ''
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
    mode       TEXT NOT NULL DEFAULT 'p2p',
    ip         TEXT NOT NULL DEFAULT ''
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

-- Upgrades: points bought with Yelis, spent on levels. `spendings` = earned Yelis used instead of cashed out.
CREATE TABLE IF NOT EXISTS upgrade_points (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    points  INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0)
);
CREATE TABLE IF NOT EXISTS upgrades (
    user_id INTEGER NOT NULL REFERENCES users(id),
    track   TEXT NOT NULL,
    level   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, track)
);
CREATE TABLE IF NOT EXISTS spendings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    coins      INTEGER NOT NULL CHECK (coins > 0),
    kind       TEXT NOT NULL,
    ref        TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);

-- Chat bot and moderation
CREATE TABLE IF NOT EXISTS commands (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    response   TEXT NOT NULL,
    cooldown   INTEGER NOT NULL DEFAULT 5,
    perm       TEXT NOT NULL DEFAULT 'everyone',
    uses       INTEGER NOT NULL DEFAULT 0,
    enabled    INTEGER NOT NULL DEFAULT 1,
    every_min  INTEGER NOT NULL DEFAULT 0,
    last_run   INTEGER NOT NULL DEFAULT 0,
    UNIQUE (channel_id, name)
);
CREATE TABLE IF NOT EXISTS chat_settings (
    channel_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    slow_seconds   INTEGER NOT NULL DEFAULT 0,
    followers_only INTEGER NOT NULL DEFAULT 0,
    block_links    INTEGER NOT NULL DEFAULT 0,
    banned_words   TEXT NOT NULL DEFAULT '',
    caps_percent   INTEGER NOT NULL DEFAULT 0,
    welcome        INTEGER NOT NULL DEFAULT 0,
    welcome_text   TEXT NOT NULL DEFAULT 'Thanks for the follow, {user}!',
    thanks         INTEGER NOT NULL DEFAULT 0,
    thanks_text    TEXT NOT NULL DEFAULT 'Thank you {user} for {amount} Yelis!',
    tts_enabled    INTEGER NOT NULL DEFAULT 0,
    tts_command    TEXT NOT NULL DEFAULT 'say',
    tts_name       INTEGER NOT NULL DEFAULT 1,
    tts_template   TEXT NOT NULL DEFAULT '{user} says: {text}',
    tts_perm       TEXT NOT NULL DEFAULT 'everyone',
    tts_cooldown   INTEGER NOT NULL DEFAULT 30,
    tts_max        INTEGER NOT NULL DEFAULT 120,
    tts_lang       TEXT NOT NULL DEFAULT ''
);

-- Moderators and bans of each channel's chat
CREATE TABLE IF NOT EXISTS chat_mods (
    channel_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (channel_id, user_id)
);
CREATE TABLE IF NOT EXISTS chat_bans (
    channel_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    until      INTEGER NOT NULL DEFAULT 0,
    reason     TEXT NOT NULL DEFAULT '',
    by_user    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (channel_id, user_id)
);

-- Free upgrade points for viewers who stay an hour
CREATE TABLE IF NOT EXISTS watch_sessions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    streamer_id    INTEGER NOT NULL,
    viewer_key     TEXT NOT NULL,
    user_id        INTEGER,
    ip             TEXT NOT NULL DEFAULT '',
    started_at     INTEGER NOT NULL,
    last_seen      INTEGER NOT NULL,
    awarded        INTEGER NOT NULL DEFAULT 0,
    stream_started INTEGER NOT NULL DEFAULT 0,
    UNIQUE (streamer_id, viewer_key)
);
CREATE TABLE IF NOT EXISTS free_points (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    viewer_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    notified   INTEGER NOT NULL DEFAULT 0
);

-- Stream alerts: events happen, rules (image + sound) say how to show them
CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    username   TEXT NOT NULL,
    amount     INTEGER NOT NULL DEFAULT 0,
    sticker    TEXT NOT NULL DEFAULT '',
    message    TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_channel ON events(channel_id, id);
CREATE TABLE IF NOT EXISTS alert_rules (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event      TEXT NOT NULL,
    min_amount INTEGER NOT NULL DEFAULT 0,
    title      TEXT NOT NULL DEFAULT '',
    image      TEXT NOT NULL DEFAULT '',
    sound      TEXT NOT NULL DEFAULT '',
    volume     INTEGER NOT NULL DEFAULT 80,
    seconds    INTEGER NOT NULL DEFAULT 5,
    enabled    INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS assets (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    mime       TEXT NOT NULL,
    data       BLOB NOT NULL,
    created_at INTEGER NOT NULL
);
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
        "users": [("stream_key", "TEXT NOT NULL DEFAULT ''"), ("name_color", "TEXT NOT NULL DEFAULT ''")],
        "streams": [("mode", "TEXT NOT NULL DEFAULT 'p2p'"), ("ip", "TEXT NOT NULL DEFAULT ''")],
        "chat_settings": [("tts_enabled", "INTEGER NOT NULL DEFAULT 0"), ("tts_command", "TEXT NOT NULL DEFAULT 'say'"),
                          ("tts_name", "INTEGER NOT NULL DEFAULT 1"), ("tts_template", "TEXT NOT NULL DEFAULT '{user} says: {text}'"),
                          ("tts_perm", "TEXT NOT NULL DEFAULT 'everyone'"), ("tts_cooldown", "INTEGER NOT NULL DEFAULT 30"),
                          ("tts_max", "INTEGER NOT NULL DEFAULT 120"), ("tts_lang", "TEXT NOT NULL DEFAULT ''")],
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
