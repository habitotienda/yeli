"""Run:  python -m unittest discover tests"""
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
_tmp = tempfile.mkdtemp()
os.environ["YELI_DB"] = os.path.join(_tmp, "test.db")
os.environ["YELI_SECRET_KEY"] = "test"
os.environ["YELI_ADMINS"] = "boss"
os.environ["YELI_LIST_CACHE"] = "0"  # the tests change things and read them back immediately

import sqlite3  # noqa: E402

import yeli  # noqa: E402
from yeli import config, core, db as database, economy  # noqa: E402

app = yeli.create_app()

import base64  # noqa: E402
JPEG = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff" + b"x" * 300).decode()
OCTET = {"content_type": "application/octet-stream"}


def post(c, url, body=None):
    return c.post(url, json=body or {})


class YeliTests(unittest.TestCase):
    def setUp(self):
        from yeli import bot as _bot
        _bot._cooldowns.clear()
        core._failed_logins.clear()
        con = sqlite3.connect(config.DB_PATH)
        for t in ("notifications", "notify_prefs", "notify_meta", "vod_comment_likes", "vod_comments", "vod_likes", "vods", "edit_projects", "free_points", "watch_sessions", "chat_bans", "chat_mods", "events", "alert_rules", "assets", "chat_settings", "commands", "spendings", "upgrades", "upgrade_points", "ledger", "payouts", "donations", "purchases", "wallets", "chat_messages", "gallery_owned", "gallery_items", "avatars", "thumbnails", "signals", "viewers", "live_likes", "follows", "streams", "users"):
            con.execute(f"DELETE FROM {t}")
        con.commit()
        con.close()
        self.alice = app.test_client()
        self.bob = app.test_client()
        self.anon = app.test_client()

    def signup(self, client, name):
        r = post(client, "/api/register", {"username": name, "email": f"{name}@x.com", "password": "password123"})
        self.assertEqual(r.status_code, 201, r.get_json())

    # --- helpers for the video editor tests
    def live_vod(self, client, seconds=60, body=b"LIVE"):
        """A saved live recording of this client's channel (a private clip)."""
        post(client, "/api/stream/start", {"title": "Live", "category": "Talk"})
        vid = post(client, "/api/vod/start", {"mime": "video/webm"}).get_json()["id"]
        client.post(f"/api/vod/{vid}/chunk?seq=0", data=body, **OCTET)
        post(client, f"/api/vod/{vid}/finish")
        con = sqlite3.connect(config.DB_PATH)
        con.execute("UPDATE vods SET duration = ? WHERE id = ?", (seconds, vid))
        con.commit()
        con.close()
        return vid

    def project(self, client, clips, **extra):
        data = {"aspect": "16:9", "clips": clips, "texts": [], **extra}
        r = post(client, "/api/projects", {"title": "P", "data": data})
        self.assertEqual(r.status_code, 200, r.get_json())
        return r.get_json()["project"]["id"]

    def new_edit(self, client, title="v", duration=5, finish=True):
        """An exported edit (a private clip) made from a fresh live recording."""
        live = self.live_vod(client)
        pid = self.project(client, [{"a": f"vod:{live}", "in": 0, "out": 10}])
        r = post(client, "/api/vod/new", {"mime": "video/webm", "title": title, "project_id": pid})
        self.assertEqual(r.status_code, 200, r.get_json())
        vid = r.get_json()["id"]
        if finish:
            client.post(f"/api/vod/{vid}/chunk?seq=0", data=b"EDIT", **OCTET)
            post(client, f"/api/vod/{vid}/finish", {"duration": duration})
        return vid

    def test_accounts(self):
        self.signup(self.alice, "alice")
        self.assertEqual(self.alice.get("/api/me").get_json()["user"]["username"], "alice")
        self.assertIsNone(self.anon.get("/api/me").get_json()["user"])
        # duplicates (case-insensitive) and validation
        r = post(self.bob, "/api/register", {"username": "ALICE", "email": "b@x.com", "password": "password123"})
        self.assertEqual(r.status_code, 409)
        r = post(self.bob, "/api/register", {"username": "bob", "email": "alice@x.com", "password": "password123"})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(post(self.bob, "/api/register", {"username": "a!", "email": "b@x.com", "password": "password123"}).status_code, 400)
        self.assertEqual(post(self.bob, "/api/register", {"username": "bob", "email": "b@x.com", "password": "short"}).status_code, 400)
        # login / logout
        self.assertEqual(post(self.anon, "/api/login", {"identifier": "alice", "password": "nope"}).status_code, 401)
        self.assertEqual(post(self.anon, "/api/login", {"identifier": "alice@x.com", "password": "password123"}).status_code, 200)
        self.assertEqual(self.anon.get("/api/following").status_code, 200)
        post(self.anon, "/api/logout")
        self.assertEqual(self.anon.get("/api/following").status_code, 401)
        # password is never stored in clear text
        row = sqlite3.connect(config.DB_PATH).execute("SELECT password_hash FROM users").fetchone()
        self.assertNotIn("password123", row[0])

    def test_csrf_guard(self):
        r = self.alice.post("/api/login", data={"identifier": "a", "password": "b"})
        self.assertEqual(r.status_code, 415)

    def test_video_privacy_followers(self):
        octet = {"content_type": "application/octet-stream"}
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")
        vid = self.new_edit(self.alice, "v")
        post(self.alice, f"/api/vod/{vid}/edit", {"cover": JPEG})
        vis = lambda who, v: post(who, f"/api/vod/{vid}/visibility", {"visibility": v})
        self.assertEqual(vis(self.bob, "public").status_code, 404)           # only the owner
        self.assertEqual(vis(self.alice, "nope").status_code, 400)
        self.assertEqual(vis(self.alice, "followers").get_json()["video"]["is_clip"], False)
        # followers only: strangers and guests can't see it, a follower can
        self.assertEqual(self.anon.get(f"/api/vod/{vid}").status_code, 404)
        self.assertEqual(self.bob.get(f"/api/vod/{vid}").status_code, 404)
        self.assertEqual(self.bob.get("/api/channel/alice/videos").get_json()["videos"], [])
        post(self.bob, "/api/follow/alice", {"follow": True})
        self.assertEqual(self.bob.get(f"/api/vod/{vid}").status_code, 200)
        self.assertEqual([x["id"] for x in self.bob.get("/api/channel/alice/videos").get_json()["videos"]], [vid])
        self.assertEqual(self.anon.get("/api/channel/alice/videos").get_json()["videos"], [])
        self.assertEqual(post(self.bob, f"/api/vod/{vid}/like", {"liked": True}).status_code, 200)
        # public, then private again
        self.assertEqual(vis(self.alice, "public").status_code, 200)
        self.assertEqual(self.anon.get(f"/api/vod/{vid}").status_code, 200)
        self.assertEqual(vis(self.alice, "private").get_json()["video"]["is_clip"], True)
        self.assertEqual(self.bob.get(f"/api/vod/{vid}").status_code, 404)

    def test_live_likes_boost(self):
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")
        self.assertEqual(post(self.bob, "/api/watch/alice/like", {"liked": True}).status_code, 404)   # not live
        post(self.alice, "/api/stream/start", {"title": "t", "category": "Talk"})
        self.assertEqual(post(self.anon, "/api/watch/alice/like", {"liked": True}).status_code, 401)
        self.assertEqual(post(self.alice, "/api/watch/alice/like", {"liked": True}).status_code, 400)  # not your own
        self.assertEqual(post(self.bob, "/api/watch/alice/like", {}).status_code, 400)
        r = post(self.bob, "/api/watch/alice/like", {"liked": True}).get_json()
        self.assertEqual((r["liked"], r["likes"]), (True, 1))
        self.assertEqual(post(self.bob, "/api/watch/alice/like", {"liked": True}).get_json()["likes"], 1)  # one per account
        ch = self.bob.get("/api/channel/alice").get_json()["channel"]
        self.assertEqual((ch["live_likes"], ch["liked_live"]), (1, True))
        self.assertFalse(self.anon.get("/api/channel/alice").get_json()["channel"]["liked_live"])
        from yeli import economy
        self.assertLess(economy.live_like_weight(10 ** 6), economy.level_value("boost", 5))     # weaker than the paid one
        self.assertGreater(economy.live_like_weight(4), economy.live_like_weight(1))
        # the likes end with the stream
        post(self.alice, "/api/stream/stop")
        post(self.alice, "/api/stream/start", {"title": "t", "category": "Talk"})
        self.assertEqual(self.bob.get("/api/channel/alice").get_json()["channel"]["live_likes"], 0)
        post(self.bob, "/api/watch/alice/like", {"liked": True})
        post(self.bob, "/api/watch/alice/like", {"liked": False})
        self.assertEqual(self.bob.get("/api/channel/alice").get_json()["channel"]["live_likes"], 0)

    def test_follow_search_live(self):
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")
        self.assertEqual(post(self.bob, "/api/follow/alice", {"follow": True}).get_json()["followers"], 1)
        self.assertEqual(post(self.bob, "/api/follow/bob", {"follow": True}).status_code, 400)
        self.assertEqual(post(self.anon, "/api/follow/alice").status_code, 401)
        self.assertEqual([c["username"] for c in self.bob.get("/api/following").get_json()["channels"]], ["alice"])
        ch = self.bob.get("/api/channel/alice").get_json()["channel"]
        self.assertTrue(ch["following"])
        self.assertFalse(ch["live"])
        self.assertEqual(self.anon.get("/api/channel/nobody").status_code, 404)

        self.assertEqual(self.anon.get("/api/live").get_json()["streams"], [])
        post(self.alice, "/api/stream/start", {"title": "Cooking pasta tonight", "category": "Cooking"})
        live = self.anon.get("/api/live").get_json()["streams"]
        self.assertEqual(live[0]["username"], "alice")
        self.assertEqual(self.anon.get("/api/live?category=Gaming").get_json()["streams"], [])
        self.assertEqual(len(self.anon.get("/api/live?category=Cooking").get_json()["streams"]), 1)
        # search by name, by title (live only), by category; wildcard chars are escaped
        for q in ("ali", "pasta", "cook"):
            res = self.anon.get(f"/api/search?q={q}").get_json()["results"]
            self.assertEqual([r["username"] for r in res], ["alice"], q)
        self.assertEqual(self.anon.get("/api/search?q=%25").get_json()["results"], [])
        self.assertEqual(self.anon.get("/api/search?q=zzz").get_json()["results"], [])
        cats = {c["name"]: c["live"] for c in self.anon.get("/api/categories").get_json()["categories"]}
        self.assertEqual(cats["Cooking"], 1)
        # after the stream ends the title is no longer searchable
        post(self.alice, "/api/stream/stop")
        self.assertEqual(self.anon.get("/api/search?q=pasta").get_json()["results"], [])
        self.assertEqual(self.anon.get("/api/live").get_json()["streams"], [])

    def test_webrtc_signaling(self):
        self.signup(self.alice, "alice")
        peer = "a" * 32
        # not live yet
        self.assertEqual(post(self.anon, "/api/watch/alice/join", {"peer": peer}).status_code, 404)
        post(self.alice, "/api/stream/start", {"title": "t", "category": "Talk"})
        self.assertEqual(post(self.anon, "/api/watch/alice/join", {"peer": "bad"}).status_code, 400)
        self.assertEqual(post(self.anon, "/api/watch/alice/join", {"peer": peer}).status_code, 200)
        # broadcaster receives the join
        p = self.alice.get("/api/stream/poll?after=0").get_json()
        self.assertTrue(p["live"])
        self.assertEqual(p["viewers"], 1)
        self.assertEqual([(s["kind"], s["from"]) for s in p["signals"]], [("join", peer)])
        # offer -> viewer
        r = post(self.alice, "/api/stream/signal", {"peer": peer, "kind": "offer", "payload": {"type": "offer", "sdp": "v=0"}})
        self.assertEqual(r.status_code, 200)
        v = self.anon.get(f"/api/watch/alice/poll?peer={peer}&after=0").get_json()
        self.assertTrue(v["joined"])
        self.assertEqual(v["signals"][0]["kind"], "offer")
        last = v["signals"][0]["id"]
        # acknowledged signals are not delivered again
        v = self.anon.get(f"/api/watch/alice/poll?peer={peer}&after={last}").get_json()
        self.assertEqual(v["signals"], [])
        # answer + candidate -> broadcaster
        post(self.anon, "/api/watch/alice/signal", {"peer": peer, "kind": "answer", "payload": {"type": "answer", "sdp": "x"}})
        post(self.anon, "/api/watch/alice/signal", {"peer": peer, "kind": "candidate", "payload": {"candidate": "c"}})
        p = self.alice.get(f"/api/stream/poll?after={p['signals'][-1]['id']}").get_json()
        self.assertEqual([s["kind"] for s in p["signals"]], ["answer", "candidate"])
        # strangers cannot inject signals
        self.assertEqual(post(self.anon, "/api/watch/alice/signal", {"peer": "b" * 32, "kind": "answer", "payload": {}}).status_code, 410)
        # viewer limit
        config.MAX_VIEWERS = 1
        self.assertEqual(post(app.test_client(), "/api/watch/alice/join", {"peer": "c" * 32}).status_code, 429)
        config.MAX_VIEWERS = 25
        # leave -> broadcaster is told; ending the stream tells viewers it's offline
        post(self.anon, "/api/watch/alice/leave", {"peer": peer})
        p = self.alice.get("/api/stream/poll?after=0").get_json()
        self.assertIn("leave", [s["kind"] for s in p["signals"]])
        self.assertEqual(p["viewers"], 0)
        post(self.alice, "/api/stream/stop")
        self.assertFalse(self.anon.get(f"/api/watch/alice/poll?peer={peer}").get_json()["live"])
        self.assertFalse(self.alice.get("/api/stream/poll").get_json()["live"])

    def test_stale_broadcast_goes_offline(self):
        self.signup(self.alice, "alice")
        post(self.alice, "/api/stream/start", {"title": "t", "category": "Talk"})
        con = sqlite3.connect(config.DB_PATH)
        con.execute("UPDATE streams SET last_seen = last_seen - 100")
        con.commit()
        con.close()
        self.assertEqual(self.anon.get("/api/live").get_json()["streams"], [])
        self.assertFalse(self.anon.get("/api/channel/alice").get_json()["channel"]["live"])

    def test_thumbnail(self):
        import base64
        self.signup(self.alice, "alice")
        jpeg = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff\xe0" + b"0" * 100).decode()
        self.assertEqual(post(self.alice, "/api/stream/thumbnail", {"image": jpeg}).status_code, 409)  # not live
        post(self.alice, "/api/stream/start", {"title": "t", "category": "Talk"})
        self.assertEqual(self.anon.get("/api/thumb/alice").status_code, 404)
        self.assertEqual(post(self.alice, "/api/stream/thumbnail", {"image": "data:image/png;base64,AAAA"}).status_code, 400)
        notjpeg = "data:image/jpeg;base64," + base64.b64encode(b"hello world").decode()
        self.assertEqual(post(self.alice, "/api/stream/thumbnail", {"image": notjpeg}).status_code, 400)
        self.assertEqual(post(self.alice, "/api/stream/thumbnail", {"image": jpeg}).status_code, 200)
        r = self.anon.get("/api/thumb/alice")
        self.assertEqual((r.status_code, r.mimetype), (200, "image/jpeg"))
        self.assertTrue(self.anon.get("/api/live").get_json()["streams"][0]["thumb"])
        post(self.alice, "/api/stream/stop")
        self.assertEqual(self.anon.get("/api/thumb/alice").status_code, 404)

    def test_chat(self):
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")
        self.assertEqual(post(self.anon, "/api/chat/alice", {"text": "hi"}).status_code, 401)
        self.assertEqual(post(self.bob, "/api/chat/alice", {"text": "   "}).status_code, 400)
        self.assertEqual(post(self.bob, "/api/chat/nobody", {"text": "x"}).status_code, 404)
        r = post(self.bob, "/api/chat/alice", {"text": "  hello   <b>world</b>  "})
        self.assertEqual(r.status_code, 201)
        m1 = r.get_json()["message"]
        self.assertEqual(m1["text"], "hello <b>world</b>")  # stored as text; the client never uses innerHTML
        self.assertFalse(m1["owner"])
        m2 = post(self.alice, "/api/chat/alice", {"text": "welcome"}).get_json()["message"]
        self.assertTrue(m2["owner"])
        # initial load returns history, later polls only what is new
        first = self.anon.get("/api/chat/alice?after=0").get_json()
        self.assertEqual([m["text"] for m in first["messages"]], ["hello <b>world</b>", "welcome"])
        self.assertEqual(self.anon.get(f"/api/chat/alice?after={m2['id']}").get_json()["messages"], [])
        # long messages are cut, rate limit kicks in
        long = post(self.bob, "/api/chat/alice", {"text": "x" * 1000}).get_json()["message"]
        self.assertEqual(len(long["text"]), 300)
        codes = [post(self.bob, "/api/chat/alice", {"text": f"spam {i}"}).status_code for i in range(8)]
        self.assertIn(429, codes)
        # moderation: only the channel owner or the author may delete
        carol = app.test_client()
        self.signup(carol, "carol")
        self.assertEqual(post(carol, "/api/chat/alice/delete", {"id": m1["id"]}).status_code, 403)
        t = first["t"]
        self.assertEqual(post(self.alice, "/api/chat/alice/delete", {"id": m1["id"]}).status_code, 200)
        poll = self.anon.get(f"/api/chat/alice?after={m2['id']}&since={t}").get_json()
        self.assertEqual(poll["removed"], [m1["id"]])
        texts = [m["text"] for m in self.anon.get("/api/chat/alice?after=0").get_json()["messages"]]
        self.assertNotIn("hello <b>world</b>", texts)

    def test_profile_and_avatar(self):
        import base64
        self.signup(self.alice, "alice")
        me = self.alice.get("/api/me").get_json()["user"]
        self.assertEqual((me["avatar"], me["bio"]), ("", ""))
        r = post(self.alice, "/api/me/profile", {"bio": "  I code live  ", "avatar": "preset:3"})
        self.assertEqual(r.get_json()["user"]["avatar"], "preset:3")
        self.assertEqual(self.anon.get("/api/channel/alice").get_json()["channel"]["bio"], "I code live")
        self.assertEqual(self.anon.get("/api/channel/alice").get_json()["channel"]["avatar"], "preset:3")
        for bad in ("preset:12", "preset:-1", "upload", "http://x", 5):
            self.assertEqual(post(self.alice, "/api/me/profile", {"avatar": bad}).status_code, 400, bad)
        self.assertEqual(post(self.anon, "/api/me/profile", {"bio": "x"}).status_code, 401)
        # upload
        self.assertEqual(self.anon.get("/api/avatar/alice").status_code, 404)
        jpeg = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff\xe0" + b"1" * 200).decode()
        self.assertEqual(post(self.alice, "/api/me/avatar", {"image": "data:image/png;base64,AAAA"}).status_code, 400)
        big = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff" + b"1" * 70000).decode()
        self.assertEqual(post(self.alice, "/api/me/avatar", {"image": big}).status_code, 400)
        r = post(self.alice, "/api/me/avatar", {"image": jpeg})
        self.assertTrue(r.get_json()["user"]["avatar"].startswith("upload:"))
        self.assertEqual(self.anon.get("/api/avatar/alice").mimetype, "image/jpeg")
        # switching to a preset keeps the upload so it can be restored
        post(self.alice, "/api/me/profile", {"avatar": "preset:1"})
        self.assertTrue(post(self.alice, "/api/me/profile", {"avatar": "upload"}).get_json()["user"]["avatar"].startswith("upload:"))
        # password change
        self.assertEqual(post(self.alice, "/api/me/password", {"current": "wrong", "new": "newpassword1"}).status_code, 403)
        self.assertEqual(post(self.alice, "/api/me/password", {"current": "password123", "new": "short"}).status_code, 400)
        self.assertEqual(post(self.alice, "/api/me/password", {"current": "password123", "new": "newpassword1"}).status_code, 200)
        self.assertEqual(post(self.anon, "/api/login", {"identifier": "alice", "password": "newpassword1"}).status_code, 200)

    def test_migrates_old_database(self):
        import importlib
        path = os.path.join(_tmp, "old.db")
        con = sqlite3.connect(path)
        con.executescript(
            "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE,"
            " email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '',"
            " created_at INTEGER NOT NULL);"
            "CREATE TABLE viewers (peer_id TEXT PRIMARY KEY, streamer_id INTEGER NOT NULL, last_seen INTEGER NOT NULL);"
            "CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id INTEGER NOT NULL, user_id INTEGER NOT NULL,"
            " text TEXT NOT NULL, created_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER);"
            "INSERT INTO viewers VALUES ('p', 1, 1);"
            " INSERT INTO users (username,email,password_hash,created_at) VALUES ('old','o@x.com','x',1);"
        )
        con.commit()
        con.close()
        saved = config.DB_PATH
        config.DB_PATH = path
        try:
            database.init_db()
            database.init_db()  # idempotent
            con = sqlite3.connect(path)
            cols = {r[1] for r in con.execute("PRAGMA table_info(users)")}
            self.assertTrue({"avatar", "avatar_updated"} <= cols)
            vcols = {r[1] for r in con.execute("PRAGMA table_info(viewers)")}
            ccols = {r[1] for r in con.execute("PRAGMA table_info(chat_messages)")}
            self.assertTrue({"viewer_key", "superseded", "ip"} <= vcols)
            self.assertTrue({"kind", "sticker", "amount"} <= ccols)
            self.assertEqual(con.execute("SELECT username, avatar FROM users").fetchone(), ("old", ""))
            con.close()
        finally:
            config.DB_PATH = saved

    def test_quality_signal(self):
        self.signup(self.alice, "alice")
        # viewers can request a lower quality; the signal reaches the broadcaster
        post(self.alice, "/api/stream/start", {"title": "t", "category": "Talk"})
        peer = "d" * 32
        post(self.anon, "/api/watch/alice/join", {"peer": peer})
        r = post(self.anon, "/api/watch/alice/signal", {"peer": peer, "kind": "quality", "payload": {"height": 480}})
        self.assertEqual(r.status_code, 200)
        kinds = [s["kind"] for s in self.alice.get("/api/stream/poll?after=0").get_json()["signals"]]
        self.assertEqual(kinds, ["join", "quality"])
        self.assertEqual(post(self.anon, "/api/watch/alice/signal", {"peer": peer, "kind": "bogus", "payload": {}}).status_code, 400)

    # ------------------------------------------------------------------ viewers
    def client(self):
        return app.test_client()

    def test_viewers_are_unique_accounts(self):
        self.signup(self.alice, "alice")
        post(self.alice, "/api/stream/start", {"title": "t", "category": "Talk"})
        self.signup(self.bob, "bob")
        count = lambda: self.anon.get("/api/channel/alice").get_json()["channel"]["viewers"]  # noqa: E731
        # two tabs of the same account = one viewer; the older tab is told it was replaced
        p1, p2 = "1" * 32, "2" * 32
        self.assertFalse(post(self.bob, "/api/watch/alice/join", {"peer": p1}).get_json()["replaced"])
        self.assertTrue(post(self.bob, "/api/watch/alice/join", {"peer": p2}).get_json()["replaced"])
        self.assertEqual(count(), 1)
        self.assertEqual(self.alice.get("/api/stream/poll").get_json()["viewers"], 1)
        old = self.bob.get(f"/api/watch/alice/poll?peer={p1}").get_json()
        self.assertTrue(old["superseded"])
        self.assertNotIn("superseded", self.bob.get(f"/api/watch/alice/poll?peer={p2}").get_json())
        # guests are identified by a cookie: tabs share it, different browsers don't
        g1, g2 = self.client(), self.client()
        post(g1, "/api/watch/alice/join", {"peer": "3" * 32})
        post(g1, "/api/watch/alice/join", {"peer": "4" * 32})
        self.assertEqual(count(), 2)
        post(g2, "/api/watch/alice/join", {"peer": "5" * 32})
        self.assertEqual(count(), 3)
        # the broadcaster's own tabs never count
        post(self.alice, "/api/watch/alice/join", {"peer": "6" * 32})
        self.assertEqual(count(), 3)
        # an old tab going away doesn't remove the account's newer connection
        post(self.bob, "/api/watch/alice/leave", {"peer": p1})
        self.assertEqual(count(), 3)
        # the guest cap per network
        config.MAX_ANON_PER_IP = 2
        try:
            r = post(self.client(), "/api/watch/alice/join", {"peer": "7" * 32})
            self.assertEqual(r.status_code, 429)
        finally:
            config.MAX_ANON_PER_IP = 5

    # ------------------------------------------------------------------ wallet
    def buy(self, client, pack="p1000"):
        r = post(client, "/api/wallet/buy", {"pack": pack})
        self.assertEqual(r.status_code, 201, r.get_json())
        pid = r.get_json()["purchase"]["id"]
        r = post(client, f"/api/wallet/purchases/{pid}/complete")
        self.assertEqual(r.status_code, 200, r.get_json())
        return pid, r.get_json()

    def test_buy_and_donate(self):
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")
        self.assertEqual(self.anon.get("/api/economy").get_json()["economy"]["mode"], "sandbox")
        self.assertEqual(post(self.anon, "/api/wallet/buy", {"pack": "p100"}).status_code, 401)
        self.assertEqual(post(self.bob, "/api/wallet/buy", {"pack": "nope"}).status_code, 400)
        pid, done = self.buy(self.bob)
        self.assertEqual((done["coins"], done["balance"]), (1000, 1000))
        # a purchase can only be completed once, and only by its owner
        self.assertEqual(post(self.bob, f"/api/wallet/purchases/{pid}/complete").status_code, 409)
        other = post(self.bob, "/api/wallet/buy", {"pack": "p100"}).get_json()["purchase"]["id"]
        self.assertEqual(post(self.alice, f"/api/wallet/purchases/{other}/complete").status_code, 409)
        self.assertEqual(self.bob.get("/api/me").get_json()["user"]["balance"], 1000)

        # donate: validation
        for bad in ({"channel": "alice", "coins": 5}, {"channel": "alice", "coins": 10**9}, {"channel": "alice", "coins": "50"},
                    {"channel": "alice", "coins": True}, {"channel": "alice", "coins": -50}, {"channel": "nobody", "coins": 50}):
            self.assertIn(post(self.bob, "/api/wallet/donate", bad).status_code, (400, 404), bad)
        self.assertEqual(post(self.alice, "/api/wallet/donate", {"channel": "alice", "coins": 50}).status_code, 400)  # self
        self.assertEqual(post(self.anon, "/api/wallet/donate", {"channel": "alice", "coins": 50}).status_code, 401)
        r = post(self.alice, "/api/wallet/donate", {"channel": "bob", "coins": 50})
        self.assertEqual(r.status_code, 402)  # alice has no Yelis

        r = post(self.bob, "/api/wallet/donate", {"channel": "alice", "coins": 300, "message": "  great   stream <3  "})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.get_json()["balance"], 700)
        # more than the balance is refused and changes nothing
        r = post(self.bob, "/api/wallet/donate", {"channel": "alice", "coins": 701})
        self.assertEqual((r.status_code, r.get_json()["balance"]), (402, 700))
        w = self.alice.get("/api/wallet").get_json()["wallet"]
        self.assertEqual((w["bought"], w["earned"], w["cashable"], w["on_hold"]), (0, 300, 0, 300))  # hold period
        # the donation shows up in chat, highlighted
        msgs = self.anon.get("/api/chat/alice?after=0").get_json()["messages"]
        self.assertEqual([(m["kind"], m["amount"], m["text"]) for m in msgs], [("donation", 300, "great stream <3")])
        # earned Yelis can't be spent, only bought ones
        self.assertEqual(post(self.alice, "/api/wallet/donate", {"channel": "bob", "coins": 10}).status_code, 402)
        # ledger records both sides
        kinds = [h["kind"] for h in self.bob.get("/api/wallet").get_json()["history"]]
        self.assertEqual(kinds, ["donate_sent", "purchase"])

    def test_stickers(self):
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")
        r = post(self.bob, "/api/chat/alice", {"sticker": "gg"})
        self.assertEqual((r.status_code, r.get_json()["message"]["kind"], r.get_json()["message"]["sticker"]), (201, "sticker", "gg"))
        self.assertEqual(post(self.bob, "/api/chat/alice", {"sticker": "nope"}).status_code, 400)
        self.assertEqual(post(self.bob, "/api/chat/alice", {"sticker": "crown"}).status_code, 402)  # paid stickers need Yelis
        self.assertEqual(post(self.anon, "/api/chat/alice", {"sticker": "gg"}).status_code, 401)
        self.assertEqual(post(self.bob, "/api/wallet/donate", {"channel": "alice", "sticker": "crown"}).status_code, 402)
        self.buy(self.bob, "p500")
        # the server sets the price of a sticker, whatever the client says
        r = post(self.bob, "/api/wallet/donate", {"channel": "alice", "sticker": "crown", "coins": 10})
        self.assertEqual((r.status_code, r.get_json()["balance"]), (201, 400))
        self.assertEqual(post(self.bob, "/api/wallet/donate", {"channel": "alice", "sticker": "gg"}).status_code, 400)
        last = self.anon.get("/api/chat/alice?after=0").get_json()["messages"][-1]
        self.assertEqual((last["kind"], last["sticker"], last["amount"]), ("donation", "crown", 100))

    def test_economy_math(self):
        e = economy
        old = e.TAX_RATE
        try:
            e.TAX_RATE = 0.21
            q = e.quote_purchase({"coins": 1000, "price_cents": 1299})
            self.assertEqual(q["tax_cents"], 225)  # 21 % VAT included in the price
            self.assertEqual(q["gross_cents"] - q["tax_cents"] - q["fee_cents"], q["net_cents"])
            self.assertTrue(all(e.pack_margin(p) > 0 for p in e.PACKS))  # defaults must not lose money, even with VAT
        finally:
            e.TAX_RATE = old
        self.assertEqual(e.quote_payout(5000)["net_cents"], 2500)          # starting rate: 50 cents per 100 Yelis
        self.assertEqual(e.quote_payout(5000, e.EARN_RATES[-1])["net_cents"], 4000)  # max Earnings upgrade: 80

    def test_payout_flow(self):
        e = economy
        saved = (e.PAYOUT_MIN_COINS, e.PAYOUT_HOLD_DAYS, e.PAYOUT_WITHHOLD_PCT, e.PAYOUT_FEE_CENTS)
        e.PAYOUT_MIN_COINS, e.PAYOUT_HOLD_DAYS, e.PAYOUT_WITHHOLD_PCT, e.PAYOUT_FEE_CENTS = 300, 0, 0.1, 50
        try:
            self.signup(self.alice, "alice")
            self.signup(self.bob, "bob")
            boss = self.client()
            self.signup(boss, "boss")  # listed in YELI_ADMINS
            self.buy(self.bob, "p1000")
            post(self.bob, "/api/wallet/donate", {"channel": "alice", "coins": 1000})
            w = self.alice.get("/api/wallet").get_json()["wallet"]
            self.assertEqual((w["earned"], w["cashable"]), (1000, 1000))
            pay = lambda **k: post(self.alice, "/api/wallet/payout", {"method": "paypal", "destination": "a@x.com", **k})  # noqa: E731
            self.assertEqual(pay(coins=100).status_code, 400)       # below the minimum (300)
            self.assertEqual(pay(coins=5000).status_code, 400)      # more than she has
            self.assertEqual(pay(coins=600, method="nope").status_code, 400)
            self.assertEqual(pay(coins=600, destination="x").status_code, 400)
            r = pay(coins=600)
            self.assertEqual(r.status_code, 201)
            p = r.get_json()["payout"]
            # 600 Yelis * $0.50/100 = $3.00 (level 0), minus 10 % withholding (30c) and a 50c fee
            self.assertEqual((p["gross_cents"], p["withheld_cents"], p["fee_cents"], p["net_cents"]), (300, 30, 50, 220))
            self.assertEqual(pay(coins=500).status_code, 400)       # one cash-out at a time
            w = self.alice.get("/api/wallet").get_json()["wallet"]
            self.assertEqual((w["earned"], w["cashable"], w["pending"]), (400, 400, 600))
            # only admins can see or change cash-outs
            self.assertEqual(self.alice.get("/api/admin/payouts").status_code, 403)
            self.assertEqual(self.anon.get("/api/admin/summary").status_code, 401)
            self.assertEqual(post(self.alice, f"/api/admin/payouts/{p['id']}", {"action": "paid"}).status_code, 403)
            listing = boss.get("/api/admin/payouts?status=requested").get_json()["payouts"]
            self.assertEqual((listing[0]["username"], listing[0]["destination"], listing[0]["test"]), ("alice", "a@x.com", 1))
            self.assertEqual(post(boss, f"/api/admin/payouts/{p['id']}", {"action": "bogus"}).status_code, 400)
            self.assertEqual(post(boss, f"/api/admin/payouts/{p['id']}", {"action": "approve"}).status_code, 200)
            self.assertEqual(post(boss, f"/api/admin/payouts/{p['id']}", {"action": "approve"}).status_code, 409)
            self.assertEqual(post(boss, f"/api/admin/payouts/{p['id']}", {"action": "paid", "note": "ref 123"}).status_code, 200)
            self.assertEqual(post(boss, f"/api/admin/payouts/{p['id']}", {"action": "reject"}).status_code, 409)  # already paid
            w = self.alice.get("/api/wallet").get_json()["wallet"]
            self.assertEqual((w["pending"], w["paid_out"]), (0, 600))
            # a rejected cash-out gives the Yelis back
            r2 = pay(coins=400)
            self.assertEqual(r2.status_code, 201)
            self.assertEqual(post(boss, f"/api/admin/payouts/{r2.get_json()['payout']['id']}", {"action": "reject"}).status_code, 200)
            self.assertEqual(self.alice.get("/api/wallet").get_json()["wallet"]["cashable"], 400)
            # admin summary and the accountant's view
            s = boss.get("/api/admin/summary").get_json()
            self.assertEqual((s["purchases"]["count"], s["donated_coins"], s["paid_out"]["coins"]), (1, 1000, 600))
            self.assertEqual(s["purchases"]["gross_cents"] - s["purchases"]["tax_cents"] - s["purchases"]["fee_cents"], s["purchases"]["net_cents"])
            self.assertTrue(self.alice.get("/api/me").get_json()["user"]["is_admin"] is False)
            self.assertTrue(boss.get("/api/me").get_json()["user"]["is_admin"])
            # yearly statement
            csv_text = self.alice.get("/api/wallet/statement.csv").get_data(as_text=True)
            self.assertIn("donation received,1000,bob,5.00", csv_text)
            self.assertIn("cash-out", csv_text)
        finally:
            e.PAYOUT_MIN_COINS, e.PAYOUT_HOLD_DAYS, e.PAYOUT_WITHHOLD_PCT, e.PAYOUT_FEE_CENTS = saved

    def test_real_mode_does_not_sell_without_a_provider(self):
        self.signup(self.alice, "alice")
        economy.MODE = "live"
        try:
            self.assertEqual(post(self.alice, "/api/wallet/buy", {"pack": "p100"}).status_code, 503)
        finally:
            economy.MODE = "sandbox"

    # ------------------------------------------------------------------ media server (SFU) + several streamers
    def test_media_keys_and_auth(self):
        config.MEDIA_URL = "http://media.test:8889"
        try:
            self.signup(self.alice, "alice")
            self.signup(self.bob, "bob")
            self.assertEqual(self.anon.get("/api/stream/key").status_code, 401)
            info = self.alice.get("/api/stream/key").get_json()
            self.assertTrue(info["enabled"])
            self.assertEqual((info["path"], info["whip"]), ("alice", "http://media.test:8889/alice/whip"))
            key = info["key"]
            self.assertGreaterEqual(len(key), 24)
            self.assertEqual(self.alice.get("/api/stream/key").get_json()["key"], key)  # stable until reset
            bob_key = self.bob.get("/api/stream/key").get_json()["key"]
            self.assertNotEqual(key, bob_key)

            def auth(**fields):
                body = {"action": "publish", "path": "alice", "ip": "10.0.0.9", "protocol": "webrtc", **fields}
                return self.anon.post("/api/media/auth", json=body).status_code

            # the key may arrive as a bearer token, a password, "user:pass", or a query parameter
            self.assertEqual(auth(token=key), 200)
            self.assertEqual(auth(password=key), 200)
            self.assertEqual(auth(token=f"alice:{key}"), 200)
            self.assertEqual(auth(query=f"pass={key}"), 200)
            self.assertEqual(auth(query=f"key={key}&x=1"), 200)
            self.assertEqual(auth(), 401)                       # no credentials yet: MediaMTX asks for them
            self.assertEqual(auth(token="wrong"), 401)
            self.assertEqual(auth(token=bob_key), 401)           # another channel's key doesn't work here
            self.assertEqual(auth(path="bob", token=bob_key), 200)
            self.assertEqual(auth(path="Alice", token=key), 403)  # only the lowercase path is valid
            self.assertEqual(auth(path="nobody", token=key), 401)
            self.assertEqual(auth(action="api"), 403)
            self.assertEqual(auth(action="playback", token=key), 403)
            self.assertEqual(auth(action="read", path="alice"), 200)  # watching is public
            self.assertEqual(auth(action="read", path="../x"), 403)
            # resetting the key invalidates the old one
            new_key = post(self.alice, "/api/stream/key/reset").get_json()["key"]
            self.assertNotEqual(new_key, key)
            self.assertEqual(auth(token=key), 401)
            self.assertEqual(auth(token=new_key), 200)
            # repeated bad guesses from one address get blocked
            for _ in range(25):
                auth(token="guess")
            self.assertEqual(auth(token=new_key), 429)
        finally:
            config.MEDIA_URL = ""
            core._failed_logins.clear()

    def test_sfu_mode(self):
        self.signup(self.alice, "alice")
        # without a media server configured, sfu streams are refused
        self.assertEqual(post(self.alice, "/api/stream/start", {"title": "t", "category": "Talk", "mode": "sfu"}).status_code, 400)
        self.assertEqual(post(self.alice, "/api/stream/start", {"title": "t", "category": "Talk", "mode": "bogus"}).status_code, 400)
        config.MEDIA_URL = "http://media.test:8889"
        try:
            self.assertTrue(self.anon.get("/api/me").get_json()["config"]["media"]["enabled"])
            r = post(self.alice, "/api/stream/start", {"title": "t", "category": "Talk", "mode": "sfu"})
            self.assertEqual(r.get_json()["mode"], "sfu")
            self.assertEqual(self.anon.get("/api/channel/alice").get_json()["channel"]["mode"], "sfu")
            # the CSP lets the browser talk to the media server
            self.assertIn("http://media.test:8889", self.anon.get("/").headers["Content-Security-Policy"])
            # viewers still register (for counts, one-tab-per-account, kicks) but nothing is signaled to the streamer
            g1, g2 = app.test_client(), app.test_client()
            self.assertEqual(post(g1, "/api/watch/alice/join", {"peer": "1" * 32}).status_code, 200)
            self.assertEqual(post(g2, "/api/watch/alice/join", {"peer": "2" * 32}).status_code, 200)
            p = self.alice.get("/api/stream/poll?after=0").get_json()
            self.assertEqual((p["viewers"], p["signals"]), (2, []))
            # a media-server stream isn't limited to the few viewers a browser can encode for
            config.MAX_VIEWERS = 1
            try:
                self.assertEqual(post(app.test_client(), "/api/watch/alice/join", {"peer": "3" * 32}).status_code, 200)
            finally:
                config.MAX_VIEWERS = 25
        finally:
            config.MEDIA_URL = ""

    def test_many_streamers_at_once(self):
        names = ["ann", "ben", "cai", "dan", "eve"]
        clients = {}
        for n in names:
            clients[n] = app.test_client()
            self.signup(clients[n], n)
            post(clients[n], "/api/stream/start", {"title": f"{n}'s show", "category": "Gaming" if n < "c" else "Music"})
        live = self.anon.get("/api/live").get_json()["streams"]
        self.assertEqual(sorted(s["username"] for s in live), sorted(names))
        # every streamer has their own audience, counted separately
        for i, n in enumerate(names):
            for j in range(i):  # ann has 0 viewers, ben 1, cai 2 ...
                post(app.test_client(), f"/api/watch/{n}/join", {"peer": f"{i}{j}".ljust(32, "a")})
        counts = {s["username"]: s["viewers"] for s in self.anon.get("/api/live").get_json()["streams"]}
        self.assertEqual(counts, {"ann": 0, "ben": 1, "cai": 2, "dan": 3, "eve": 4})
        self.assertEqual(len(self.anon.get("/api/live?category=Gaming").get_json()["streams"]), 2)
        # signals never cross between streamers
        post(app.test_client(), "/api/watch/cai/join", {"peer": "f" * 32})
        self.assertEqual([s["kind"] for s in clients["ann"].get("/api/stream/poll?after=0").get_json()["signals"]], [])
        self.assertIn("join", [s["kind"] for s in clients["cai"].get("/api/stream/poll?after=0").get_json()["signals"]])
        # one stops, the others keep going
        post(clients["ben"], "/api/stream/stop")
        self.assertEqual(len(self.anon.get("/api/live").get_json()["streams"]), 4)

    def test_list_cache(self):
        self.signup(self.alice, "alice")
        config.LIST_CACHE_SECONDS = 30
        try:
            self.assertEqual(self.anon.get("/api/live").get_json()["streams"], [])
            post(self.alice, "/api/stream/start", {"title": "t", "category": "Talk"})
            self.assertEqual(self.anon.get("/api/live").get_json()["streams"], [])  # still the cached answer
            self.assertEqual(len(self.anon.get("/api/live?x=1").get_json()["streams"]), 1)  # different URL, fresh
            self.assertTrue(self.anon.get("/api/live").is_json)
        finally:
            config.LIST_CACHE_SECONDS = 0

    # ------------------------------------------------------------------ upgrades
    def test_upgrades(self):
        e = economy
        saved = e.PAYOUT_HOLD_DAYS, e.PAYOUT_MIN_COINS
        e.PAYOUT_HOLD_DAYS, e.PAYOUT_MIN_COINS = 0, 100
        try:
            self.signup(self.alice, "alice")
            self.signup(self.bob, "bob")
            self.buy(self.bob, "p1000")
            self.assertEqual(self.alice.get("/api/upgrades").get_json()["levels"]["earnings"], 0)
            for bad in (0, 101, True, "3", 2.5):
                self.assertEqual(post(self.bob, "/api/upgrades/points", {"points": bad}).status_code, 400, bad)
            self.assertEqual(post(self.bob, "/api/upgrades/points", {"points": 3, "source": "nope"}).status_code, 400)
            self.assertEqual(post(self.anon, "/api/upgrades/points", {"points": 1}).status_code, 401)
            self.assertEqual(post(self.bob, "/api/upgrades/points", {"points": 11}).status_code, 402)  # 1,100 Yelis > 1,000
            r = post(self.bob, "/api/upgrades/points", {"points": 3})
            self.assertEqual((r.status_code, r.get_json()["points"], r.get_json()["wallet"]), (201, 3, 700))
            # levels cost points; the first Earnings level costs 2
            r = post(self.bob, "/api/upgrades/level", {"track": "earnings"})
            self.assertEqual((r.get_json()["level"], r.get_json()["points"], r.get_json()["value"]), (1, 1, 56))
            self.assertEqual(post(self.bob, "/api/upgrades/level", {"track": "earnings"}).status_code, 402)  # next one costs 4
            self.assertEqual(post(self.bob, "/api/upgrades/level", {"track": "bogus"}).status_code, 400)
            self.assertEqual(self.bob.get("/api/upgrades").get_json()["levels"]["earnings"], 1)
            # Earned Yelis can be reinvested too, and the Earnings level changes what a Yeli is worth
            post(self.bob, "/api/wallet/donate", {"channel": "alice", "coins": 500})
            self.assertEqual(post(self.alice, "/api/upgrades/points", {"points": 6, "source": "earned"}).status_code, 402)
            self.assertEqual(post(self.alice, "/api/upgrades/points", {"points": 2, "source": "earned"}).status_code, 201)
            w = self.alice.get("/api/wallet").get_json()["wallet"]
            self.assertEqual((w["earned"], w["cashable"], w["rate"]), (300, 300, 50))
            self.assertEqual(post(self.alice, "/api/upgrades/level", {"track": "earnings"}).get_json()["value"], 56)
            w = self.alice.get("/api/wallet").get_json()["wallet"]
            self.assertEqual(w["rate"], 56)
            r = post(self.alice, "/api/wallet/payout", {"coins": 300, "method": "paypal", "destination": "a@x.com"})
            self.assertEqual(r.get_json()["payout"]["gross_cents"], 168)  # 300 * 56 / 100
            self.assertEqual(self.alice.get("/api/wallet").get_json()["history"][0]["kind"], "payout_request")
            # every track has a ladder, the last one stops
            for track, spec in e.UPGRADES.items():
                self.assertEqual(len(spec["values"]), len(spec["costs"]) + 1, track)
            self.assertEqual((e.EARN_RATES[0], e.EARN_RATES[-1]), (50, 80))
            # badge level shows next to the name in chat
            self.buy(self.bob, "p1000")
            post(self.bob, "/api/upgrades/points", {"points": 5})
            post(self.bob, "/api/upgrades/points", {"points": 1})
            self.assertEqual(post(self.bob, "/api/upgrades/level", {"track": "badge"}).status_code, 200)
            m = post(self.bob, "/api/chat/alice", {"text": "hi"}).get_json()["message"]
            self.assertEqual(m["badge"], 1)
        finally:
            e.PAYOUT_HOLD_DAYS, e.PAYOUT_MIN_COINS = saved

    # ------------------------------------------------------------------ chat bot
    def command(self, client, name, response, **extra):
        return post(client, "/api/bot/commands", {"name": name, "response": response, **extra})

    def test_bot_commands(self):
        from yeli import bot as botmod
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")
        self.assertEqual(self.anon.get("/api/bot").status_code, 401)
        self.assertEqual(self.alice.get("/api/bot").get_json()["slots"], 50)
        self.assertEqual(self.command(self.alice, "!Hello", "Hi {user}, welcome to {channel}! {args}").status_code, 201)
        self.assertEqual(self.command(self.alice, "hello", "dup").status_code, 409)
        self.assertEqual(self.command(self.alice, "dice", "x").status_code, 400)            # built-in name
        self.assertEqual(self.command(self.alice, "bad name!", "x").status_code, 400)
        self.assertEqual(self.command(self.alice, "empty", "  ").status_code, 400)
        self.assertEqual(self.command(self.alice, "perm", "x", perm="king").status_code, 400)
        self.assertEqual(self.command(self.bob, "x", "y").status_code, 201)                 # everyone has their own bot
        r = post(self.bob, "/api/chat/alice", {"text": "!hello  it works"})
        reply = r.get_json()["bot"][0]
        self.assertEqual((reply["kind"], reply["user"], reply["text"]), ("bot", "YeliBot", "Hi bob, welcome to alice! it works"))
        self.assertFalse(reply["owner"])
        # the bot message is part of the chat history, and cooldowns stop spam
        texts = [(m["kind"], m["text"]) for m in self.anon.get("/api/chat/alice?after=0").get_json()["messages"]]
        self.assertEqual(texts[-1], ("bot", "Hi bob, welcome to alice! it works"))
        self.assertEqual(post(self.bob, "/api/chat/alice", {"text": "!hello again"}).get_json()["bot"], [])
        self.assertEqual(post(self.bob, "/api/chat/alice", {"text": "!nothing here"}).get_json()["bot"], [])  # unknown command: ignored
        # permissions
        self.command(self.alice, "mods", "only me", perm="owner", cooldown=0)
        self.assertEqual(post(self.bob, "/api/chat/alice", {"text": "!mods"}).get_json()["bot"], [])
        self.assertEqual(post(self.alice, "/api/chat/alice", {"text": "!mods"}).get_json()["bot"][0]["text"], "only me")
        self.command(self.alice, "fans", "followers only", perm="followers", cooldown=0)
        carol = app.test_client()
        self.signup(carol, "carol")
        self.assertEqual(post(carol, "/api/chat/alice", {"text": "!fans"}).get_json()["bot"], [])
        post(carol, "/api/follow/alice", {"follow": True})
        self.assertEqual(post(carol, "/api/chat/alice", {"text": "!fans"}).get_json()["bot"][0]["text"], "followers only")
        # built-ins
        self.assertIn("rolled a", post(self.alice, "/api/chat/alice", {"text": "!dice 20"}).get_json()["bot"][0]["text"])
        out = post(self.alice, "/api/chat/alice", {"text": "!commands"}).get_json()["bot"][0]["text"]
        self.assertTrue("!hello" in out and "!dice" in out and "!mods" in out)
        self.assertEqual(post(self.bob, "/api/chat/alice", {"text": "!so carol"}).get_json()["bot"], [])  # !so is for the streamer
        self.assertIn("#/c/carol", post(self.alice, "/api/chat/alice", {"text": "!so @carol"}).get_json()["bot"][0]["text"])
        # a cap on how many commands one channel can have
        for i in range(2):
            self.command(self.alice, f"c{i}", "x")
        botmod.MAX_COMMANDS = 5
        try:
            self.assertEqual(self.command(self.alice, "one_more", "x").status_code, 400)
        finally:
            botmod.MAX_COMMANDS = 50
        # edit and delete
        cmds = {c["name"]: c for c in self.alice.get("/api/bot").get_json()["commands"]}
        self.assertEqual(self.command(self.alice, "hello", "Updated", id=cmds["hello"]["id"], cooldown=0).status_code, 201)
        botmod._cooldowns.clear()
        self.assertEqual(post(self.bob, "/api/chat/alice", {"text": "!hello"}).get_json()["bot"][0]["text"], "Updated")
        post(self.alice, "/api/bot/commands/delete", {"id": cmds["hello"]["id"]})
        self.assertNotIn("hello", [c["name"] for c in self.alice.get("/api/bot").get_json()["commands"]])
        # template variables
        self.assertEqual(botmod.render("{user} {count} {nope} {random:a|b}", {"user": "u", "count": 3}) in ("u 3 {nope} a", "u 3 {nope} b"), True)

    def test_chat_moderation_and_timers(self):
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")
        say = lambda client, text: post(client, "/api/chat/alice", {"text": text})  # noqa: E731
        save = lambda **s: post(self.alice, "/api/bot/settings", s).get_json()["settings"]  # noqa: E731
        # banned words, links and shouting
        save(banned_words="Badword, spoiler", block_links=True, caps_percent=60)
        self.assertEqual(say(self.bob, "this is a BADWORD ok").status_code, 400)
        self.assertEqual(say(self.bob, "visit www.example.com now").status_code, 400)
        self.assertEqual(say(self.bob, "check https://x.io/abc").status_code, 400)
        self.assertEqual(say(self.bob, "WHY ARE YOU ALL SHOUTING").status_code, 400)
        self.assertEqual(say(self.bob, "a normal message").status_code, 201)
        self.assertEqual(say(self.alice, "the owner is never limited: BADWORD www.x.com").status_code, 201)
        # followers-only and slow mode
        save(followers_only=True)
        self.assertEqual(say(self.bob, "can I talk?").status_code, 403)
        post(self.bob, "/api/follow/alice", {"follow": True})
        self.assertEqual(say(self.bob, "now I can").status_code, 201)
        save(slow_seconds=30)
        self.assertEqual(say(self.bob, "second message").status_code, 429)
        self.assertEqual(say(self.alice, "owner again").status_code, 201)
        self.assertEqual(save(slow_seconds=9999)["slow_seconds"], 300)  # clamped
        # welcome and thanks come from the bot
        save(welcome=True, welcome_text="Welcome {user}!", thanks=True, thanks_text="{user} sent {amount} Yelis, thanks!")
        carol = app.test_client()
        self.signup(carol, "carol")
        post(carol, "/api/follow/alice", {"follow": True})
        post(carol, "/api/follow/alice", {"follow": True})  # following again doesn't greet twice
        self.buy(carol, "p100")
        post(carol, "/api/wallet/donate", {"channel": "alice", "coins": 50})
        bots = [m["text"] for m in self.anon.get("/api/chat/alice?after=0").get_json()["messages"] if m["kind"] == "bot"]
        self.assertEqual(bots, ["Welcome carol!", "carol sent 50 Yelis, thanks!"])
        # timers: posted from the streamer's heartbeat, once per interval
        post(self.alice, "/api/stream/start", {"title": "t", "category": "Talk"})
        self.assertEqual(self.command(self.alice, "social", "Follow {channel} everywhere!", every_min=5).status_code, 201)
        self.assertEqual(self.command(self.alice, "bad", "x", every_min=2).status_code, 400)
        self.alice.get("/api/stream/poll")
        self.alice.get("/api/stream/poll")
        timed = [m["text"] for m in self.anon.get("/api/chat/alice?after=0").get_json()["messages"] if m["text"].startswith("Follow ")]
        self.assertEqual(timed, ["Follow alice everywhere!"])
        # settings are private to the owner
        self.assertEqual(post(self.anon, "/api/bot/settings", {}).status_code, 401)

    def test_recommended(self):
        names = ["ann", "ben", "cai"]
        cl = {}
        for n in names:
            cl[n] = app.test_client()
            self.signup(cl[n], n)
        names_of = lambda: [c["username"] for c in self.anon.get("/api/recommended").get_json()["channels"]]  # noqa: E731
        self.assertEqual(names_of(), [])                       # offline channels without the upgrade aren't recommended
        post(cl["ann"], "/api/stream/start", {"title": "t", "category": "Talk"})
        self.assertEqual(names_of(), ["ann"])                  # live ones are
        # ben buys the Recommendation upgrade and is promoted even while offline
        self.buy(cl["ben"], "p500")
        post(cl["ben"], "/api/upgrades/points", {"points": 2})
        self.assertEqual(post(cl["ben"], "/api/upgrades/level", {"track": "boost"}).status_code, 200)
        self.assertEqual(sorted(names_of()), ["ann", "ben"])
        self.assertTrue(all(c["username"] != "cai" for c in self.anon.get("/api/recommended").get_json()["channels"]))

    def test_health_and_proxy(self):
        self.assertEqual(self.anon.get("/healthz").get_data(as_text=True), "ok")
        from werkzeug.middleware.proxy_fix import ProxyFix
        p = yeli.create_app()
        p.wsgi_app = ProxyFix(p.wsgi_app, x_for=1, x_proto=1, x_host=1)
        c = p.test_client()
        r = c.get("/", headers={"X-Forwarded-Proto": "https", "X-Forwarded-For": "203.0.113.7"})
        self.assertIn("max-age", r.headers.get("Strict-Transport-Security", ""))  # HSTS once the proxy says it's https

    def age_chat(self):
        con = sqlite3.connect(config.DB_PATH)
        con.execute("UPDATE chat_messages SET created_at = created_at - 100")
        con.commit()
        con.close()

    # ------------------------------------------------------------------ voice (TTS) command
    def test_tts_command(self):
        from yeli import bot as botmod
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")
        def say(client, text):
            self.age_chat()
            return post(client, "/api/chat/alice", {"text": text}).get_json()

        save = lambda **s: post(self.alice, "/api/bot/settings", s)  # noqa: E731
        self.assertEqual(say(self.bob, "!say hello")["bot"], [])                    # off by default
        self.assertEqual(save(tts_enabled=True, tts_cooldown=0, tts_template="{user} dice: {text}").status_code, 200)
        r = say(self.bob, "!say  Hola   a todos")["bot"][0]
        self.assertEqual((r["kind"], r["user"], r["text"]), ("tts", "bob", "bob dice: Hola a todos"))   # says the name
        save(tts_enabled=True, tts_name=False, tts_cooldown=0)
        botmod._cooldowns.clear()
        self.assertEqual(say(self.bob, "!say Hola a todos")["bot"][0]["text"], "Hola a todos")           # without the name
        self.assertEqual(say(self.bob, "!say")["bot"], [])                          # nothing to say
        # the command word, permission, length and cooldown are the streamer's choice
        self.assertEqual(save(tts_enabled=True, tts_command="dice").status_code, 400)
        self.assertEqual(save(tts_enabled=True, tts_command="!Voz", tts_name=False, tts_cooldown=0, tts_max=20).status_code, 200)
        botmod._cooldowns.clear()
        self.assertEqual(say(self.bob, "!voz this sentence is much longer than twenty characters")["bot"][0]["text"], "this sentence is muc")
        self.assertEqual(say(self.bob, "!say old name")["bot"], [])
        self.assertEqual(save(tts_enabled=True, tts_command="voz", tts_perm="owner", tts_name=False, tts_cooldown=0).status_code, 200)
        botmod._cooldowns.clear()
        self.assertEqual(say(self.bob, "!voz hi")["bot"], [])
        self.assertEqual(say(self.alice, "!voz owner speaking")["bot"][0]["text"], "owner speaking")
        self.assertEqual(save(tts_enabled=True, tts_perm="king").status_code, 400)
        self.assertEqual(save(tts_enabled=True, tts_lang="not a lang").status_code, 400)
        self.assertEqual(save(tts_enabled=True, tts_lang="es-AR", tts_template="no placeholder").status_code, 200)
        st = self.alice.get("/api/bot").get_json()["settings"]
        self.assertEqual((st["tts_lang"], st["tts_template"]), ("es-AR", "no placeholder {text}"))
        save(tts_enabled=True, tts_command="voz", tts_cooldown=30, tts_perm="everyone", tts_name=True, tts_template="{user} says: {text}")
        botmod._cooldowns.clear()
        self.assertEqual(len(say(self.bob, "!voz one")["bot"]), 1)
        self.assertEqual(say(self.bob, "!voz two")["bot"], [])                      # per-user cooldown
        # chat rules still apply to what gets spoken, and the history keeps the voice lines
        save(tts_enabled=True, tts_command="voz", banned_words="spoiler")
        self.age_chat()
        self.assertEqual(post(self.bob, "/api/chat/alice", {"text": "!voz a spoiler"}).status_code, 400)
        self.assertIn("tts", [m["kind"] for m in self.anon.get("/api/chat/alice?after=0").get_json()["messages"]])

    # ------------------------------------------------------------------ moderators and bans
    def test_moderators_and_bans(self):
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")
        carol = app.test_client()
        self.signup(carol, "carol")
        def say(client, text):
            self.age_chat()
            return post(client, "/api/chat/alice", {"text": text})

        self.assertEqual(carol.get("/api/mod/alice").status_code, 403)
        self.assertEqual(post(carol, "/api/mods/add", {"user": "bob"}).get_json()["mods"], ["bob"])  # carol makes bob a mod of *her* channel
        self.assertEqual(self.bob.get("/api/mod/alice").status_code, 403)                          # ...which doesn't give him alice's
        self.assertEqual(post(self.alice, "/api/mods/add", {"user": "nobody"}).status_code, 404)
        self.assertEqual(post(self.alice, "/api/mods/add", {"user": "alice"}).status_code, 400)
        self.assertEqual(post(self.alice, "/api/mods/add", {"user": "carol"}).get_json()["mods"], ["carol"])
        self.assertTrue(self.anon.get("/api/channel/alice").get_json()["channel"]["is_mod"] is False)
        self.assertTrue(carol.get("/api/channel/alice").get_json()["channel"]["is_mod"])
        self.assertEqual(carol.get("/api/mod/channels").get_json()["channels"], ["alice"])
        self.assertTrue(say(carol, "I moderate").get_json()["message"]["mod"])
        # a moderator can delete messages and ban viewers
        m = say(self.bob, "bad message").get_json()["message"]
        self.assertEqual(post(carol, "/api/chat/alice/delete", {"id": m["id"]}).status_code, 200)
        say(self.bob, "another one")
        t = self.anon.get("/api/chat/alice?after=0").get_json()["t"]
        for bad in (-5, True, "10", 10**9):
            self.assertEqual(post(carol, "/api/mod/alice/ban", {"user": "bob", "minutes": bad}).status_code, 400, bad)
        self.assertEqual(post(carol, "/api/mod/alice/ban", {"user": "alice", "minutes": 5}).status_code, 400)  # not the streamer
        self.assertEqual(post(carol, "/api/mod/alice/ban", {"user": "carol", "minutes": 5}).status_code, 400)  # not yourself
        self.assertEqual(post(carol, "/api/mod/alice/ban", {"user": "nobody", "minutes": 5}).status_code, 404)
        r = post(carol, "/api/mod/alice/ban", {"user": "bob", "minutes": 10, "reason": "spam", "purge": True})
        self.assertEqual([(b["username"], b["reason"], b["by_name"]) for b in r.get_json()["bans"]], [("bob", "spam", "carol")])
        removed = self.anon.get(f"/api/chat/alice?after=0&since={t}").get_json()["removed"]
        self.assertTrue(removed)                                                                   # their lines disappear for everyone
        r = say(self.bob, "can I talk?")
        self.assertEqual(r.status_code, 403)
        self.assertIn("banned", r.get_json()["error"])
        self.assertEqual(self.alice.get("/api/mod/alice").get_json()["bans"][0]["username"], "bob")
        # unban, then a permanent ban by the streamer
        self.assertEqual(post(carol, "/api/mod/alice/unban", {"user": "bob"}).get_json()["bans"], [])
        self.assertEqual(say(self.bob, "back again").status_code, 201)
        self.assertEqual(post(self.alice, "/api/mod/alice/ban", {"user": "bob", "minutes": 0}).status_code, 200)
        self.assertEqual(say(self.bob, "still banned").status_code, 403)
        # the ban expires
        con = sqlite3.connect(config.DB_PATH)
        con.execute("UPDATE chat_bans SET until = 1 WHERE until = 0 AND channel_id = (SELECT id FROM users WHERE username = 'alice')")
        con.commit(); con.close()
        self.assertEqual(say(self.bob, "expired").status_code, 201)
        # only the streamer can ban a moderator; banning one removes the role
        self.assertEqual(post(self.bob, "/api/mod/alice/ban", {"user": "carol", "minutes": 5}).status_code, 403)
        dave = app.test_client()
        self.signup(dave, "dave")
        post(self.alice, "/api/mods/add", {"user": "dave"})
        self.assertEqual(post(carol, "/api/mod/alice/ban", {"user": "dave", "minutes": 5}).status_code, 403)
        post(self.alice, "/api/mod/alice/ban", {"user": "dave", "minutes": 5})
        self.assertEqual(post(self.alice, "/api/mods/remove", {"user": "carol"}).get_json()["mods"], [])
        # moderators aren't limited by chat rules, regular viewers are; moderators get mod-only commands
        post(self.alice, "/api/mods/add", {"user": "carol"})
        post(self.alice, "/api/bot/settings", {"block_links": True})
        self.assertEqual(say(carol, "look www.example.com").status_code, 201)
        self.assertEqual(say(self.bob, "www.example.com").status_code, 400)
        post(self.alice, "/api/bot/settings", {"block_links": True, "slow_seconds": 60})
        self.assertEqual(say(carol, "and again").status_code, 201)       # slow mode doesn't apply to moderators
        self.assertEqual(say(carol, "and again twice").status_code, 201)
        self.assertEqual(say(self.bob, "first").status_code, 201)
        self.assertEqual(post(self.bob, "/api/chat/alice", {"text": "too soon"}).status_code, 429)
        self.age_chat()
        post(self.alice, "/api/bot/commands", {"name": "modsonly", "response": "mods!", "perm": "mods", "cooldown": 0})
        self.assertEqual(say(self.bob, "!modsonly").get_json()["bot"], [])
        self.assertEqual(say(carol, "!modsonly").get_json()["bot"][0]["text"], "mods!")

    # ------------------------------------------------------------------ stream alerts
    def test_alerts(self):
        import base64
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")
        self.assertEqual(self.anon.get("/api/alerts").status_code, 401)
        up = lambda kind, raw, mime: post(self.alice, "/api/alerts/assets", {"kind": kind, "data": f"data:{mime};base64," + base64.b64encode(raw).decode()})  # noqa: E731
        png = b"\x89PNG\r\n\x1a\n" + b"0" * 50
        r = up("image", png, "image/png")
        self.assertEqual(r.status_code, 201)
        img = r.get_json()["id"]
        self.assertEqual(up("image", b"not an image at all", "image/png").status_code, 400)       # bytes must match the type
        self.assertEqual(up("image", png, "image/svg+xml").status_code, 400)                       # no svg (scripts)
        self.assertEqual(up("image", png + b"0" * 70000, "image/png").status_code, 400)            # too big
        wav = up("sound", b"RIFF\x00\x00\x00\x00WAVE" + b"0" * 40, "audio/wav")
        mp3 = up("sound", b"ID3" + b"0" * 40, "audio/mpeg")
        self.assertEqual((wav.status_code, mp3.status_code), (201, 201))
        self.assertEqual(up("sound", b"not audio", "audio/mpeg").status_code, 400)
        snd = wav.get_json()["id"]
        served = self.anon.get(f"/api/asset/{img}")
        self.assertEqual((served.status_code, served.mimetype, served.data), (200, "image/png", png))  # OBS-style pages have no cookies
        self.assertEqual(self.anon.get("/api/asset/../x").status_code, 404)
        # rules
        rule = {"event": "donation", "min_amount": 100, "title": "{user} sent {amount} Yelis!", "image": "sticker:crown", "sound": "preset:coin", "seconds": 6, "volume": 70}
        r = post(self.alice, "/api/alerts/rules", rule)
        self.assertEqual(r.status_code, 201)
        rid = r.get_json()["rules"][0]["id"]
        for bad in ({"event": "nope"}, {"seconds": 1}, {"seconds": 11}, {"volume": 101}, {"min_amount": -1}, {"image": "sticker:nope"},
                    {"image": "asset:" + "0" * 16}, {"sound": "preset:nope"}, {"image": "asset:" + snd}, {"sound": "asset:" + img}):
            self.assertEqual(post(self.alice, "/api/alerts/rules", {**rule, **bad}).status_code, 400, bad)
        self.assertEqual(post(self.alice, "/api/alerts/rules", {**rule, "id": rid, "title": "Edited", "image": "asset:" + img, "sound": "asset:" + snd}).status_code, 201)
        self.assertEqual(post(self.alice, "/api/alerts/rules", {"event": "follow", "title": "{user} followed!"}).status_code, 201)
        # nobody else can use alice's files or edit her alerts
        self.assertEqual(post(self.bob, "/api/alerts/rules", {**rule, "image": "asset:" + img}).status_code, 400)
        self.assertEqual(post(self.bob, "/api/alerts/rules", {**rule, "id": rid}).status_code, 404)
        state = self.alice.get("/api/alerts").get_json()
        self.assertEqual([(r["event"], r["title"]) for r in state["rules"]], [("donation", "Edited"), ("follow", "{user} followed!")][::1])
        # events: the studio asks for the latest id first, then only what's new
        last = self.alice.get("/api/alerts/events").get_json()["last"]
        post(self.bob, "/api/follow/alice", {"follow": True})
        self.buy(self.bob, "p100")
        post(self.bob, "/api/wallet/donate", {"channel": "alice", "coins": 60, "message": "hi"})
        ev = self.alice.get(f"/api/alerts/events?after={last}").get_json()
        self.assertEqual([(e["kind"], e["username"], e["amount"]) for e in ev["events"]], [("follow", "bob", 0), ("donation", "bob", 60)])
        self.assertEqual(self.alice.get(f"/api/alerts/events?after={ev['last']}").get_json()["events"], [])
        self.assertEqual(self.bob.get(f"/api/alerts/events?after={last}").get_json()["events"], [])  # bob has his own, empty, feed
        self.assertEqual(post(self.alice, "/api/alerts/rules/delete", {"id": rid}).get_json()["rules"][0]["event"], "follow")

    # ------------------------------------------------------------------ free upgrade point
    def test_free_point_for_an_hour_viewer(self):
        saved = config.FREE_POINT_MIN_ACCOUNT_AGE, config.FREE_POINTS_PER_DAY
        config.FREE_POINT_MIN_ACCOUNT_AGE = 0
        try:
            self.signup(self.alice, "alice")
            self.signup(self.bob, "bob")
            carol, dave = app.test_client(), app.test_client()
            self.signup(carol, "carol")
            self.signup(dave, "dave")
            self.bob.environ_base["REMOTE_ADDR"] = "10.0.0.5"
            carol.environ_base["REMOTE_ADDR"] = "10.0.0.6"
            dave.environ_base["REMOTE_ADDR"] = "10.0.0.7"
            post(self.alice, "/api/stream/start", {"title": "t", "category": "Talk"})
            peers = {"bob": "1" * 32, "carol": "2" * 32, "dave": "3" * 32, "alice": "4" * 32}
            clients = {"bob": self.bob, "carol": carol, "dave": dave, "alice": self.alice}
            for n, c in clients.items():
                post(c, "/api/watch/alice/join", {"peer": peers[n]})
            poll = lambda n: clients[n].get(f"/api/watch/alice/poll?peer={peers[n]}&after=0")  # noqa: E731
            con = sqlite3.connect(config.DB_PATH)
            age = lambda n, secs: (con.execute("UPDATE watch_sessions SET started_at = started_at - ? WHERE viewer_key = (SELECT 'u' || id FROM users WHERE username = ?)", (secs, n)), con.commit())  # noqa: E731
            points = lambda: self.alice.get("/api/upgrades").get_json()["points"]  # noqa: E731
            for n in peers:
                poll(n)                                                  # sessions start now
            self.assertEqual(points(), 0)
            age("bob", 1800); poll("bob")                                 # only half an hour so far
            self.assertEqual(points(), 0)
            eta = self.alice.get("/api/stream/poll").get_json()
            self.assertTrue(1700 < eta["free_eta"] < 1900, eta["free_eta"])  # the studio can show "next free point in..."
            age("bob", 1900); poll("bob")                                 # an hour of watching
            self.assertEqual(points(), 1)
            p = self.alice.get("/api/stream/poll").get_json()
            self.assertEqual((p["free_points"], p["free_today"]), (1, 1))  # announced once
            self.assertEqual(self.alice.get("/api/stream/poll").get_json()["free_points"], 0)
            age("bob", 4000); poll("bob")
            self.assertEqual(points(), 1)                                 # one point per viewer per day
            # the streamer can't farm points with their own account or their own network
            age("alice", 4000); poll("alice")
            self.assertEqual(points(), 1)
            carol.environ_base["REMOTE_ADDR"] = "127.0.0.1"               # same network as the streamer
            age("carol", 4000); poll("carol")
            self.assertEqual(points(), 1)
            carol.environ_base["REMOTE_ADDR"] = "10.0.0.6"
            # guests don't count (they can't be told apart reliably)
            guest = app.test_client()
            guest.environ_base["REMOTE_ADDR"] = "10.0.0.8"
            post(guest, "/api/watch/alice/join", {"peer": "5" * 32})
            guest.get(f"/api/watch/alice/poll?peer={'5' * 32}&after=0")
            con.execute("UPDATE watch_sessions SET started_at = started_at - 4000 WHERE viewer_key LIKE 'a%'"); con.commit()
            guest.get(f"/api/watch/alice/poll?peer={'5' * 32}&after=0")
            self.assertEqual(points(), 1)
            # leaving resets the clock: a gap of more than a minute starts over
            con.execute("UPDATE watch_sessions SET started_at = started_at - 4000, last_seen = last_seen - 500 WHERE viewer_key = (SELECT 'u' || id FROM users WHERE username = 'dave')"); con.commit()
            poll("dave")
            self.assertEqual(points(), 1)
            # daily cap
            config.FREE_POINTS_PER_DAY = 1
            age("carol", 4000); poll("carol")
            self.assertEqual(points(), 1)
            config.FREE_POINTS_PER_DAY = 3
            age("carol", 4000); poll("carol")
            self.assertEqual(points(), 2)
            # a brand-new account doesn't count
            config.FREE_POINT_MIN_ACCOUNT_AGE = 10**6
            eve = app.test_client(); self.signup(eve, "eve"); eve.environ_base["REMOTE_ADDR"] = "10.0.0.9"
            post(eve, "/api/watch/alice/join", {"peer": "6" * 32})
            eve.get(f"/api/watch/alice/poll?peer={'6' * 32}&after=0")
            con.execute("UPDATE watch_sessions SET started_at = started_at - 4000 WHERE viewer_key = (SELECT 'u' || id FROM users WHERE username = 'eve')"); con.commit()
            eve.get(f"/api/watch/alice/poll?peer={'6' * 32}&after=0")
            self.assertEqual(points(), 2)
            con.close()
        finally:
            config.FREE_POINT_MIN_ACCOUNT_AGE, config.FREE_POINTS_PER_DAY = saved


    # ------------------------------------------------------------------ daily chest
    def test_daily_chest(self):
        saved = config.FREE_POINT_MIN_ACCOUNT_AGE, dict(economy.CHEST_WEIGHTS)
        config.FREE_POINT_MIN_ACCOUNT_AGE = 0
        try:
            self.signup(self.alice, "alice")
            self.signup(self.bob, "bob")
            self.bob.environ_base["REMOTE_ADDR"] = "10.0.0.5"
            post(self.alice, "/api/stream/start", {"title": "t", "category": "Talk"})
            peer = "1" * 32
            post(self.bob, "/api/watch/alice/join", {"peer": peer})
            poll = lambda: self.bob.get(f"/api/watch/alice/poll?peer={peer}&after=0").get_json()  # noqa: E731
            con = sqlite3.connect(config.DB_PATH)
            uid = con.execute("SELECT id FROM users WHERE username = 'bob'").fetchone()[0]
            lag = lambda secs, at: (con.execute("UPDATE chest_progress SET seconds = ?, last_tick = last_tick - ? WHERE user_id = ?", (secs, at, uid)), con.commit())  # noqa: E731

            c = poll()["chest"]                                              # first heartbeat starts the clock
            self.assertEqual((c["seconds"], c["needed"], c["ready"]), (0, 3600, False))
            self.assertEqual(self.bob.get("/api/chest").get_json()["ready"], False)
            self.assertEqual(post(self.bob, "/api/chest/open").status_code, 403)   # still locked
            lag(0, 30); self.assertEqual(poll()["chest"]["seconds"], 30)            # time between heartbeats counts
            lag(100, 500); self.assertEqual(poll()["chest"]["seconds"], 100)        # a long gap (left the page) counts for nothing
            # guests and the streamer's own account earn nothing
            guest = app.test_client(); guest.environ_base["REMOTE_ADDR"] = "10.0.0.8"
            post(guest, "/api/watch/alice/join", {"peer": "2" * 32})
            self.assertIsNone(guest.get(f"/api/watch/alice/poll?peer={'2' * 32}&after=0").get_json()["chest"])
            post(self.alice, "/api/watch/alice/join", {"peer": "3" * 32})
            self.assertIsNone(self.alice.get(f"/api/watch/alice/poll?peer={'3' * 32}&after=0").get_json()["chest"])
            self.assertEqual(self.anon.get("/api/chest").status_code, 401)

            # an hour of watching unlocks it, and a sticker is what comes out
            economy.CHEST_WEIGHTS.update(sticker=1, color=0, points=0)
            lag(3599, 5)
            c = poll()["chest"]
            self.assertTrue(c["ready"] and c["seconds"] == 3600, c)
            r = post(self.bob, "/api/chest/open")
            self.assertEqual(r.status_code, 201, r.get_json())
            reward = r.get_json()["reward"]
            self.assertEqual(reward["kind"], "sticker")
            self.assertIn(reward["value"], economy.CHEST_STICKERS)
            self.assertEqual(r.get_json()["collection"]["stickers"], [reward["value"]])
            self.assertEqual(post(self.bob, "/api/chest/open").status_code, 409)    # one per day
            c = poll()["chest"]
            self.assertTrue(c["opened"] and not c["ready"])
            self.assertEqual(self.bob.get("/api/chest").get_json()["today"], reward)

            # the sticker is usable in chat; the ones you didn't find are not
            self.assertEqual(post(self.bob, "/api/chat/alice", {"sticker": reward["value"]}).status_code, 201)
            other = next(x for x in economy.CHEST_STICKERS if x != reward["value"])
            self.assertEqual(post(self.bob, "/api/chat/alice", {"sticker": other}).status_code, 403)
            self.assertEqual(post(self.alice, "/api/chat/alice", {"sticker": reward["value"]}).status_code, 403)

            # next day: a color, which works as a name color without buying the upgrade
            con.execute("UPDATE chest_opens SET day = day - 1 WHERE user_id = ?", (uid,))
            con.execute("DELETE FROM chest_progress WHERE user_id = ?", (uid,)); con.commit()
            economy.CHEST_WEIGHTS.update(sticker=0, color=1, points=0)
            poll(); lag(3599, 5); self.assertTrue(poll()["chest"]["ready"])
            r = post(self.bob, "/api/chest/open")
            color = r.get_json()["reward"]
            self.assertEqual(color["kind"], "color")
            self.assertIn(color["value"], economy.CHEST_COLORS)
            self.assertEqual(post(self.bob, "/api/me/color", {"color": color["value"]}).status_code, 200)
            self.assertEqual(self.bob.get("/api/upgrades").get_json()["chest_colors"], [color["value"]])
            not_won = next(x for x in economy.CHEST_COLORS if x != color["value"])
            self.assertEqual(post(self.bob, "/api/me/color", {"color": not_won}).status_code, 402)
            self.assertEqual(post(self.bob, "/api/chat/alice", {"text": "hi"}).get_json()["message"]["color"], color["value"])

            # day three: an upgrade point
            con.execute("UPDATE chest_opens SET day = day - 1 WHERE user_id = ?", (uid,))
            con.execute("DELETE FROM chest_progress WHERE user_id = ?", (uid,)); con.commit()
            economy.CHEST_WEIGHTS.update(sticker=0, color=0, points=1)
            poll(); lag(3599, 5); poll()
            before = self.bob.get("/api/upgrades").get_json()["points"]
            self.assertEqual(post(self.bob, "/api/chest/open").get_json()["reward"]["kind"], "points")
            self.assertEqual(self.bob.get("/api/upgrades").get_json()["points"], before + 1)

            # a brand-new account can earn the chest right away (no account-age rule)
            config.FREE_POINT_MIN_ACCOUNT_AGE = 10**6
            eve = app.test_client(); self.signup(eve, "eve"); eve.environ_base["REMOTE_ADDR"] = "10.0.0.9"
            post(eve, "/api/watch/alice/join", {"peer": "4" * 32})
            c = eve.get(f"/api/watch/alice/poll?peer={'4' * 32}&after=0").get_json()["chest"]
            self.assertNotIn("blocked", c)
            con.close()
        finally:
            config.FREE_POINT_MIN_ACCOUNT_AGE = saved[0]
            economy.CHEST_WEIGHTS.clear(); economy.CHEST_WEIGHTS.update(saved[1])

    # ------------------------------------------------------------------ chat name color
    def test_name_color(self):
        self.signup(self.bob, "bob")
        self.signup(self.alice, "alice")
        self.buy(self.bob, "p1000")
        post(self.bob, "/api/upgrades/points", {"points": 10})
        setc = lambda c: post(self.bob, "/api/me/color", {"color": c})  # noqa: E731
        self.assertEqual(setc("#ff6b6b").status_code, 402)                   # locked until the upgrade
        self.assertIsNone(None if self.bob.get("/api/upgrades").get_json()["palette"] == [] else "x")
        post(self.bob, "/api/upgrades/level", {"track": "color"})            # level 1: 4 colors
        self.assertEqual(len(self.bob.get("/api/upgrades").get_json()["palette"]), 4)
        self.assertEqual(setc("#ff6b6b").status_code, 200)
        self.assertEqual(setc("#ffa94d").status_code, 400)                   # that one needs level 2
        self.assertEqual(setc("red").status_code, 400)
        self.assertEqual(post(self.bob, "/api/chat/alice", {"text": "colorful"}).get_json()["message"]["color"], "#ff6b6b")
        post(self.bob, "/api/upgrades/level", {"track": "color"})            # level 2: 8 colors
        self.assertEqual(setc("#ffa94d").status_code, 200)
        self.assertEqual(setc("#123456").status_code, 400)
        post(self.bob, "/api/upgrades/level", {"track": "color"})            # level 3: any color
        self.assertEqual(setc("#123456").status_code, 200)
        self.assertEqual(self.anon.get("/api/chat/alice?after=0").get_json()["messages"][-1]["color"], "#123456")
        self.assertEqual(setc("").status_code, 200)                          # back to the default
        self.assertEqual(self.bob.get("/api/me").get_json()["user"]["name_color"], "")

    def test_video_likes_and_comments(self):
        octet = {"content_type": "application/octet-stream"}
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")
        post(self.alice, "/api/stream/start", {"title": "Live", "category": "Music"})
        vid = post(self.alice, "/api/vod/start", {"mime": "video/webm"}).get_json()["id"]
        self.alice.post(f"/api/vod/{vid}/chunk?seq=0", data=b"AAAA", **octet)
        like, comments = f"/api/vod/{vid}/like", f"/api/vod/{vid}/comments"

        # a recording that isn't saved yet can't be liked or commented
        self.assertEqual(post(self.bob, like, {"liked": True}).status_code, 404)
        self.assertEqual(post(self.bob, comments, {"text": "hi"}).status_code, 404)
        post(self.alice, f"/api/vod/{vid}/finish")
        # ...and neither can a clip: only published videos take likes and comments
        self.assertEqual(post(self.bob, like, {"liked": True}).status_code, 404)
        self.assertEqual(post(self.bob, comments, {"text": "hi"}).status_code, 404)
        post(self.alice, f"/api/vod/{vid}/publish", {"cover": JPEG})

        # likes: only accounts, idempotent, one per person, counted and reported per viewer
        self.assertEqual(post(self.anon, like, {"liked": True}).status_code, 401)
        self.assertEqual(post(self.bob, like, {"liked": "yes"}).status_code, 400)
        self.assertEqual(post(self.bob, like, {"liked": True}).get_json()["likes"], 1)
        self.assertEqual(post(self.bob, like, {"liked": True}).get_json()["likes"], 1)
        self.assertEqual(post(self.alice, like, {"liked": True}).get_json()["likes"], 2)
        v = self.bob.get(f"/api/vod/{vid}").get_json()["video"]
        self.assertEqual((v["likes"], v["liked"]), (2, True))
        v = self.anon.get(f"/api/vod/{vid}").get_json()["video"]
        self.assertEqual((v["likes"], v["liked"]), (2, False))
        self.assertEqual(post(self.bob, like, {"liked": False}).get_json()["likes"], 1)

        # comments: accounts only, trimmed, newest first, counted
        self.assertEqual(post(self.anon, comments, {"text": "hi"}).status_code, 401)
        self.assertEqual(post(self.bob, comments, {"text": "   "}).status_code, 400)
        first = post(self.bob, comments, {"text": "  great   stream  "})
        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.get_json()["comment"]["text"], "great stream")
        second = post(self.alice, comments, {"text": "thanks!"}).get_json()
        self.assertEqual(second["total"], 2)
        listed = self.anon.get(comments).get_json()
        self.assertEqual([c["text"] for c in listed["comments"]], ["thanks!", "great stream"])
        self.assertFalse(any(c["can_delete"] for c in listed["comments"]))
        self.assertEqual(self.anon.get(f"/api/vod/{vid}").get_json()["video"]["comment_count"], 2)

        # pagination: 25 more comments, 20 per page, `before` continues
        con = sqlite3.connect(config.DB_PATH)
        bob_id = con.execute("SELECT id FROM users WHERE username = 'bob'").fetchone()[0]
        for i in range(25):
            con.execute("INSERT INTO vod_comments (vod_id, user_id, text, created_at) VALUES (?, ?, ?, ?)", (vid, bob_id, f"c{i}", core.now() - 3600))
        con.commit()
        con.close()
        page1 = self.anon.get(comments).get_json()
        self.assertEqual((len(page1["comments"]), page1["more"], page1["total"]), (20, True, 27))
        page2 = self.anon.get(f"{comments}?before={page1['comments'][-1]['id']}").get_json()
        self.assertEqual((len(page2["comments"]), page2["more"]), (7, False))

        # who can delete: the author and the streamer, not other people
        bob_c = first.get_json()["comment"]["id"]
        self.signup(self.anon, "carol")
        self.assertEqual(post(self.anon, f"{comments}/{bob_c}/delete").status_code, 403)
        mine = self.bob.get(comments).get_json()["comments"]
        self.assertTrue(any(c["is_mine"] and c["can_delete"] for c in mine))
        self.assertEqual(post(self.alice, f"{comments}/{bob_c}/delete").status_code, 200)
        self.assertEqual(post(self.alice, f"{comments}/{bob_c}/delete").status_code, 404)

        # the channel's rules apply: blocked words and bans
        db = sqlite3.connect(config.DB_PATH)
        alice_id = db.execute("SELECT id FROM users WHERE username = 'alice'").fetchone()[0]
        db.execute("INSERT INTO chat_settings (channel_id, banned_words) VALUES (?, 'spoiler') "
                   "ON CONFLICT(channel_id) DO UPDATE SET banned_words = 'spoiler'", (alice_id,))
        db.commit()
        db.close()
        self.assertEqual(post(self.bob, comments, {"text": "no SPOILER please"}).status_code, 400)
        post(self.alice, "/api/mod/alice/ban", {"user": "bob", "minutes": 0})
        self.assertEqual(post(self.bob, comments, {"text": "hello"}).status_code, 403)

        # deleting the video removes its likes and comments
        post(self.alice, f"/api/vod/{vid}/delete")
        con = sqlite3.connect(config.DB_PATH)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM vod_likes").fetchone()[0], 0)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM vod_comments").fetchone()[0], 0)
        con.close()

    def _published_video(self, owner="alice"):
        """A published video of `owner`, ready for likes and comments."""
        octet = {"content_type": "application/octet-stream"}
        client = {"alice": self.alice, "bob": self.bob}[owner]
        post(client, "/api/stream/start", {"title": "Live", "category": "Music"})
        vid = post(client, "/api/vod/start", {"mime": "video/webm"}).get_json()["id"]
        client.post(f"/api/vod/{vid}/chunk?seq=0", data=b"AAAA", **octet)
        post(client, f"/api/vod/{vid}/finish")
        post(client, f"/api/vod/{vid}/publish", {"cover": JPEG})
        return vid

    def test_comment_likes_and_replies(self):
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")
        self.signup(self.anon, "carol")
        carol = self.anon
        vid = self._published_video()
        base = f"/api/vod/{vid}/comments"
        guest = app.test_client()

        top = post(self.bob, base, {"text": "first!"}).get_json()["comment"]
        self.assertEqual((top["parent"], top["reply_to"], top["likes"], top["liked"], top["reply_count"]), (None, None, 0, False, 0))

        # liking a comment: accounts only, idempotent, per person, shown per viewer
        like = f"{base}/{top['id']}/like"
        self.assertEqual(post(guest, like, {"liked": True}).status_code, 401)
        self.assertEqual(post(self.alice, like, {"liked": "yes"}).status_code, 400)
        self.assertEqual(post(self.alice, f"{base}/9999/like", {"liked": True}).status_code, 404)
        self.assertEqual(post(self.alice, like, {"liked": True}).get_json()["likes"], 1)
        self.assertEqual(post(self.alice, like, {"liked": True}).get_json()["likes"], 1)
        self.assertEqual(post(carol, like, {"liked": True}).get_json()["likes"], 2)
        mine = self.alice.get(base).get_json()["comments"][0]
        self.assertEqual((mine["likes"], mine["liked"]), (2, True))
        seen = guest.get(base).get_json()["comments"][0]
        self.assertEqual((seen["likes"], seen["liked"]), (2, False))
        self.assertEqual(post(carol, like, {"liked": False}).get_json()["likes"], 1)

        # replying: the streamer answers bob, bob answers the answer, carol answers bob's reply
        r1 = post(self.alice, base, {"text": "thanks bob", "parent": top["id"]})
        self.assertEqual(r1.status_code, 201)
        r1 = r1.get_json()["comment"]
        self.assertEqual((r1["parent"], r1["reply_to"]), (top["id"], "bob"))
        r2 = post(self.bob, base, {"text": "@alice anytime", "parent": r1["id"]}).get_json()["comment"]
        self.assertEqual((r2["parent"], r2["reply_to"]), (top["id"], "alice"))  # flat: attached to the top comment
        r3 = post(carol, base, {"text": "@bob agreed", "parent": r2["id"]}).get_json()
        self.assertEqual((r3["comment"]["parent"], r3["comment"]["reply_to"], r3["total"]), (top["id"], "bob", 4))
        self.assertEqual(post(self.bob, base, {"text": "x", "parent": 99999}).status_code, 404)
        self.assertEqual(post(self.bob, base, {"text": "x", "parent": "abc"}).status_code, 404)

        # the list only has top-level comments (with their reply count); the replies come per comment, oldest first
        listed = guest.get(base).get_json()
        self.assertEqual(([c["id"] for c in listed["comments"]], listed["total"]), ([top["id"]], 4))
        self.assertEqual(listed["comments"][0]["reply_count"], 3)
        self.assertEqual(self.anon.get(f"/api/vod/{vid}").get_json()["video"]["comment_count"], 4)
        replies = guest.get(f"{base}/{top['id']}/replies").get_json()
        self.assertEqual([c["text"] for c in replies["comments"]], ["thanks bob", "@alice anytime", "@bob agreed"])
        self.assertFalse(replies["more"])
        after = guest.get(f"{base}/{top['id']}/replies?after={r1['id']}").get_json()
        self.assertEqual([c["text"] for c in after["comments"]], ["@alice anytime", "@bob agreed"])
        self.assertEqual(post(self.bob, f"{base}/{r1['id']}/like", {"liked": True}).get_json()["likes"], 1)  # replies can be liked too

        # notifications: the one answered is told (once), the streamer hears about the rest as comments
        def inbox(client):
            return [(n["kind"], n["actor"]) for n in client.get("/api/notifications").get_json()["notifications"]]
        self.assertIn(("reply", "alice"), inbox(self.bob))
        self.assertIn(("reply", "bob"), inbox(self.alice))
        self.assertEqual(inbox(self.alice).count(("comment", "carol")), 1)  # carol answered bob, alice owns the video
        self.assertNotIn(("comment", "alice"), inbox(self.alice))
        self.assertEqual(inbox(carol).count(("reply", "alice")), 0)

        # deleting: a reply goes alone, a top-level comment takes its replies (and their likes) with it
        self.assertEqual(post(carol, f"{base}/{r1['id']}/delete").status_code, 403)
        self.assertEqual(post(self.alice, f"{base}/{r1['id']}/delete").get_json()["total"], 3)
        self.assertEqual(post(self.bob, f"{base}/{top['id']}/delete").get_json()["total"], 0)
        con = sqlite3.connect(config.DB_PATH)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM vod_comments").fetchone()[0], 0)
        con.close()
        self.assertEqual(post(self.alice, f"{base}/{top['id']}/like", {"liked": True}).status_code, 404)

        # the channel's rules apply to replies too
        top = post(self.bob, base, {"text": "again"}).get_json()["comment"]
        post(self.alice, "/api/mod/alice/ban", {"user": "carol", "minutes": 0})
        self.assertEqual(post(carol, base, {"text": "hi", "parent": top["id"]}).status_code, 403)

        # deleting the video removes every like and reply
        post(self.alice, f"{base}/{top['id']}/like", {"liked": True})
        post(self.bob, base, {"text": "reply", "parent": top["id"]})
        post(self.alice, f"/api/vod/{vid}/delete")
        con = sqlite3.connect(config.DB_PATH)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM vod_comments").fetchone()[0], 0)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM vod_comment_likes").fetchone()[0], 0)
        con.close()

    def test_clips_publish_and_editor_upload(self):
        import base64
        octet = {"content_type": "application/octet-stream"}
        jpeg = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff" + b"x" * 300).decode()
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")

        # the editor exports through its own upload: it needs an account, a known format and doesn't need a live stream
        self.assertEqual(post(self.anon, "/api/vod/new", {"mime": "video/webm"}).status_code, 401)
        self.assertEqual(post(self.alice, "/api/vod/new", {"mime": "video/x-flv"}).status_code, 400)
        self.assertEqual(post(self.alice, "/api/vod/new", {"mime": "video/webm"}).status_code, 400)  # an export needs a saved project
        src = self.live_vod(self.alice)
        pid = self.project(self.alice, [{"a": f"vod:{src}", "in": 0, "out": 100}])
        vid = post(self.alice, "/api/vod/new", {"mime": "video/webm;codecs=vp8,opus", "title": "My edit", "project_id": pid}).get_json()["id"]
        url = f"/api/vod/{vid}/chunk"
        self.assertEqual(self.alice.post(url + "?seq=0", data=b"EDIT", **octet).status_code, 200)
        self.assertEqual(self.bob.post(url + "?seq=1", data=b"X", **octet).status_code, 404)

        # finishing: the editor says how long it is and gives a cover; the result is a private clip
        r = post(self.alice, f"/api/vod/{vid}/finish", {"duration": 93.4, "cover": jpeg}).get_json()
        v = r["video"]
        self.assertEqual((v["title"], v["source"], v["visibility"], v["category"], v["live_pct"]), ("My edit", "edit", "private", "Other", 100))
        self.assertEqual(v["duration"], 93)
        self.assertIsNotNone(v["cover"])
        self.assertEqual(self.alice.get(f"/api/vod/{vid}/cover").status_code, 200)
        self.assertEqual(self.bob.get(f"/api/vod/{vid}/video").status_code, 404)
        self.assertEqual(self.anon.get("/api/channel/alice/videos").get_json()["videos"], [])
        # a live recording ignores a duration or a cover sent at the end: only exports may set them
        post(self.alice, "/api/stream/start", {"title": "Live", "category": "Talk"})
        live = post(self.alice, "/api/vod/start", {"mime": "video/webm"}).get_json()["id"]
        self.alice.post(f"/api/vod/{live}/chunk?seq=0", data=b"LIVE", **octet)
        lv = post(self.alice, f"/api/vod/{live}/finish", {"duration": 5000, "cover": jpeg}).get_json()["video"]
        self.assertLess(lv["duration"], 60)
        self.assertEqual(lv["source"], "live")

        # a bad duration is just ignored
        bad = post(self.alice, "/api/vod/new", {"mime": "video/webm", "project_id": pid}).get_json()["id"]
        self.alice.post(f"/api/vod/{bad}/chunk?seq=0", data=b"BAD", **octet)
        self.assertGreaterEqual(post(self.alice, f"/api/vod/{bad}/finish", {"duration": "soon"}).get_json()["video"]["duration"], 0)

        # an export that sent nothing disappears
        nothing = post(self.alice, "/api/vod/new", {"mime": "video/webm", "project_id": pid}).get_json()["id"]
        self.assertFalse(post(self.alice, f"/api/vod/{nothing}/finish", {"duration": 3}).get_json()["saved"])

        # the saved-videos limit covers clips too
        old_cap = config.VOD_MAX_PER_USER
        config.VOD_MAX_PER_USER = 1
        try:
            r = post(self.alice, "/api/vod/new", {"mime": "video/webm", "project_id": pid})
            self.assertEqual((r.status_code, r.get_json()["limit"]), (409, True))
        finally:
            config.VOD_MAX_PER_USER = old_cap

        # publish, then take it back to a clip: comments and likes are kept but nobody can reach them meanwhile
        pub = post(self.alice, f"/api/vod/{vid}/publish", {"title": "Final cut", "cover": JPEG}).get_json()["video"]
        self.assertEqual((pub["visibility"], pub["title"]), ("public", "Final cut"))
        self.assertEqual(post(self.alice, f"/api/vod/{vid}/publish", {"cover": JPEG}).status_code, 200)  # again: harmless
        self.assertEqual([x["id"] for x in self.anon.get("/api/channel/alice/videos").get_json()["videos"]], [vid])
        self.assertEqual(post(self.bob, f"/api/vod/{vid}/comments", {"text": "nice"}).status_code, 201)
        self.assertEqual(post(self.bob, f"/api/vod/{vid}/unpublish").status_code, 404)
        self.assertEqual(post(self.alice, f"/api/vod/{vid}/unpublish").get_json()["video"]["visibility"], "private")
        self.assertEqual(self.anon.get("/api/channel/alice/videos").get_json()["videos"], [])
        self.assertEqual(post(self.bob, f"/api/vod/{vid}/comments", {"text": "still there?"}).status_code, 404)
        post(self.alice, f"/api/vod/{vid}/publish", {"cover": JPEG})
        self.assertEqual(self.anon.get(f"/api/vod/{vid}/comments").get_json()["total"], 1)
        # published: the one change applies again
        self.assertEqual(post(self.alice, f"/api/vod/{vid}/edit", {"title": "Final cut 2"}).status_code, 200)
        self.assertEqual(post(self.alice, f"/api/vod/{vid}/edit", {"title": "Final cut 3"}).status_code, 403)

    def test_projects_save_and_continue(self):
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")
        src = self.live_vod(self.alice)
        clip = {"a": f"vod:{src}", "in": 2, "out": 12, "speed": 2, "filter": "sepia", "zoom": 99, "rot": 1}
        self.assertEqual(post(self.anon, "/api/projects", {"data": {"clips": []}}).status_code, 401)
        self.assertEqual(post(self.alice, "/api/projects", {"data": "nope"}).status_code, 400)
        pid = self.project(self.alice, [clip, {"a": "http://evil/x.mp4", "in": 0, "out": 5}, {"a": f"vod:{src}", "in": 3, "out": 3}],
                           texts=[{"text": "hi", "start": 1, "dur": 2, "font": "Comic", "color": "red", "size": 9999}])
        got = self.alice.get(f"/api/projects/{pid}").get_json()
        d = got["data"]
        self.assertEqual(len(d["clips"]), 1)                                   # a link to anywhere and an empty cut are dropped
        self.assertEqual((d["clips"][0]["zoom"], d["clips"][0]["filter"], d["clips"][0]["speed"]), (4, "sepia", 2))  # numbers are clamped
        self.assertEqual((d["texts"][0]["font"], d["texts"][0]["color"], d["texts"][0]["size"]), ("Fredoka", "#ffffff", 60))
        self.assertEqual((got["project"]["duration"], got["project"]["live_pct"], got["project"]["cover_vod"]), (5.0, 100, src))
        # only mine
        self.assertEqual(self.bob.get(f"/api/projects/{pid}").status_code, 404)
        self.assertEqual(post(self.bob, "/api/projects", {"id": pid, "data": d}).status_code, 404)
        self.assertEqual(post(self.bob, f"/api/projects/{pid}/delete").status_code, 404)
        # saving again with the id updates it (same project, new title)
        r = post(self.alice, "/api/projects", {"id": pid, "title": "Second", "data": d}).get_json()["project"]
        self.assertEqual((r["id"], r["title"]), (pid, "Second"))
        self.assertEqual([p["id"] for p in self.alice.get("/api/me/projects").get_json()["projects"]], [pid])
        self.assertEqual(self.bob.get("/api/me/projects").get_json()["projects"], [])
        # the limit
        old = config.EDIT_MAX_PROJECTS
        config.EDIT_MAX_PROJECTS = 1
        try:
            r = post(self.alice, "/api/projects", {"data": d})
            self.assertEqual((r.status_code, r.get_json()["limit"]), (409, True))
        finally:
            config.EDIT_MAX_PROJECTS = old
        self.assertEqual(post(self.alice, f"/api/projects/{pid}/delete").status_code, 200)
        self.assertEqual(self.alice.get(f"/api/projects/{pid}").status_code, 404)

    def test_edit_needs_mostly_live_footage(self):
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")
        live = self.live_vod(self.alice)
        # footage from the device is not saved in a project: it only counts as time that is not live
        mixed = lambda file_s: self.project(self.alice, [{"a": f"vod:{live}", "in": 0, "out": 10}, {"a": "file:me.mp4:1:1", "in": 0, "out": file_s}])
        new = lambda pid: post(self.alice, "/api/vod/new", {"mime": "video/webm", "project_id": pid})
        self.assertEqual(new(mixed(4)).status_code, 200)                       # 10 of 14 s = 71%
        r = new(mixed(5))                                                       # 10 of 15 s = 66%
        self.assertEqual((r.status_code, r.get_json()["live_pct"], r.get_json()["field"]), (400, 66, "live"))
        self.assertEqual(new(self.project(self.alice, [{"a": "file:me.mp4:1:1", "in": 0, "out": 9}])).status_code, 400)  # no live at all
        # speed changes the length that counts, not just the cut
        self.assertEqual(new(self.project(self.alice, [{"a": f"vod:{live}", "in": 0, "out": 10}, {"a": "file:x:1:1", "in": 0, "out": 8, "speed": 2}])).status_code, 200)  # 10 s of live + 8 s at 2x = 4 s: 71%
        # somebody else's live recording doesn't count as mine
        theirs = self.live_vod(self.bob)
        pid = self.project(self.alice, [{"a": f"vod:{theirs}", "in": 0, "out": 10}])
        self.assertEqual(new(pid).status_code, 400)
        # a project can't be used by someone else, and an export needs one
        self.assertEqual(post(self.bob, "/api/vod/new", {"mime": "video/webm", "project_id": pid}).status_code, 400)
        # an edit of an edit counts for its own live share, so footage can't be laundered through exports
        half = self.project(self.alice, [{"a": f"vod:{live}", "in": 0, "out": 10}, {"a": "file:x:1:1", "in": 0, "out": 8}])  # 10 of 18 s = 55%
        self.assertEqual(new(half).status_code, 400)
        con = sqlite3.connect(config.DB_PATH)
        con.execute("UPDATE vods SET live_pct = 70, source = 'edit' WHERE id = ?", (live,))
        con.commit()
        con.close()
        self.assertEqual(new(self.project(self.alice, [{"a": f"vod:{live}", "in": 0, "out": 10}])).status_code, 200)  # an edit that is 70% live is worth 70%: just enough
        con = sqlite3.connect(config.DB_PATH)
        con.execute("UPDATE vods SET live_pct = 50 WHERE id = ?", (live,))
        con.commit()
        con.close()
        self.assertEqual(new(self.project(self.alice, [{"a": f"vod:{live}", "in": 0, "out": 10}])).status_code, 400)

    def test_publish_needs_cover_and_live_share(self):
        self.signup(self.alice, "alice")
        live = self.live_vod(self.alice)
        con = sqlite3.connect(config.DB_PATH)
        con.execute("UPDATE vods SET cover = NULL WHERE id = ?", (live,))
        con.commit()
        con.close()
        # no cover: it can't go public, either by publishing or by changing who can see it
        r = post(self.alice, f"/api/vod/{live}/publish", {"title": "Hi"})
        self.assertEqual((r.status_code, r.get_json()["field"]), (400, "cover"))
        self.assertEqual(post(self.alice, f"/api/vod/{live}/visibility", {"visibility": "public"}).status_code, 400)
        self.assertEqual(post(self.alice, f"/api/vod/{live}/publish", {"cover": "data:image/png;base64,AAAA"}).status_code, 400)
        r = post(self.alice, f"/api/vod/{live}/publish", {"cover": JPEG, "visibility": "followers", "category": "Music", "title": "Show"}).get_json()["video"]
        self.assertEqual((r["visibility"], r["category"], r["title"]), ("followers", "Music", "Show"))
        self.assertIsNotNone(r["cover"])
        self.assertEqual(post(self.alice, f"/api/vod/{live}/visibility", {"visibility": "public"}).status_code, 200)
        # an edit below the live share can't be published whatever the cover
        ed = self.new_edit(self.alice)
        con = sqlite3.connect(config.DB_PATH)
        con.execute("UPDATE vods SET live_pct = 40 WHERE id = ?", (ed,))
        con.commit()
        con.close()
        r = post(self.alice, f"/api/vod/{ed}/publish", {"cover": JPEG})
        self.assertEqual((r.status_code, r.get_json()["field"]), (400, "live"))
        self.assertEqual(post(self.alice, f"/api/vod/{ed}/visibility", {"visibility": "public"}).status_code, 400)
        # older exports that were never measured keep working
        con = sqlite3.connect(config.DB_PATH)
        con.execute("UPDATE vods SET live_pct = -1 WHERE id = ?", (ed,))
        con.commit()
        con.close()
        self.assertEqual(post(self.alice, f"/api/vod/{ed}/publish", {"cover": JPEG}).status_code, 200)

    def test_recordings_can_not_be_downloaded(self):
        self.signup(self.alice, "alice")
        live = self.live_vod(self.alice)
        url = f"/api/vod/{live}/video"
        ok = lambda **h: self.alice.get(url, headers=h).status_code
        self.assertEqual(ok(), 200)                                                               # a client that sends no hints
        self.assertEqual(ok(**{"Sec-Fetch-Dest": "video", "Sec-Fetch-Site": "same-origin"}), 200)  # the <video> element
        self.assertEqual(ok(**{"Sec-Fetch-Dest": "document", "Sec-Fetch-Site": "none"}), 403)     # opened in a tab / "save link as"
        self.assertEqual(ok(**{"Sec-Fetch-Dest": "empty", "Sec-Fetch-Site": "same-origin"}), 403)  # fetch() copying the bytes
        self.assertEqual(ok(**{"Sec-Fetch-Dest": "video", "Sec-Fetch-Site": "cross-site"}), 403)  # another site embedding it
        r = self.alice.get(url, headers={"Sec-Fetch-Dest": "video", "Sec-Fetch-Site": "same-origin"})
        self.assertEqual(r.headers["Content-Disposition"], "inline")
        r.close()

    def test_old_databases_get_clip_columns(self):
        """A database made before clips and replies keeps its videos published and gets the new columns."""
        import tempfile
        path = Path(tempfile.mkdtemp()) / "old.db"
        con = sqlite3.connect(path)
        con.executescript("""
            CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
            CREATE TABLE vods (id TEXT PRIMARY KEY, user_id INTEGER, title TEXT NOT NULL DEFAULT '', mime TEXT NOT NULL,
                               status TEXT NOT NULL DEFAULT 'recording', started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
            CREATE TABLE vod_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, vod_id TEXT NOT NULL, user_id INTEGER NOT NULL,
                                       text TEXT NOT NULL, created_at INTEGER NOT NULL);
            INSERT INTO vods (id, user_id, mime, status, started_at, updated_at) VALUES ('old', 1, 'video/webm', 'ready', 1, 1);
            INSERT INTO vod_comments (vod_id, user_id, text, created_at) VALUES ('old', 1, 'hi', 1);
        """)
        con.commit()
        con.close()
        from yeli import db as dbmod
        dbmod.init_db(str(path))
        dbmod.init_db(str(path))  # and a second start changes nothing
        con = sqlite3.connect(path)
        self.assertEqual(con.execute("SELECT visibility, source FROM vods WHERE id = 'old'").fetchone(), ("public", "live"))
        self.assertEqual(con.execute("SELECT parent_id, reply_to FROM vod_comments").fetchone(), (None, None))
        self.assertEqual(con.execute("SELECT COUNT(*) FROM vod_comment_likes").fetchone()[0], 0)
        con.close()

    def test_voice_in_the_stream(self):
        import stat
        fake = Path(_tmp) / "fake-espeak"
        fake.write_text("#!/usr/bin/env python3\nimport sys, wave\n"
                        "w = wave.open(sys.stdout.buffer, 'wb')\nw.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)\n"
                        "w.writeframes(b'\\x00\\x01' * 800)\nw.close()\n")
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")
        post(self.alice, "/api/bot/settings", {"tts_enabled": True, "tts_command": "say", "tts_cooldown": 0, "tts_name": False})
        post(self.bob, "/api/chat/alice", {"text": "!say hola"})
        poll = lambda c: c.get("/api/chat/alice?after=0").get_json()
        mid = [m for m in poll(self.anon)["messages"] if m["kind"] == "tts"][0]["id"]
        url = f"/api/tts/alice/{mid}"

        # no speech program on the server: the voice stays in the viewers' browsers
        config.TTS_BIN = ""
        orig_which = __import__("shutil").which
        __import__("shutil").which = lambda name: None
        try:
            self.assertFalse(poll(self.anon)["tts_stream"])
            self.assertEqual(self.alice.get(url).status_code, 409)
            self.assertFalse(self.alice.get("/api/bot").get_json()["voice_engine"])

            # with a program: the poll says so, and only the streamer gets the audio
            config.TTS_BIN = str(fake)
            self.assertTrue(poll(self.anon)["tts_stream"])
            self.assertTrue(self.alice.get("/api/bot").get_json()["voice_engine"])
            self.assertEqual(self.anon.get(url).status_code, 401)
            self.assertEqual(self.bob.get(url).status_code, 403)
            r = self.alice.get(url)
            self.assertEqual((r.status_code, r.mimetype), (200, "audio/wav"))
            self.assertEqual(r.data[:4], b"RIFF")
            self.assertEqual(self.alice.get(url).data, r.data)  # cached
            normal = [m for m in poll(self.anon)["messages"] if m["kind"] == "msg"][0]["id"]
            self.assertEqual(self.alice.get(f"/api/tts/alice/{normal}").status_code, 404)  # only voice messages
            self.assertEqual(self.alice.get("/api/tts/alice/99999").status_code, 404)

            # "viewers" puts the voice back in each browser
            self.assertEqual(post(self.alice, "/api/bot/settings", {"tts_enabled": True, "tts_output": "nowhere"}).status_code, 400)
            post(self.alice, "/api/bot/settings", {"tts_enabled": True, "tts_command": "say", "tts_output": "viewers"})
            self.assertFalse(poll(self.anon)["tts_stream"])
            self.assertEqual(self.alice.get(url).status_code, 409)
        finally:
            __import__("shutil").which = orig_which
            config.TTS_BIN = ""

    def test_send_the_stream_to_other_platforms(self):
        import stat
        from yeli import restream
        log = Path(_tmp) / "ffmpeg-calls.txt"
        log.unlink(missing_ok=True)
        fake = Path(_tmp) / "fake-ffmpeg"
        fake.write_text(f"#!/usr/bin/env python3\nimport sys, time\nopen({str(log)!r}, 'a').write(' '.join(sys.argv[1:]) + '\\n')\n"
                        "first = len(open(" + repr(str(log)) + ").read().splitlines()) == 1\n"
                        "if first:\n    sys.stderr.write('Connection to rtmp://live.twitch.tv/app/live_secret_key failed\\n'); sys.stderr.flush(); time.sleep(0.3); sys.exit(1)\n"
                        "time.sleep(60)\n")
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
        saved = (config.FFMPEG_BIN, config.MEDIA_URL, config.MEDIA_RTSP)
        config.FFMPEG_BIN, config.MEDIA_URL, config.MEDIA_RTSP = str(fake), "http://media.test:8889", "rtsp://127.0.0.1:8554"
        status = lambda c: [d["status"] for d in c.get("/api/restream").get_json()["destinations"]]
        wait_for = lambda cond: next((True for _ in range(60) if cond() or time.sleep(0.1)), False)
        try:
            self.signup(self.alice, "alice")
            self.signup(self.bob, "bob")
            state = self.alice.get("/api/restream").get_json()
            self.assertTrue(state["available"])
            self.assertIn("twitch", [p["id"] for p in state["platforms"]])

            good = {"platform": "twitch", "name": "My Twitch", "url": "rtmp://live.twitch.tv/app", "key": "live_secret_key"}
            for bad in ({**good, "platform": "nope"}, {**good, "url": "http://example.com/x"}, {**good, "url": "rtmp://a b/x"},
                        {**good, "key": ""}, {**good, "key": "a b"}, {**good, "key": "x;rm -rf"}, {**good, "fmt": "wide"}):
                self.assertEqual(post(self.alice, "/api/restream", bad).status_code, 400, bad)
            self.assertEqual(post(self.anon, "/api/restream", good).status_code, 401)
            created = post(self.alice, "/api/restream", good)
            self.assertEqual(created.status_code, 201)
            dest = created.get_json()["destination"]
            self.assertNotIn("live_secret_key", created.get_data(as_text=True))     # the key never goes back to the browser
            self.assertNotIn("live_secret_key", self.alice.get("/api/restream").get_data(as_text=True))
            self.assertTrue(dest["key_hint"].endswith("_key"))
            self.assertEqual(status(self.alice), ["off"])                            # not live yet: nothing runs

            # peer-to-peer: there is no server-side video to send
            post(self.alice, "/api/stream/start", {"title": "p2p", "category": "Music", "mode": "p2p"})
            self.assertEqual(status(self.alice), ["off"])
            post(self.alice, "/api/stream/stop")

            # media-server mode: ffmpeg starts, reads the stream from the media server and writes to the platform
            post(self.alice, "/api/stream/start", {"title": "sfu", "category": "Music", "mode": "sfu"})
            self.assertTrue(wait_for(lambda: log.exists() and status(self.alice) != ["off"]))
            call = log.read_text().splitlines()[0]
            self.assertIn("rtsp://127.0.0.1:8554/alice", call)
            self.assertIn("rtmp://live.twitch.tv/app/live_secret_key", call)
            self.assertIn("libx264", call)
            self.assertNotIn("crop=", call)
            # errors never reveal the key
            self.assertTrue(wait_for(lambda: self.alice.get("/api/restream").get_json()["destinations"][0]["status"] == "retrying"))
            shown = self.alice.get("/api/restream").get_data(as_text=True)
            self.assertNotIn("live_secret_key", shown)

            # a second stream key, vertical for TikTok; others can't touch it
            tk = post(self.alice, "/api/restream", {"platform": "tiktok", "url": "rtmp://push.tiktokcdn.com/live/", "key": "abc123?x=1", "fmt": "vertical"}).get_json()["destination"]
            self.assertTrue(wait_for(lambda: "crop=" in log.read_text() and "9/16" in log.read_text()))
            self.assertEqual(post(self.bob, f"/api/restream/{tk['id']}", {"enabled": False}).status_code, 404)
            self.assertEqual(post(self.bob, f"/api/restream/{tk['id']}/delete").status_code, 404)

            # switching one off stops only it; editing needs no key again; deleting stops it
            off = post(self.alice, f"/api/restream/{dest['id']}", {"enabled": False}).get_json()["destination"]
            self.assertEqual((off["enabled"], off["status"]), (False, "off"))
            self.assertEqual(post(self.alice, f"/api/restream/{tk['id']}", {"name": "Mi TikTok"}).get_json()["destination"]["name"], "Mi TikTok")
            self.assertEqual(post(self.alice, f"/api/restream/{tk['id']}/delete").status_code, 200)
            self.assertEqual([d["id"] for d in self.alice.get("/api/restream").get_json()["destinations"]], [dest["id"]])

            # going offline stops everything
            post(self.alice, f"/api/restream/{dest['id']}", {"enabled": True})
            self.assertTrue(wait_for(lambda: status(self.alice) != ["off"]))
            post(self.alice, "/api/stream/stop")
            self.assertEqual(status(self.alice), ["off"])
        finally:
            restream.stop_all()
            config.FFMPEG_BIN, config.MEDIA_URL, config.MEDIA_RTSP = saved

        # without ffmpeg or a media server the feature says so
        self.assertEqual(self.alice.get("/api/restream").get_json()["why"], "media_server")

    def test_chats_from_other_platforms(self):
        import socket as _socket
        import threading as _threading
        from yeli import bridge
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")
        info = self.alice.get("/api/bridge").get_json()
        hook = "/api/bridge/" + info["token"]
        self.assertTrue(info["url"].endswith(hook))
        self.assertEqual(self.anon.get("/api/bridge").status_code, 401)
        self.assertEqual(post(self.anon, "/api/bridge/not-a-token", {"platform": "kick", "user": "x", "text": "hi"}).status_code, 404)
        poll = lambda: self.anon.get("/api/chat/alice?after=0").get_json()["messages"]

        # a message from TikTok shows with its tag, as nobody's account
        r = post(self.anon, hook, {"platform": "TikTok", "user": "  ana<b>  ", "text": "hola   a todos"})
        self.assertEqual((r.status_code, r.get_json()["ok"]), (200, True))
        m = poll()[-1]
        self.assertEqual((m["platform"], m["user"], m["text"], m["kind"]), ("tiktok", "anab", "hola a todos", "msg"))
        self.assertEqual((m["owner"], m["mod"], m["badge"], m["color"]), (False, False, 0, ""))
        self.assertEqual(post(self.anon, hook, {"user": "x", "text": "   "}).status_code, 202)   # empty: dropped
        self.assertEqual(poll()[-1]["platform"], "tiktok")

        # the bot answers commands, in the chat and in the webhook's reply
        r = post(self.anon, hook, {"platform": "kick", "user": "luis", "text": "!dice 6"}).get_json()
        self.assertIn("luis rolled", r["reply"])
        self.assertEqual(poll()[-1]["kind"], "bot")
        post(self.alice, "/api/bot/commands", {"name": "hola", "response": "Hola {user}, bienvenido a {channel}", "perm": "everyone", "cooldown": 0})
        self.assertEqual(post(self.anon, hook, {"platform": "kick", "user": "luis", "text": "!hola"}).get_json()["reply"], "Hola luis, bienvenido a alice")
        self.assertEqual(post(self.anon, hook, {"platform": "kick", "user": "luis", "text": "!so alice"}).get_json()["reply"], "")  # owner-only commands stay owner-only

        # the voice: a message to read aloud, tagged with where it came from
        post(self.alice, "/api/bot/settings", {"tts_enabled": True, "tts_command": "say", "tts_perm": "everyone", "tts_name": True,
                                                "tts_template": "{user} dice: {text}", "tts_cooldown": 0})
        post(self.anon, hook, {"platform": "tiktok", "user": "ana", "text": "!say buenas noches"})
        tts = [x for x in poll() if x["kind"] == "tts"][-1]
        self.assertEqual((tts["text"], tts["platform"], tts["user"]), ("ana dice: buenas noches", "tiktok", "ana"))

        # the chat rules apply; the streamer can remove these messages like any other
        db = sqlite3.connect(config.DB_PATH)
        alice_id = db.execute("SELECT id FROM users WHERE username = 'alice'").fetchone()[0]
        db.execute("INSERT INTO chat_settings (channel_id, banned_words) VALUES (?, 'spoiler') ON CONFLICT(channel_id) DO UPDATE SET banned_words = 'spoiler'", (alice_id,))
        db.commit(); db.close()
        self.assertEqual(post(self.anon, hook, {"platform": "kick", "user": "luis", "text": "SPOILER!"}).status_code, 202)
        gone = poll()[-1]["id"]
        self.assertEqual(post(self.alice, "/api/chat/alice/delete", {"id": gone}).status_code, 200)
        self.assertNotIn(gone, [x["id"] for x in poll()])

        # a new link makes the old one stop working
        new = post(self.alice, "/api/bridge/token/reset").get_json()
        self.assertNotEqual(new["token"], info["token"])
        self.assertEqual(post(self.anon, hook, {"platform": "kick", "user": "luis", "text": "hi"}).status_code, 404)

        # Twitch is read directly: an anonymous IRC connection while the streamer is live
        lines = []
        server = _socket.socket(); server.bind(("127.0.0.1", 0)); server.listen(1)
        def fake_twitch():
            conn, _ = server.accept()
            conn.settimeout(10)
            seen = b""
            while b"JOIN" not in seen:
                seen += conn.recv(1024)
            lines.extend(seen.decode().split("\r\n"))
            conn.sendall(b":tmi.twitch.tv 001 justinfan1 :Welcome\r\nPING :tmi.twitch.tv\r\n")
            conn.sendall(b":gamer99!gamer99@gamer99.tmi.twitch.tv PRIVMSG #somechannel :hello from twitch\r\n")
            conn.sendall(b":gamer99!gamer99@gamer99.tmi.twitch.tv PRIVMSG #somechannel :\x01ACTION waves\x01\r\n")
            try:
                lines.append(conn.recv(100).decode())  # the PONG
            except OSError:
                pass
            time.sleep(3)
            conn.close()
        _threading.Thread(target=fake_twitch, daemon=True).start()
        saved = (config.TWITCH_IRC, config.TWITCH_TLS)
        config.TWITCH_IRC, config.TWITCH_TLS = f"127.0.0.1:{server.getsockname()[1]}", False
        try:
            self.assertEqual(post(self.alice, "/api/bridge/twitch", {"channel": "bad name!", "enabled": True}).status_code, 400)
            self.assertEqual(post(self.alice, "/api/bridge/twitch", {"channel": "", "enabled": True}).status_code, 400)
            post(self.alice, "/api/stream/start", {"title": "x", "category": "Music"})
            self.assertEqual(post(self.alice, "/api/bridge/twitch", {"channel": "https://www.twitch.tv/SomeChannel", "enabled": True}).get_json()["twitch"]["channel"], "somechannel")
            for _ in range(60):
                got = [x for x in poll() if x["platform"] == "twitch"]
                if len(got) >= 2:
                    break
                time.sleep(0.1)
            self.assertEqual([(x["user"], x["text"]) for x in got], [("gamer99", "hello from twitch"), ("gamer99", "waves")])
            self.assertTrue(any(l.startswith("NICK justinfan") for l in lines))
            self.assertTrue(any(l == "JOIN #somechannel" for l in lines))
            self.assertEqual(self.alice.get("/api/bridge").get_json()["twitch"]["status"], "connected")
            self.assertTrue(any("PONG" in l for l in lines))
            post(self.alice, "/api/stream/stop")                                     # offline: the reader stops
            self.assertEqual(self.alice.get("/api/bridge").get_json()["twitch"]["status"], "off")
        finally:
            bridge.stop_all()
            config.TWITCH_IRC, config.TWITCH_TLS = saved
            server.close()

    def test_saved_streams(self):
        import base64
        jpeg = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff" + b"x" * 500).decode()
        jpeg2 = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff" + b"y" * 300).decode()
        octet = {"content_type": "application/octet-stream"}
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")

        # needs a live stream and a known format
        self.assertEqual(post(self.alice, "/api/vod/start", {"mime": "video/webm"}).status_code, 409)
        post(self.alice, "/api/stream/start", {"title": "My first live", "category": "Music"})
        self.assertEqual(post(self.alice, "/api/vod/start", {"mime": "video/x-flv"}).status_code, 400)
        self.assertEqual(post(self.anon, "/api/vod/start", {"mime": "video/webm"}).status_code, 401)
        vid = post(self.alice, "/api/vod/start", {"mime": "video/webm;codecs=vp8,opus"}).get_json()["id"]

        # upload pieces: in order, repeated ones are ignored, gaps are refused, only the owner and only binary
        url = f"/api/vod/{vid}/chunk"
        self.assertEqual(self.alice.post(url + "?seq=0", data=b"AAAA", **octet).status_code, 200)
        self.assertTrue(self.alice.post(url + "?seq=0", data=b"AAAA", **octet).get_json()["dup"])
        self.assertEqual(self.alice.post(url + "?seq=2", data=b"CC", **octet).status_code, 409)
        self.assertEqual(self.alice.post(url + "?seq=1", data=b"BBBB", **octet).status_code, 200)
        self.assertEqual(self.alice.post(url + "?seq=2", json={"a": 1}).status_code, 415)
        self.assertEqual(self.bob.post(url + "?seq=2", data=b"X", **octet).status_code, 404)
        self.assertEqual(self.anon.post(url + "?seq=2", data=b"X", **octet).status_code, 401)
        # a big piece is fine here (8 MB), while normal JSON routes keep the 128 KB limit
        self.assertEqual(self.alice.post(url + "?seq=2", data=b"Z" * (2 * 1024 * 1024), **octet).status_code, 200)
        self.assertEqual(post(self.alice, "/api/me/profile", {"bio": "x" * 200000}).status_code, 413)

        # while recording: not public, can't be edited, the cover follows the live snapshots
        self.assertEqual(self.anon.get(f"/api/vod/{vid}").status_code, 404)
        self.assertEqual(self.anon.get(f"/api/channel/alice/videos").get_json()["videos"], [])
        self.assertEqual(post(self.alice, f"/api/vod/{vid}/edit", {"title": "x"}).status_code, 409)
        post(self.alice, "/api/stream/thumbnail", {"image": jpeg})

        # end of the stream: the recording is kept as a PRIVATE clip, it is not published
        r = post(self.alice, f"/api/vod/{vid}/finish").get_json()
        self.assertTrue(r["saved"])
        v = r["video"]
        self.assertEqual((v["title"], v["category"], v["status"]), ("My first live", "Music", "ready"))
        self.assertEqual((v["visibility"], v["is_clip"], v["source"]), ("private", True, "live"))
        self.assertTrue(v["can_edit"])
        self.assertIsNotNone(v["cover"])
        self.assertEqual(self.anon.get("/api/channel/alice/videos").get_json()["videos"], [])
        self.assertEqual(self.alice.get("/api/channel/alice/videos").get_json()["videos"], [])  # not even on her own channel
        for who in (self.anon, self.bob):
            for tail in ("", "/video", "/cover"):
                self.assertEqual(who.get(f"/api/vod/{vid}{tail}").status_code, 404, tail)
        self.assertEqual(self.alice.get(f"/api/vod/{vid}/video").status_code, 200)
        self.assertEqual(self.alice.get(f"/api/vod/{vid}/cover").status_code, 200)
        self.assertEqual([x["id"] for x in self.alice.get("/api/me/videos").get_json()["videos"]], [vid])
        self.assertEqual(self.anon.get("/api/me/videos").status_code, 401)
        self.assertEqual(self.bob.get("/api/me/videos").get_json()["videos"], [])

        # a clip can be changed as often as wanted: it never uses up the one change
        for title in ("Draft", "My first live"):
            r = post(self.alice, f"/api/vod/{vid}/edit", {"title": title})
            self.assertEqual((r.status_code, r.get_json()["video"]["edited"], r.get_json()["video"]["can_edit"]), (200, False, True))
        self.assertEqual(post(self.alice, f"/api/vod/{vid}/edit", {"title": "My first live"}).status_code, 400)  # nothing changed

        # publishing: only the owner, a title is required, then it is public
        self.assertEqual(post(self.bob, f"/api/vod/{vid}/publish").status_code, 404)
        self.assertEqual(post(self.anon, f"/api/vod/{vid}/publish").status_code, 401)
        self.assertEqual(post(self.alice, f"/api/vod/{vid}/publish", {"title": " ", "cover": JPEG}).status_code, 400)
        r = post(self.alice, f"/api/vod/{vid}/publish", {"description": "Hello", "cover": JPEG}).get_json()["video"]
        self.assertEqual((r["visibility"], r["description"], r["can_edit"]), ("public", "Hello", True))
        self.assertFalse(r["edited"])  # publishing did not use up the one change either
        listed = self.anon.get("/api/channel/alice/videos").get_json()["videos"]
        self.assertEqual([x["id"] for x in listed], [vid])
        self.assertFalse(listed[0]["can_edit"])  # guests can't edit
        self.assertEqual(self.anon.get(f"/api/vod/{vid}/cover").status_code, 200)
        self.assertEqual(post(self.alice, f"/api/vod/{vid}/finish").get_json()["video"]["id"], vid)  # idempotent
        self.assertEqual(self.alice.post(url + "?seq=3", data=b"late", **octet).status_code, 409)

        # the video file can be played and seeked (Range)
        full = self.anon.get(f"/api/vod/{vid}/video")
        self.assertEqual((full.status_code, full.mimetype), (200, "video/webm"))
        self.assertTrue(full.data.startswith(b"AAAABBBB"))
        part = self.anon.get(f"/api/vod/{vid}/video", headers={"Range": "bytes=4-7"})
        self.assertEqual((part.status_code, part.data), (206, b"BBBB"))

        # one change only: title + description + cover together, then it is locked
        self.assertEqual(post(self.bob, f"/api/vod/{vid}/edit", {"title": "hacked"}).status_code, 404)
        self.assertEqual(post(self.anon, f"/api/vod/{vid}/edit", {"title": "hacked"}).status_code, 401)
        self.assertEqual(post(self.alice, f"/api/vod/{vid}/edit", {"title": "  "}).status_code, 400)
        self.assertEqual(post(self.alice, f"/api/vod/{vid}/edit", {"cover": "data:image/png;base64,AAAA"}).status_code, 400)
        self.assertEqual(post(self.alice, f"/api/vod/{vid}/edit", {"title": "My first live"}).status_code, 400)  # nothing changed: not used up
        self.assertTrue(self.alice.get(f"/api/channel/alice/videos").get_json()["videos"][0]["can_edit"])
        old = self.anon.get(f"/api/vod/{vid}/cover").data
        r = post(self.alice, f"/api/vod/{vid}/edit", {"title": "Renamed", "description": "All about it", "cover": jpeg2})
        self.assertEqual(r.status_code, 200, r.get_json())
        v = r.get_json()["video"]
        self.assertEqual((v["title"], v["description"], v["can_edit"], v["edited"]), ("Renamed", "All about it", False, True))
        self.assertNotEqual(self.anon.get(f"/api/vod/{vid}/cover").data, old)
        for body in ({"title": "Again"}, {"description": "Again"}, {"cover": jpeg}):
            r = post(self.alice, f"/api/vod/{vid}/edit", body)
            self.assertEqual(r.status_code, 403)
        self.assertEqual(self.anon.get(f"/api/vod/{vid}").get_json()["video"]["title"], "Renamed")

        # a recording with nothing in it disappears; a closed browser keeps what arrived
        post(self.alice, "/api/stream/start", {"title": "Second", "category": "Talk"})
        empty = post(self.alice, "/api/vod/start", {"mime": "video/mp4"}).get_json()["id"]
        self.assertFalse(post(self.alice, f"/api/vod/{empty}/finish").get_json()["saved"])
        self.assertEqual(self.anon.get(f"/api/vod/{empty}").status_code, 404)
        gone = post(self.alice, "/api/vod/start", {"mime": "video/mp4"}).get_json()["id"]
        self.alice.post(f"/api/vod/{gone}/chunk?seq=0", data=b"1234", **octet)
        con = sqlite3.connect(config.DB_PATH)
        con.execute("UPDATE vods SET updated_at = updated_at - 1000, started_at = started_at - 1060 WHERE id = ?", (gone,))
        con.commit()
        con.close()
        ids = [x["id"] for x in self.alice.get("/api/me/videos").get_json()["videos"]]
        self.assertIn(gone, ids)
        self.assertGreater(self.alice.get(f"/api/vod/{gone}").get_json()["video"]["duration"], 0)

        # size limit: the video is kept as it is and the browser is told to stop
        old_max = config.VOD_MAX_BYTES
        config.VOD_MAX_BYTES = 10
        try:
            big = post(self.alice, "/api/vod/start", {"mime": "video/webm"}).get_json()["id"]
            self.assertEqual(self.alice.post(f"/api/vod/{big}/chunk?seq=0", data=b"123456", **octet).status_code, 200)
            r = self.alice.post(f"/api/vod/{big}/chunk?seq=1", data=b"123456", **octet)
            self.assertEqual((r.status_code, r.get_json()["closed"]), (413, True))
            self.assertEqual(self.alice.get(f"/api/vod/{big}").get_json()["video"]["status"], "ready")
        finally:
            config.VOD_MAX_BYTES = old_max

        # per-channel limit and deleting
        old_cap = config.VOD_MAX_PER_USER
        config.VOD_MAX_PER_USER = 1
        try:
            r = post(self.alice, "/api/vod/start", {"mime": "video/webm"})
            self.assertEqual((r.status_code, r.get_json()["limit"]), (409, True))
        finally:
            config.VOD_MAX_PER_USER = old_cap
        self.assertEqual(post(self.bob, f"/api/vod/{vid}/delete").status_code, 404)
        self.assertEqual(post(self.alice, f"/api/vod/{vid}/delete").status_code, 200)
        self.assertEqual(self.anon.get(f"/api/vod/{vid}/video").status_code, 404)
        self.assertNotIn(vid, [x["id"] for x in self.anon.get("/api/channel/alice/videos").get_json()["videos"]])

    # ------------------------------------------------------------------ notifications
    def test_notifications(self):
        from yeli import mailer
        mailer.sent_log.clear()
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")
        self.signup(self.anon, "carol")
        carol = self.anon
        self.assertEqual(app.test_client().get("/api/notifications").status_code, 401)

        # follow: the streamer gets one in the app (and a repeat follow within a day doesn't ring twice)
        post(self.bob, "/api/follow/alice", {"follow": True})
        post(self.bob, "/api/follow/alice", {"follow": False})
        post(self.bob, "/api/follow/alice", {"follow": True})
        r = self.alice.get("/api/notifications").get_json()
        self.assertEqual((r["unread"], [(n["kind"], n["actor"]) for n in r["notifications"]]), (1, [("follow", "bob")]))
        poll = self.alice.get("/api/notifications/poll?after=0").get_json()
        self.assertEqual((poll["unread"], len(poll["notifications"])), (1, 1))
        self.assertEqual(self.alice.get(f"/api/notifications/poll?after={poll['last']}").get_json()["notifications"], [])
        self.assertEqual(self.bob.get("/api/notifications").get_json()["unread"], 0)  # you aren't told about your own actions

        # reading
        nid = r["notifications"][0]["id"]
        self.assertEqual(post(self.bob, "/api/notifications/read", {"ids": [nid]}).get_json()["unread"], 0)
        self.assertEqual(self.alice.get("/api/notifications").get_json()["unread"], 1)  # someone else's id does nothing
        self.assertEqual(post(self.alice, "/api/notifications/read", {"ids": [nid]}).get_json()["unread"], 0)

        # donation
        self.buy(self.bob)
        post(self.bob, "/api/wallet/donate", {"channel": "alice", "coins": 100, "message": "great show"})
        n = self.alice.get("/api/notifications").get_json()["notifications"][0]
        self.assertEqual((n["kind"], n["actor"], n["amount"], n["body"]), ("donation", "bob", 100, "great show"))

        # going live tells followers, once per half hour
        post(self.alice, "/api/stream/start", {"title": "Pasta night", "category": "Cooking"})
        n = self.bob.get("/api/notifications").get_json()["notifications"][0]
        self.assertEqual((n["kind"], n["actor"], n["title"]), ("live", "alice", "Pasta night"))
        post(self.alice, "/api/stream/stop")
        post(self.alice, "/api/stream/start", {"title": "Pasta night 2", "category": "Cooking"})
        self.assertEqual([x["kind"] for x in self.bob.get("/api/notifications").get_json()["notifications"]].count("live"), 1)
        self.assertEqual(self.alice.get("/api/notifications").get_json()["notifications"][0]["kind"], "donation")  # not told about her own stream

        # likes and comments on a video
        vid = post(self.alice, "/api/vod/start", {"mime": "video/webm"}).get_json()["id"]
        self.alice.post(f"/api/vod/{vid}/chunk?seq=0", data=b"AAAA", content_type="application/octet-stream")
        post(self.alice, f"/api/vod/{vid}/finish")
        post(self.alice, f"/api/vod/{vid}/publish", {"cover": JPEG})
        post(self.bob, f"/api/vod/{vid}/like", {"liked": True})
        post(self.bob, f"/api/vod/{vid}/like", {"liked": True})
        post(self.bob, f"/api/vod/{vid}/comments", {"text": "nice one"})
        post(self.alice, f"/api/vod/{vid}/comments", {"text": "thanks"})  # her own comment: nothing
        kinds = [(x["kind"], x["ref"]) for x in self.alice.get("/api/notifications").get_json()["notifications"][:2]]
        self.assertEqual(kinds, [("comment", vid), ("like", vid)])
        self.assertEqual(self.alice.get("/api/notifications").get_json()["notifications"][0]["body"], "nice one")

        # settings: switch kinds off for the app, defaults are what we documented
        p = self.alice.get("/api/notifications/prefs").get_json()
        self.assertEqual((p["prefs"]["follow"], p["prefs"]["live"]), ({"in_app": True, "email": True}, {"in_app": True, "email": False}))
        self.assertEqual(post(self.alice, "/api/notifications/prefs", {"prefs": {"nope": {"email": True}}}).status_code, 400)
        self.assertEqual(post(self.alice, "/api/notifications/prefs", {"prefs": {"like": {"in_app": "yes"}}}).status_code, 400)
        post(self.alice, "/api/notifications/prefs", {"prefs": {"like": {"in_app": False}}})
        before = self.alice.get("/api/notifications").get_json()["unread"]
        post(carol, "/api/follow/alice", {"follow": True})  # a follow still arrives
        post(carol, f"/api/vod/{vid}/like", {"liked": True})  # a like doesn't show any more
        r = self.alice.get("/api/notifications").get_json()
        self.assertEqual(r["unread"], before + 1)
        self.assertEqual(r["notifications"][0]["kind"], "follow")

        # no emails go out while email isn't configured
        self.assertEqual(mailer.sent_log, [])
        self.assertFalse(self.alice.get("/api/notifications/prefs").get_json()["email_ready"])
        self.assertEqual(post(self.alice, "/api/notifications/test").status_code, 503)

        # clearing
        self.assertEqual(post(self.alice, "/api/notifications/read", {"all": True}).get_json()["unread"], 0)
        post(self.alice, "/api/notifications/clear")
        self.assertEqual(self.alice.get("/api/notifications").get_json()["notifications"], [])

    def test_notification_emails(self):
        import time
        from yeli import mailer, notifications
        mailer.sent_log.clear()
        old = (config.MAIL_CONSOLE, config.PUBLIC_URL, config.NOTIFY_EMAILS_PER_HOUR)
        config.MAIL_CONSOLE, config.PUBLIC_URL = True, "https://yeli.test"
        try:
            self.signup(self.alice, "alice")
            self.signup(self.bob, "bob")
            self.assertTrue(self.alice.get("/api/notifications/prefs").get_json()["email_ready"])

            def wait(n):
                for _ in range(100):
                    if len(mailer.sent_log) >= n:
                        return
                    time.sleep(0.02)

            # follow emails are on by default; the mail goes to the owner's address, with links and an unsubscribe link
            post(self.bob, "/api/follow/alice", {"follow": True})
            wait(1)
            m = mailer.sent_log[-1]
            self.assertEqual((m["to"], m["subject"]), ("alice@x.com", "bob started following you"))
            self.assertIn("https://yeli.test/#/c/bob", m["text"])
            self.assertIn("/unsubscribe/", m["headers"]["List-Unsubscribe"])
            self.assertIn("One-Click", m["headers"]["List-Unsubscribe-Post"])
            self.assertIn("<a href=", m["html"])

            # the person's language is remembered from the app, and html is escaped
            self.alice.get("/api/notifications/poll?lang=es")
            self.buy(self.bob)
            post(self.bob, "/api/wallet/donate", {"channel": "alice", "coins": 100, "message": "<b>hola</b>"})
            wait(2)
            m = mailer.sent_log[-1]
            self.assertEqual(m["subject"], "bob te envi\u00f3 100 Yelis")
            self.assertNotIn("<b>hola</b>", m["html"])
            self.assertIn("&lt;b&gt;hola&lt;/b&gt;", m["html"])

            # switch email off for donations: nothing more is sent, the bell still rings
            post(self.alice, "/api/notifications/prefs", {"prefs": {"donation": {"email": False}}})
            post(self.bob, "/api/wallet/donate", {"channel": "alice", "coins": 100})
            time.sleep(0.2)
            self.assertEqual(len(mailer.sent_log), 2)
            self.assertEqual(self.alice.get("/api/notifications").get_json()["notifications"][0]["kind"], "donation")

            # hourly cap per person
            config.NOTIFY_EMAILS_PER_HOUR = 2
            post(self.alice, "/api/notifications/prefs", {"prefs": {"donation": {"email": True}}})
            post(self.bob, "/api/wallet/donate", {"channel": "alice", "coins": 100})
            time.sleep(0.2)
            self.assertEqual(len(mailer.sent_log), 2)

            # test email button
            r = post(self.alice, "/api/notifications/test")
            self.assertEqual(r.status_code, 200)
            self.assertEqual(mailer.sent_log[-1]["subject"], "Yeli test email")
            self.assertEqual(post(self.alice, "/api/notifications/test").status_code, 429)

            # unsubscribe link: GET only asks, POST turns every email off
            token = notifications.URLSafeSerializer(app.secret_key, salt="yeli-unsubscribe").dumps(self.alice_id())
            page = self.anon.get(f"/unsubscribe/{token}")
            self.assertEqual(page.status_code, 200)
            self.assertTrue(self.alice.get("/api/notifications/prefs").get_json()["prefs"]["follow"]["email"])
            self.assertEqual(self.anon.post(f"/unsubscribe/{token}").status_code, 200)
            prefs = self.alice.get("/api/notifications/prefs").get_json()["prefs"]
            self.assertFalse(any(v["email"] for v in prefs.values()))
            self.assertTrue(all(v["in_app"] for v in prefs.values()))
            self.assertEqual(self.anon.get("/unsubscribe/not-a-token").status_code, 400)
        finally:
            config.MAIL_CONSOLE, config.PUBLIC_URL, config.NOTIFY_EMAILS_PER_HOUR = old

    def test_email_links_ignore_a_forged_host(self):
        from yeli import notifications
        old = (config.MAIL_CONSOLE, config.PUBLIC_URL)
        config.MAIL_CONSOLE, config.PUBLIC_URL = False, ""
        try:
            # no YELI_PUBLIC_URL and no allowed hosts: no links (so no emails) rather than trusting the Host header
            with app.test_request_context("/", headers={"Host": "evil.example"}):
                self.assertEqual(notifications.base_url(), "")
            config.PUBLIC_URL = "https://yeli.test"
            with app.test_request_context("/", headers={"Host": "evil.example"}):
                self.assertEqual(notifications.base_url(), "https://yeli.test")
        finally:
            config.MAIL_CONSOLE, config.PUBLIC_URL = old

    # --- Shorts and Gallery
    GIF = b"GIF89a" + b"\x08\x00\x08\x00" + b"\x00\x00\x00" + b";"

    def edit_clip(self, client, aspect="16:9", duration=60):
        """An exported edit with a cover, in the given format."""
        live = self.live_vod(client, seconds=400)
        pid = self.project(client, [{"a": f"vod:{live}", "in": 0, "out": duration}], aspect=aspect)  # the export can't be longer than its project
        vid = post(client, "/api/vod/new", {"mime": "video/webm", "title": "Edit", "project_id": pid}).get_json()["id"]
        client.post(f"/api/vod/{vid}/chunk?seq=0", data=b"EDIT", **OCTET)
        post(client, f"/api/vod/{vid}/finish", {"duration": duration, "cover": JPEG})
        return vid

    def test_videos_feed_lists_published_regular_videos(self):
        self.signup(self.alice, "alice")
        self.assertEqual(self.anon.get("/api/videos").get_json()["videos"], [])
        vid = self.edit_clip(self.alice, "16:9", 60)
        self.assertEqual(self.anon.get("/api/videos").get_json()["videos"], [])  # private until published
        post(self.alice, f"/api/vod/{vid}/publish", {"title": "Wide"})
        short = self.edit_clip(self.alice, "9:16", 60)
        post(self.alice, f"/api/vod/{short}/publish", {"title": "Tall"})
        feed = self.anon.get("/api/videos").get_json()["videos"]
        self.assertEqual([x["id"] for x in feed], [vid])  # Shorts have their own feed

    def test_vertical_videos_become_shorts(self):
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")
        self.assertEqual(self.anon.get("/api/shorts").get_json()["shorts"], [])

        # a vertical edit of 90 s is published as a Short and shows up in the feed
        short = self.edit_clip(self.alice, "9:16", 90)
        v = post(self.alice, f"/api/vod/{short}/publish", {"title": "Vertical"}).get_json()["video"]
        self.assertEqual((v["aspect"], v["kind"], v["is_short"]), ("9:16", "short", True))
        feed = self.anon.get("/api/shorts").get_json()["shorts"]
        self.assertEqual([x["id"] for x in feed], [short])
        self.assertEqual(self.anon.get("/api/shorts?channel=bob").get_json()["shorts"], [])

        # more than 3 minutes can't be a Short, and nothing is published
        long = self.edit_clip(self.alice, "9:16", 181)
        r = post(self.alice, f"/api/vod/{long}/publish", {"title": "Too long"})
        self.assertEqual((r.status_code, r.get_json()["field"]), (400, "short"))
        self.assertEqual(self.alice.get(f"/api/vod/{long}").get_json()["video"]["visibility"], "private")
        edge = self.edit_clip(self.alice, "9:16", 180)
        self.assertEqual(post(self.alice, f"/api/vod/{edge}/publish", {}).status_code, 200)
        # the same rule when privacy is changed later
        self.assertEqual(post(self.alice, f"/api/vod/{long}/visibility", {"visibility": "public"}).status_code, 400)

        # square and 4:5 are never videos: they are for the gallery
        for aspect in ("1:1", "4:5"):
            sq = self.edit_clip(self.alice, aspect, 30)
            r = post(self.alice, f"/api/vod/{sq}/publish", {})
            self.assertEqual((r.status_code, r.get_json()["field"]), (400, "format"))

        # a recorded stream is as wide as the browser saw it: wide is a normal video, tall a Short; nonsense is ignored
        wide = self.live_vod(self.alice, 100)
        con = sqlite3.connect(config.DB_PATH)
        con.execute("UPDATE vods SET cover = ? WHERE id = ?", (b"\xff\xd8\xff", wide))
        con.commit()
        con.close()
        v = post(self.alice, f"/api/vod/{wide}/publish", {"aspect": "banana"}).get_json()["video"]
        self.assertEqual((v["aspect"], v["kind"]), ("16:9", "video"))
        self.assertEqual(len(self.anon.get("/api/shorts").get_json()["shorts"]), 2)  # `short` and `edge`

        # followers-only shorts only reach followers
        post(self.alice, f"/api/vod/{short}/visibility", {"visibility": "followers"})
        self.assertEqual(len(self.anon.get("/api/shorts").get_json()["shorts"]), 1)
        self.assertEqual(len(self.bob.get("/api/shorts").get_json()["shorts"]), 1)
        post(self.bob, "/api/follow/alice")
        self.assertEqual(len(self.bob.get("/api/shorts").get_json()["shorts"]), 2)

    def gallery_item(self, client, price=120, aspect="1:1", gif=True):
        vid = self.live_vod(client)
        r = post(client, "/api/gallery", {"vod_id": vid, "aspect": aspect, "price": price, "title": "Moment", "image": JPEG})
        self.assertEqual(r.status_code, 201, r.get_json())
        gid = r.get_json()["id"]
        if gif:
            r = client.post(f"/api/gallery/{gid}/gif", data=self.GIF, **OCTET)
            self.assertEqual(r.status_code, 200, r.get_json())
        return gid

    def test_gallery_buy_and_chat_gif(self):
        self.signup(self.alice, "alice")
        self.signup(self.bob, "bob")
        self.signup(self.anon, "carol")
        vid = self.live_vod(self.alice)

        # creating: account, own video, a known format, a sensible price and a real picture
        self.assertEqual(post(self.bob, "/api/gallery", {"vod_id": vid, "aspect": "1:1", "image": JPEG}).status_code, 404)
        base = {"vod_id": vid, "aspect": "4:5", "image": JPEG}
        self.assertEqual(post(self.alice, "/api/gallery", {**base, "aspect": "16:9"}).status_code, 400)
        for price in (5, -1, 10**6, "120", True):
            self.assertEqual(post(self.alice, "/api/gallery", {**base, "price": price}).status_code, 400, price)
        self.assertEqual(post(self.alice, "/api/gallery", {**base, "image": "data:image/png;base64,AAAA"}).status_code, 400)

        # a picture is only in the gallery once its GIF arrived, and the GIF has to be a real, small GIF
        gid = post(self.alice, "/api/gallery", {**base, "price": 120, "title": "  The goal  "}).get_json()["id"]
        self.assertEqual(self.bob.get("/api/gallery").get_json()["items"], [])
        self.assertEqual(self.alice.post(f"/api/gallery/{gid}/gif", data=b"nope", **OCTET).status_code, 400)
        self.assertEqual(self.bob.post(f"/api/gallery/{gid}/gif", data=self.GIF, **OCTET).status_code, 404)
        self.assertEqual(self.alice.post(f"/api/gallery/{gid}/gif", data=self.GIF, content_type="application/json").status_code, 415)
        self.assertEqual(self.alice.post(f"/api/gallery/{gid}/gif", data=self.GIF, **OCTET).status_code, 200)
        self.assertEqual(self.alice.post(f"/api/gallery/{gid}/gif", data=self.GIF, **OCTET).status_code, 409)
        items = self.anon.get("/api/gallery").get_json()["items"]
        self.assertEqual([(i["id"], i["title"], i["price"], i["username"], i["owned"]) for i in items], [(gid, "The goal", 120, "alice", False)])
        self.assertEqual(self.anon.get(f"/api/gallery/{gid}/image").mimetype, "image/jpeg")
        self.assertEqual(self.anon.get(f"/api/gallery/{gid}/gif").data, self.GIF)

        # the author owns it and can't buy it; nobody else can send its GIF before buying
        self.assertEqual([i["id"] for i in self.alice.get("/api/gallery?scope=owned").get_json()["items"]], [gid])
        self.assertEqual(post(self.alice, f"/api/gallery/{gid}/buy").status_code, 400)
        self.assertEqual(post(self.bob, "/api/chat/alice", {"sticker": f"g:{gid}"}).status_code, 403)
        self.assertEqual(post(self.alice, "/api/chat/alice", {"sticker": f"g:{gid}"}).status_code, 201)
        self.assertEqual(post(self.bob, "/api/chat/alice", {"sticker": "g:" + "0" * 16}).status_code, 403)

        # buying: login, enough Yelis, and only once
        self.assertEqual(post(self.anon, f"/api/gallery/{gid}/buy").status_code, 200 if False else 402)
        pid, done = self.buy(self.bob)
        self.assertEqual(done["balance"], 1000)
        r = post(self.bob, f"/api/gallery/{gid}/buy")
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual((r.get_json()["balance"], r.get_json()["item"]["owned"]), (880, True))
        self.assertEqual(post(self.bob, f"/api/gallery/{gid}/buy").status_code, 409)
        self.assertEqual(self.bob.get("/api/me").get_json()["user"]["balance"], 880)
        # the author is paid like a donation
        w = self.alice.get("/api/wallet").get_json()["wallet"]
        self.assertEqual(w["earned"], 120)
        self.assertEqual(self.alice.get("/api/gallery?scope=mine").get_json()["items"][0]["sales"], 1)

        # the buyer sends it in chat: it shows as a sticker whose picture is the GIF
        r = post(self.bob, "/api/chat/alice", {"sticker": f"g:{gid}"})
        self.assertEqual(r.status_code, 201)
        msg = self.anon.get("/api/chat/alice").get_json()["messages"][-1]
        self.assertEqual((msg["kind"], msg["sticker"], msg["user"]), ("sticker", f"g:{gid}", "bob"))

        # a free picture is claimed without Yelis; a price below the minimum was refused above
        free = self.gallery_item(self.alice, price=0)
        self.assertEqual(post(self.anon, f"/api/gallery/{free}/buy").status_code, 200)

        # removing hides it but whoever owns it keeps the GIF
        self.assertEqual(post(self.bob, f"/api/gallery/{gid}/delete").status_code, 404)
        self.assertEqual(post(self.alice, f"/api/gallery/{gid}/delete").status_code, 200)
        self.assertNotIn(gid, [i["id"] for i in self.anon.get("/api/gallery").get_json()["items"]])
        self.assertEqual(post(self.anon, f"/api/gallery/{gid}/buy").status_code, 404)
        self.assertIn(gid, [i["id"] for i in self.bob.get("/api/gallery?scope=owned").get_json()["items"]])
        self.assertEqual(post(self.bob, "/api/chat/alice", {"sticker": f"g:{gid}"}).status_code, 201)
        self.assertEqual(self.anon.get(f"/api/gallery/{gid}/gif").status_code, 200)

        # the gallery has a limit per channel
        old = config.GALLERY_MAX_PER_USER
        config.GALLERY_MAX_PER_USER = 1
        try:
            r = post(self.alice, "/api/gallery", {**base, "price": 0})
            self.assertEqual((r.status_code, r.get_json()["limit"]), (409, True))
        finally:
            config.GALLERY_MAX_PER_USER = old
        self.assertEqual(self.anon.get("/api/gallery?scope=mine").status_code, 200)
        self.assertEqual(self.anon.get("/api/gallery?scope=owned").status_code, 200)

    def alice_id(self):
        con = sqlite3.connect(config.DB_PATH)
        uid = con.execute("SELECT id FROM users WHERE username = 'alice'").fetchone()[0]
        con.close()
        return uid

    def test_verified_badge_and_admin_mod(self):
        boss, ann, bob = self.client(), self.client(), self.client()
        self.signup(boss, "boss")  # listed in YELI_ADMINS
        self.signup(ann, "ann")
        self.signup(bob, "bob")
        # only an admin can verify an account
        self.assertEqual(post(bob, "/api/admin/verify/ann", {"verified": True}).status_code, 403)
        self.assertEqual(post(boss, "/api/admin/verify/nobody", {"verified": True}).status_code, 404)
        self.assertFalse(ann.get("/api/channel/ann").get_json()["channel"]["verified"])
        self.assertTrue(post(boss, "/api/admin/verify/ann", {"verified": True}).get_json()["verified"])
        ch = ann.get("/api/channel/ann").get_json()["channel"]
        self.assertTrue(ch["verified"])
        self.assertFalse(ch["admin"])
        self.assertTrue(bob.get("/api/channel/boss").get_json()["channel"]["admin"])
        # the badges travel with chat messages, and an admin is a moderator in every chat without being picked
        self.assertEqual(post(ann, "/api/chat/ann", {"text": "hi"}).status_code, 201)
        self.assertEqual(post(boss, "/api/chat/ann", {"text": "hello"}).status_code, 201)
        msgs = {m["user"]: m for m in bob.get("/api/chat/ann").get_json()["messages"]}
        self.assertTrue(msgs["ann"]["verified"] and msgs["ann"]["owner"] and not msgs["ann"]["admin"])
        self.assertTrue(msgs["boss"]["admin"] and msgs["boss"]["mod"] and not msgs["boss"]["owner"])
        self.assertTrue(boss.get("/api/channel/ann").get_json()["channel"]["is_mod"])
        self.assertFalse(bob.get("/api/channel/ann").get_json()["channel"]["is_mod"])
        # and it can be taken away again
        self.assertFalse(post(boss, "/api/admin/verify/ann", {"verified": False}).get_json()["verified"])

    def test_index_and_headers(self):
        r = self.anon.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("default-src 'self'", r.headers["Content-Security-Policy"])


if __name__ == "__main__":
    unittest.main()
