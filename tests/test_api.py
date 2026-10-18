"""Run:  python -m unittest discover tests"""
import os
import sys
import tempfile
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


def post(c, url, body=None):
    return c.post(url, json=body or {})


class YeliTests(unittest.TestCase):
    def setUp(self):
        from yeli import bot as _bot
        _bot._cooldowns.clear()
        core._failed_logins.clear()
        con = sqlite3.connect(config.DB_PATH)
        for t in ("ledger", "payouts", "donations", "purchases", "wallets", "chat_messages", "avatars", "thumbnails", "signals", "viewers", "follows", "streams", "users"):
            con.execute(f"DELETE FROM {t}")
        con.commit()
        con.close()
        self.alice = app.test_client()
        self.bob = app.test_client()
        self.anon = app.test_client()

    def signup(self, client, name):
        r = post(client, "/api/register", {"username": name, "email": f"{name}@x.com", "password": "password123"})
        self.assertEqual(r.status_code, 201, r.get_json())

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
        self.assertEqual(self.alice.get("/api/bot").get_json()["slots"], 5)
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
        # slots: 5 by default, more with the upgrade
        for i in range(2):
            self.command(self.alice, f"c{i}", "x")
        self.assertEqual(self.command(self.alice, "one_more", "x").status_code, 402)
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

    def test_index_and_headers(self):
        r = self.anon.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("default-src 'self'", r.headers["Content-Security-Policy"])


if __name__ == "__main__":
    unittest.main()
