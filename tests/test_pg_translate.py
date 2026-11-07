"""Checks the SQLite -> Postgres translation without needing a Postgres server.   Run: python -m unittest discover tests"""
import ast
import glob
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from yeli import db  # noqa: E402


class PgTranslate(unittest.TestCase):
    def test_placeholders(self):
        self.assertEqual(db.pg_sql("SELECT * FROM t WHERE a = ? AND b = ?")[0], "SELECT * FROM t WHERE a = %s AND b = %s")
        self.assertEqual(db.pg_sql("SELECT :a, :a, :b")[0], "SELECT %(a)s, %(a)s, %(b)s")

    def test_percent_and_literals_are_safe(self):
        q = db.pg_sql("SELECT '50%', '?', ':x' FROM t WHERE a = ?")[0]
        self.assertEqual(q, "SELECT '50%%', '?', ':x' FROM t WHERE a = %s")

    def test_like_ignores_case_and_collate_goes(self):
        q = db.pg_sql("SELECT 1 FROM users u WHERE u.username LIKE :q ESCAPE '\\' ORDER BY u.username COLLATE NOCASE")[0]
        self.assertIn("ILIKE %(q)s", q)
        self.assertNotIn("COLLATE", q)

    def test_insert_returns_id_only_on_id_tables(self):
        self.assertEqual(db.pg_sql("INSERT INTO chat_messages (text) VALUES (?)"), ("INSERT INTO chat_messages (text) VALUES (%s) RETURNING id", True))
        self.assertFalse(db.pg_sql("INSERT INTO streams (user_id) VALUES (?)")[1])
        self.assertFalse(db.pg_sql("INSERT INTO vods (id) VALUES (?)")[1])  # text id, nothing to return

    def test_or_ignore_and_or_replace(self):
        q, _ = db.pg_sql("INSERT OR IGNORE INTO follows (follower_id, followed_id, created_at) VALUES (?,?,?)")
        self.assertTrue(q.startswith("INSERT INTO follows") and q.endswith("ON CONFLICT DO NOTHING"))
        q, _ = db.pg_sql("INSERT OR REPLACE INTO thumbnails (user_id, data, updated_at) VALUES (?,?,?)")
        self.assertIn("ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at", q)

    def test_upsert_names_the_table(self):
        q, _ = db.pg_sql("INSERT INTO upgrade_points (user_id, points) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET points = points + 1")
        self.assertTrue(q.endswith("SET points = upgrade_points.points + 1"))
        q, _ = db.pg_sql("INSERT INTO notify_meta (user_id, lang) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET lang = excluded.lang WHERE lang != excluded.lang")
        self.assertTrue(q.endswith("SET lang = excluded.lang WHERE notify_meta.lang != excluded.lang"))

    def test_begin_immediate_takes_the_money_lock(self):
        self.assertEqual(db.pg_sql("BEGIN IMMEDIATE")[0], "SELECT pg_advisory_xact_lock(727001)")

    def test_whole_app_translates(self):
        """Every SQL string in the app: nothing SQLite-only is left, and every placeholder is Postgres style."""
        n = 0
        for f in glob.glob(str(ROOT / "yeli" / "*.py")):
            if f.endswith("db.py"):
                continue
            for node in ast.walk(ast.parse(Path(f).read_text(encoding="utf-8"))):
                if isinstance(node, ast.Constant) and isinstance(node.value, str) and re.search(r"\b(SELECT|INSERT|UPDATE|DELETE)\b", node.value) \
                        and re.search(r"\b(FROM|INTO|SET)\b", node.value) and "{" not in node.value:
                    q, _ = db.pg_sql(node.value)
                    n += 1
                    code = re.sub(r"'(?:[^']|'')*'", "''", q)
                    for bad in ("?", "INSERT OR", "COLLATE", "PRAGMA", "lastrowid"):
                        self.assertNotIn(bad, code, f"{f}:{node.lineno}")
                    self.assertIsNone(re.search(r"(?<![:\w]):[A-Za-z_]\w*", code), f"{f}:{node.lineno}: {q}")
        self.assertGreater(n, 150)

    def test_schema(self):
        text = ";\n".join(db.pg_schema())
        for bad in ("AUTOINCREMENT", "BLOB", "COLLATE", "INTEGER"):
            self.assertNotIn(bad, text)
        self.assertIn("username CITEXT NOT NULL UNIQUE", text)
        self.assertEqual(text.count("ENABLE ROW LEVEL SECURITY"), len(db._TABLES))
        self.assertIn("ADD COLUMN IF NOT EXISTS notified_at BIGINT", text)


if __name__ == "__main__":
    unittest.main()
