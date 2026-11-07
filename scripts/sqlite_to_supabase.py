"""Copy an existing Yeli SQLite file into Supabase (once).

    DATABASE_URL=postgresql://... python scripts/sqlite_to_supabase.py instance/yeli.db

The tables are created first (the app does the same on start). Rows keep their ids, so nothing breaks;
rows that already exist in Supabase are left alone. Safe to run again.
"""
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from yeli import config, db  # noqa: E402

# parents before children, so the foreign keys are satisfied
ORDER = ["users", "avatars", "streams", "follows", "wallets", "purchases", "donations", "payouts", "ledger", "upgrade_points",
         "upgrades", "spendings", "chat_settings", "commands", "chat_messages", "chat_mods", "chat_bans", "destinations", "bridges",
         "thumbnails", "chest_progress", "chest_opens", "chest_items", "events", "alert_rules", "assets", "vods", "edit_projects",
         "vod_likes", "vod_comments", "vod_comment_likes", "live_likes", "notifications", "notify_prefs", "notify_meta",
         "watch_sessions", "free_points"]  # viewers and signals are live state: not copied


def main(path):
    if not config.DATABASE_URL:
        sys.exit("Set DATABASE_URL to your Supabase connection string first.")
    db.init_pg()
    src = sqlite3.connect(path)
    src.row_factory = sqlite3.Row
    dst = db.connect()
    for table in ORDER:
        try:
            rows = src.execute(f"SELECT * FROM {table}").fetchall()
        except sqlite3.OperationalError:
            continue  # the table doesn't exist in an old file
        if not rows:
            continue
        cols = rows[0].keys()
        known = set(db._COLS.get(table, cols)) | {"id"}
        cols = [c for c in cols if c in known]
        # comments answer comments: top-level ones first
        if table == "vod_comments":
            rows = sorted(rows, key=lambda r: (r["parent_id"] is not None, r["id"]))
        sql = f"INSERT OR IGNORE INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})"
        for r in rows:
            dst.execute(sql, tuple(r[c] for c in cols))
        print(f"{table}: {len(rows)} rows")
    # tables with generated ids: move the counter past the copied ids
    for table in sorted(db._AUTO_ID):
        dst.execute(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), COALESCE((SELECT MAX(id) FROM {table}), 0) + 1, false)")
    dst.close()
    print("Done.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
