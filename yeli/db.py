"""Database: schema, migrations and the per-request connection.

Production uses Supabase (Postgres) when DATABASE_URL is set. Without it the app falls back to a local SQLite file,
which is what development and the tests use. The SQL in the modules is written once (SQLite flavour) and translated
for Postgres by `pg_sql()` below, so both backends run the same code.
"""
import functools
import os
import re
import sqlite3
import sys

from flask import g

from . import config

try:  # only needed when DATABASE_URL is set
    import psycopg
    from psycopg.adapt import Loader
except ImportError:  # pragma: no cover
    psycopg = None
    Loader = object

USE_PG = bool(config.DATABASE_URL)
INTEGRITY_ERRORS = (sqlite3.IntegrityError,) + ((psycopg.IntegrityError,) if psycopg else ())
DB_ERRORS = (sqlite3.Error,) + ((psycopg.Error,) if psycopg else ())

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
    amount     INTEGER NOT NULL DEFAULT 0,
    platform   TEXT NOT NULL DEFAULT '',
    ext_name   TEXT NOT NULL DEFAULT ''
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
CREATE TABLE IF NOT EXISTS destinations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform   TEXT NOT NULL,
    name       TEXT NOT NULL DEFAULT '',
    url        TEXT NOT NULL,
    stream_key TEXT NOT NULL,
    enabled    INTEGER NOT NULL DEFAULT 1,
    fmt        TEXT NOT NULL DEFAULT 'original',
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_destinations_user ON destinations(user_id);
CREATE TABLE IF NOT EXISTS bridges (
    user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token          TEXT NOT NULL,
    twitch_channel TEXT NOT NULL DEFAULT '',
    twitch_enabled INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bridges_token ON bridges(token);
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

-- Daily chest: watch time per account per UTC day, what was opened, and the stickers/colors each account owns
CREATE TABLE IF NOT EXISTS chest_progress (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day       INTEGER NOT NULL,
    seconds   INTEGER NOT NULL DEFAULT 0,
    last_tick INTEGER NOT NULL,
    PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS chest_opens (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day       INTEGER NOT NULL,
    kind      TEXT NOT NULL,
    value     TEXT NOT NULL,
    opened_at INTEGER NOT NULL,
    UNIQUE (user_id, day)
);
CREATE TABLE IF NOT EXISTS chest_items (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind    TEXT NOT NULL,
    value   TEXT NOT NULL,
    got_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind, value)
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
-- Saved streams. The video itself is a file in config.VOD_DIR named <id>.webm / <id>.mp4.
CREATE TABLE IF NOT EXISTS vods (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT 'Other',
    mime        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'recording',
    size        INTEGER NOT NULL DEFAULT 0,
    chunks      INTEGER NOT NULL DEFAULT 0,
    duration    INTEGER NOT NULL DEFAULT 0,
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER,
    updated_at  INTEGER NOT NULL,
    cover       BLOB,
    cover_ver   INTEGER NOT NULL DEFAULT 0,
    edited      INTEGER NOT NULL DEFAULT 0,
    -- 'private' = a clip only its owner can see; 'public' = published on the channel. Older rows were public.
    visibility  TEXT NOT NULL DEFAULT 'public',
    -- 'live' = recorded from a stream, 'edit' = exported from the video editor
    source      TEXT NOT NULL DEFAULT 'live',
    live_pct    INTEGER NOT NULL DEFAULT -1,
    project_id  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_vods_user ON vods(user_id, started_at);

-- Gallery: pictures taken from a stream when it is published as square (1:1) or portrait (4:5). A picture can have a price
-- in Yelis; whoever buys it keeps it as a GIF (the `gif` column) that they can send in any chat.
CREATE TABLE IF NOT EXISTS gallery_items (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vod_id      TEXT NOT NULL DEFAULT '',
    title       TEXT NOT NULL DEFAULT '',
    aspect      TEXT NOT NULL DEFAULT '1:1',
    price       INTEGER NOT NULL DEFAULT 0,
    image       BLOB NOT NULL,
    gif         BLOB,
    sales       INTEGER NOT NULL DEFAULT 0,
    removed     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gallery_user ON gallery_items(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gallery_new ON gallery_items(removed, created_at);

-- Who owns which gallery picture (the author owns their own). Owners can send its GIF in chat.
CREATE TABLE IF NOT EXISTS gallery_owned (
    item_id    TEXT NOT NULL REFERENCES gallery_items(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    paid       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (item_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_gallery_owned_user ON gallery_owned(user_id, created_at);

-- Video editor projects (drafts): the list of cuts, not the video. They live here so you can continue on another device.
CREATE TABLE IF NOT EXISTS edit_projects (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT '',
    data       TEXT NOT NULL,
    duration   REAL NOT NULL DEFAULT 0,
    live_pct   INTEGER NOT NULL DEFAULT 0,
    clips      INTEGER NOT NULL DEFAULT 0,
    cover_vod  TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edit_projects_user ON edit_projects(user_id, updated_at);

-- Likes on a LIVE stream: a free, weaker version of the Recommendation upgrade. They are wiped when the stream starts and when it stops.
CREATE TABLE IF NOT EXISTS live_likes (
    streamer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (streamer_id, user_id)
);

CREATE TABLE IF NOT EXISTS vod_likes (
    vod_id     TEXT NOT NULL REFERENCES vods(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (vod_id, user_id)
);

CREATE TABLE IF NOT EXISTS vod_comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    vod_id     TEXT NOT NULL REFERENCES vods(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    -- replies: parent_id is always a top-level comment (one level, like YouTube); reply_to is who is being answered
    parent_id  INTEGER REFERENCES vod_comments(id) ON DELETE CASCADE,
    reply_to   INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_vod_comments ON vod_comments(vod_id, id);

CREATE TABLE IF NOT EXISTS vod_comment_likes (
    comment_id INTEGER NOT NULL REFERENCES vod_comments(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (comment_id, user_id)
);

-- Notifications: one row per event per person. `shown` = appears in the bell; `emailed` = an email went out for it.
CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    actor      TEXT NOT NULL DEFAULT '',
    ref        TEXT NOT NULL DEFAULT '',
    title      TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL DEFAULT '',
    amount     INTEGER NOT NULL DEFAULT 0,
    shown      INTEGER NOT NULL DEFAULT 1,
    emailed    INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    read_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id);
CREATE TABLE IF NOT EXISTS notify_prefs (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind    TEXT NOT NULL,
    in_app  INTEGER NOT NULL DEFAULT 1,
    email   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, kind)
);
CREATE TABLE IF NOT EXISTS notify_meta (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    lang    TEXT NOT NULL DEFAULT 'en'
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


# Columns added after the first release. Older SQLite files get them with ALTER TABLE; on Postgres they are added the same way.
MIGRATIONS = {
        "users": [("stream_key", "TEXT NOT NULL DEFAULT ''"), ("name_color", "TEXT NOT NULL DEFAULT ''")],
        "streams": [("mode", "TEXT NOT NULL DEFAULT 'p2p'"), ("ip", "TEXT NOT NULL DEFAULT ''"), ("notified_at", "INTEGER NOT NULL DEFAULT 0")],
        "chat_settings": [("tts_enabled", "INTEGER NOT NULL DEFAULT 0"), ("tts_command", "TEXT NOT NULL DEFAULT 'say'"),
                          ("tts_name", "INTEGER NOT NULL DEFAULT 1"), ("tts_template", "TEXT NOT NULL DEFAULT '{user} says: {text}'"),
                          ("tts_perm", "TEXT NOT NULL DEFAULT 'everyone'"), ("tts_cooldown", "INTEGER NOT NULL DEFAULT 30"),
                          ("tts_max", "INTEGER NOT NULL DEFAULT 120"), ("tts_lang", "TEXT NOT NULL DEFAULT ''"),
                          ("tts_output", "TEXT NOT NULL DEFAULT 'stream'")],
        "chat_messages": [("kind", "TEXT NOT NULL DEFAULT 'msg'"), ("sticker", "TEXT NOT NULL DEFAULT ''"), ("amount", "INTEGER NOT NULL DEFAULT 0"),
                          ("platform", "TEXT NOT NULL DEFAULT ''"), ("ext_name", "TEXT NOT NULL DEFAULT ''")],
        "vods": [("visibility", "TEXT NOT NULL DEFAULT 'public'"), ("source", "TEXT NOT NULL DEFAULT 'live'"),
                 # share of live footage in an edit (-1: an older export that was never measured); the project it came from
                 ("live_pct", "INTEGER NOT NULL DEFAULT -1"), ("project_id", "TEXT NOT NULL DEFAULT ''"),
                 # shape of the picture ('16:9', '9:16', '1:1', '4:5') and what it was published as ('video' or 'short')
                 ("aspect", "TEXT NOT NULL DEFAULT '16:9'"), ("kind", "TEXT NOT NULL DEFAULT 'video'")],
        "vod_comments": [("parent_id", "INTEGER REFERENCES vod_comments(id) ON DELETE CASCADE"),
                         ("reply_to", "INTEGER REFERENCES users(id) ON DELETE SET NULL")],
        "viewers": [("viewer_key", "TEXT NOT NULL DEFAULT ''"), ("user_id", "INTEGER"), ("superseded", "INTEGER NOT NULL DEFAULT 0"), ("ip", "TEXT NOT NULL DEFAULT ''")],
    }


def init_db(path=None):
    if USE_PG and path is None:
        return init_pg()
    con = sqlite3.connect(path or config.DB_PATH)
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(SCHEMA)
    # Databases created by earlier versions don't have the avatar columns yet.
    cols = {r[1] for r in con.execute("PRAGMA table_info(users)")}
    if "avatar" not in cols:
        con.execute("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''")
    if "avatar_updated" not in cols:
        con.execute("ALTER TABLE users ADD COLUMN avatar_updated INTEGER NOT NULL DEFAULT 0")
    for table, columns in MIGRATIONS.items():
        have = {r[1] for r in con.execute(f"PRAGMA table_info({table})")}
        for name, ddl in columns:
            if name not in have:
                con.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
    # Created here (not in SCHEMA) because older databases only get the column from the loop above.
    con.execute("CREATE INDEX IF NOT EXISTS idx_vod_replies ON vod_comments(parent_id, id)")
    con.commit()
    con.close()


# ---------------------------------------------------------------------------------------------------------------
# Postgres (Supabase)
# ---------------------------------------------------------------------------------------------------------------
_TABLES = re.findall(r"CREATE TABLE IF NOT EXISTS (\w+)", SCHEMA)
# tables whose primary key is a generated number called id (their INSERTs get RETURNING id, so cursor.lastrowid works)
_AUTO_ID = set(re.findall(r"CREATE TABLE IF NOT EXISTS (\w+) \(\s*id\s+INTEGER PRIMARY KEY AUTOINCREMENT", SCHEMA))
# primary keys of the tables written with INSERT OR REPLACE
_REPLACE_PK = {"avatars": "user_id", "thumbnails": "user_id", "viewers": "peer_id"}


def _table_columns():
    cols = {}
    for name, body in re.findall(r"CREATE TABLE IF NOT EXISTS (\w+) \((.*?)\n\);", SCHEMA, re.S):
        cols[name] = {m for m in re.findall(r"^\s+(\w+)\s+(?:INTEGER|TEXT|BLOB|REAL)\b", body, re.M)}
    for table, columns in MIGRATIONS.items():
        cols.setdefault(table, set()).update(n for n, _ in columns)
    return cols


_COLS = _table_columns()


def pg_schema():
    """The SQLite schema rewritten for Postgres, as a list of statements. Also printed by `python -m yeli.db`."""
    sql = SCHEMA
    sql = re.sub(r"(\w+)\s+TEXT(\s+NOT NULL\s+UNIQUE)\s+COLLATE NOCASE", r"\1 CITEXT\2", sql)  # usernames and emails ignore case
    sql = sql.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY")
    sql = re.sub(r"\bINTEGER\b", "BIGINT", sql)
    sql = re.sub(r"\bBLOB\b", "BYTEA", sql)
    sql = re.sub(r"\bREAL\b", "DOUBLE PRECISION", sql)
    sql = re.sub(r"--[^\n]*", "", sql)
    statements = ["CREATE EXTENSION IF NOT EXISTS citext"]
    statements += [x.strip() for x in sql.split(";") if x.strip()]
    for table, columns in MIGRATIONS.items():
        for name, ddl in columns:
            ddl = re.sub(r"\bINTEGER\b", "BIGINT", ddl)
            statements.append(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {name} {ddl}")
    statements.append("CREATE INDEX IF NOT EXISTS idx_vod_replies ON vod_comments(parent_id, id)")
    # Supabase publishes every table of the public schema through its REST API. The app talks to the database directly,
    # so lock that door: with row level security on and no policies, the anon and authenticated keys can read nothing.
    for t in _TABLES:
        statements.append(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
    statements.append(
        "DO $$ BEGIN "
        "IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon; END IF; "
        "IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated; END IF; "
        "END $$"
    )
    return statements


_LITERAL = re.compile(r"'(?:[^']|'')*'")


@functools.lru_cache(maxsize=1024)
def pg_sql(sql):
    """Translate one SQLite-flavoured statement. Returns (postgres sql, returns_id)."""
    lits = []

    def hide(m):
        lits.append(m.group(0))
        return f"\x00{len(lits) - 1}\x00"

    code = _LITERAL.sub(hide, sql).strip().rstrip(";")
    returns_id = False
    if re.fullmatch(r"BEGIN\s+IMMEDIATE", code, re.I):
        # SQLite's BEGIN IMMEDIATE let one writer at a time reserve money. Same here: one transaction at a time past this line.
        return "SELECT pg_advisory_xact_lock(727001)", False
    code = re.sub(r"\s+COLLATE\s+NOCASE\b", "", code, flags=re.I)
    code = re.sub(r"\bLIKE\b", "ILIKE", code)  # SQLite's LIKE ignores case, Postgres' doesn't
    m = re.match(r"INSERT\s+OR\s+REPLACE\s+INTO\s+(\w+)\s*\(([^)]*)\)(.*)$", code, re.I | re.S)
    if m:
        table, cols, rest = m.group(1), [c.strip() for c in m.group(2).split(",")], m.group(3)
        pk = _REPLACE_PK[table]
        sets = ", ".join(f"{c} = excluded.{c}" for c in cols if c != pk)
        code = f"INSERT INTO {table} ({', '.join(cols)}){rest} ON CONFLICT ({pk}) DO UPDATE SET {sets}"
    elif re.match(r"INSERT\s+OR\s+IGNORE\s+INTO", code, re.I):
        code = re.sub(r"INSERT\s+OR\s+IGNORE\s+INTO", "INSERT INTO", code, count=1, flags=re.I) + " ON CONFLICT DO NOTHING"
    m = re.match(r"INSERT\s+INTO\s+(\w+)", code, re.I)
    if m:
        table = m.group(1)
        up = re.search(r"DO\s+UPDATE\s+SET\b", code, re.I)
        if up:
            # In an upsert, a bare column name is ambiguous (the table's or `excluded`'s): name the table.
            cols = _COLS.get(table, set())

            tail = re.sub(r"(?<![\w.])([A-Za-z_]\w*)\b", lambda t: qualify_at(t, code, up.end(), cols, table), code[up.end():])
            code = code[:up.end()] + tail
        elif "ON CONFLICT" not in code.upper() and "RETURNING" not in code.upper() and table in _AUTO_ID:
            code += " RETURNING id"
            returns_id = True
    code = code.replace("%", "%%")
    code = code.replace("?", "%s")
    code = re.sub(r"(?<![:\w]):([A-Za-z_]\w*)", r"%(\1)s", code)
    code = re.sub(r"\x00(\d+)\x00", lambda m: lits[int(m.group(1))].replace("%", "%%"), code)
    return code, returns_id


def qualify_at(t, code, base, cols, table):
    """Helper for the upsert rewrite: qualify column `t` unless it is the left side of an assignment (`col = ...`)."""
    w = t.group(1)
    if w not in cols:
        return w
    after = code[base + t.end():]
    if re.match(r"\s*=(?!=)", after):
        return w
    return f"{table}.{w}"


class Row:
    """A result row readable by position (row[0]) and by name (row["id"]), like sqlite3.Row."""
    __slots__ = ("_names", "_index", "_values")

    def __init__(self, names, index, values):
        self._names, self._index, self._values = names, index, values

    def __getitem__(self, key):
        if isinstance(key, str):
            return self._values[self._index[key]]
        return self._values[key]

    def keys(self):
        return list(self._names)

    def __iter__(self):
        return iter(self._values)

    def __len__(self):
        return len(self._values)

    def __repr__(self):
        return f"Row({dict(zip(self._names, self._values))})"


def _row_factory(cursor):
    names = [c.name for c in cursor.description] if cursor.description else []
    index = {n: i for i, n in enumerate(names)}
    return lambda values: Row(names, index, tuple(values))


class _NumericLoader(Loader):
    """SUM() and AVG() come back from Postgres as numeric (Decimal); the app wants plain numbers."""

    def load(self, data):
        text = bytes(data).decode()
        return int(text) if re.fullmatch(r"-?\d+", text) else float(text)


def _configure(conn):
    conn.adapters.register_loader("numeric", _NumericLoader)


def _clean(params):
    if isinstance(params, dict):
        return {k: int(v) if isinstance(v, bool) else v for k, v in params.items()}
    return tuple(int(v) if isinstance(v, bool) else v for v in (params or ()))


class _Cursor:
    def __init__(self, raw, lastrowid=None):
        self._raw, self.lastrowid = raw, lastrowid

    @property
    def rowcount(self):
        return self._raw.rowcount

    def fetchone(self):
        return self._raw.fetchone() if self._raw.description else None

    def fetchall(self):
        return self._raw.fetchall() if self._raw.description else []

    def __iter__(self):
        return iter(self.fetchall())


class PgConn:
    """The few connection methods the app uses (execute, commit, rollback, close), on top of a psycopg connection."""

    def __init__(self, raw, pool=None):
        self._raw, self._pool = raw, pool

    def execute(self, sql, params=()):
        query, returns_id = pg_sql(sql)
        cur = self._raw.cursor()
        cur.execute(query, _clean(params))
        if returns_id:
            row = cur.fetchone()
            return _Cursor(cur, row[0] if row else None)
        return _Cursor(cur)

    def commit(self):
        self._raw.commit()

    def rollback(self):
        self._raw.rollback()

    def close(self):
        if self._pool is not None:
            self._pool.putconn(self._raw)  # the pool rolls back anything left open
        else:
            self._raw.close()


_pool = None


def _need_psycopg():
    if psycopg is None:
        raise RuntimeError("DATABASE_URL is set but psycopg is not installed. Run: pip install -r requirements.txt")


def _get_pool():
    global _pool
    if _pool is None:
        _need_psycopg()
        from psycopg_pool import ConnectionPool

        _pool = ConnectionPool(
            config.DATABASE_URL,
            min_size=1,
            max_size=max(2, config.DB_POOL_SIZE),
            timeout=30,
            max_idle=240,
            kwargs={"row_factory": _row_factory, "prepare_threshold": None},  # no prepared statements: Supabase's pooler can't keep them
            configure=_configure,
            check=ConnectionPool.check_connection,
            open=True,
        )
    return _pool


def init_pg():
    _need_psycopg()
    con = psycopg.connect(config.DATABASE_URL, autocommit=True, prepare_threshold=None)
    try:
        con.execute("SELECT pg_advisory_lock(727002)")  # two servers starting together must not create the tables at once
        for statement in pg_schema():
            con.execute(statement)
        con.execute("SELECT pg_advisory_unlock(727002)")
    finally:
        con.close()


def connect():
    """A connection of its own, for background threads (Twitch bridge, restream watchdog). Autocommit: no transaction stays open."""
    if USE_PG:
        _need_psycopg()
        raw = psycopg.connect(config.DATABASE_URL, autocommit=True, row_factory=_row_factory, prepare_threshold=None)
        _configure(raw)
        return PgConn(raw)
    con = sqlite3.connect(config.DB_PATH, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def get_db():
    if "db" not in g:
        if USE_PG:
            pool = _get_pool()
            g.db = PgConn(pool.getconn(), pool)
        else:
            g.db = connect()
            g.db.execute("PRAGMA synchronous = NORMAL")  # safe with WAL, much faster writes
    return g.db


def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


if __name__ == "__main__":
    # python -m yeli.db  ->  the Postgres schema, to paste into Supabase's SQL editor (the app also applies it by itself on start)
    sys.stdout.write("-- Yeli schema for Supabase (Postgres). Safe to run more than once.\n" + ";\n\n".join(pg_schema()) + ";\n")
