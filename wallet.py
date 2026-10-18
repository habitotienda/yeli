"""Yelis: purchases, donations, cash-outs, statements and the admin panel."""
import csv
import io
import re
from datetime import datetime, timezone
from functools import wraps

from flask import Blueprint, Response, jsonify, request

from . import config, economy
from .config import *
from .core import *
from .db import get_db
from .queries import *
from .bot import chat_settings, post_bot, render
from .chat import chat_json

bp = Blueprint("wallet", __name__)


PAYOUT_METHODS = {"paypal": "PayPal", "bank": "Bank transfer", "other": "Other"}


def admin_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        me_row = current_user()
        if me_row is None:
            return err("Log in to continue.", 401)
        if not is_admin(me_row["username"]):
            return err("Admins only.", 403)
        return view(*args, **kwargs)

    return wrapper


def scalar(db, sql, params=()):
    return db.execute(sql, params).fetchone()[0]


def ensure_wallet(db, uid):
    db.execute("INSERT OR IGNORE INTO wallets (user_id, bought) VALUES (?, 0)", (uid,))


def add_ledger(db, uid, pool, kind, coins, ref=""):
    db.execute(
        "INSERT INTO ledger (user_id, pool, kind, coins, ref, created_at) VALUES (?,?,?,?,?,?)",
        (uid, pool, kind, coins, ref, now()),
    )


def earn_rate(db, uid):
    return economy.level_value("earnings", user_level(db, uid, "earnings"))


def wallet_summary(db, uid):
    t = now()
    hold = economy.PAYOUT_HOLD_DAYS * 86400
    bought = scalar(db, "SELECT COALESCE((SELECT bought FROM wallets WHERE user_id = ?), 0)", (uid,))
    earned_total = scalar(db, "SELECT COALESCE(SUM(coins), 0) FROM donations WHERE to_user = ?", (uid,))
    matured = scalar(db, "SELECT COALESCE(SUM(coins), 0) FROM donations WHERE to_user = ? AND created_at <= ?", (uid, t - hold))
    reserved = scalar(
        db, "SELECT COALESCE(SUM(coins), 0) FROM payouts WHERE user_id = ? AND status IN ('requested','approved','paid')", (uid,)
    )
    paid = scalar(db, "SELECT COALESCE(SUM(coins), 0) FROM payouts WHERE user_id = ? AND status = 'paid'", (uid,))
    spent = scalar(db, "SELECT COALESCE(SUM(coins), 0) FROM spendings WHERE user_id = ?", (uid,))  # earned Yelis put into upgrades
    return {
        "bought": bought,                              # Yelis you can spend (donate / stickers)
        "earned": earned_total - reserved - spent,     # Yelis received and not yet requested or spent
        "cashable": max(0, matured - reserved - spent),  # of those, old enough to cash out (or to put into upgrades)
        "rate": earn_rate(db, uid),                    # cents per 100 Yelis, from the Earnings upgrade
        "on_hold": earned_total - matured,             # received recently, still in the hold period
        "pending": reserved - paid,                    # requested, waiting for the owner to pay
        "paid_out": paid,
    }


@bp.get("/api/economy")
def economy_config():
    return jsonify(economy=economy.public_config())


@bp.get("/api/wallet")
@login_required
def wallet():
    uid = current_user()["id"]
    db = get_db()
    history = db.execute(
        "SELECT pool, kind, coins, ref, created_at FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT 30", (uid,)
    ).fetchall()
    payouts = db.execute(
        """SELECT id, coins, gross_cents, withheld_cents, fee_cents, net_cents, method, status, note, test, created_at
           FROM payouts WHERE user_id = ? ORDER BY id DESC LIMIT 20""",
        (uid,),
    ).fetchall()
    return jsonify(
        wallet=wallet_summary(db, uid),
        history=[dict(r) for r in history],
        payouts=[dict(r) for r in payouts],
    )


@bp.post("/api/wallet/buy")
@login_required
def wallet_buy():
    if economy.MODE != "sandbox":
        # Real payments need a payment provider; see README ("Going live with real money").
        return err("Payments aren't set up on this server yet.", 503)
    uid = current_user()["id"]
    pack = economy.pack(text_field(request.get_json(silent=True) or {}, "pack", 20))
    if pack is None:
        return err("Unknown pack.")
    q = economy.quote_purchase(pack)
    db = get_db()
    cur = db.execute(
        """INSERT INTO purchases (user_id, pack_id, coins, gross_cents, tax_cents, fee_cents, net_cents, provider, status, created_at)
           VALUES (?,?,?,?,?,?,?,'sandbox','pending',?)""",
        (uid, pack["id"], pack["coins"], q["gross_cents"], q["tax_cents"], q["fee_cents"], q["net_cents"], now()),
    )
    db.commit()
    return jsonify(purchase={"id": cur.lastrowid, "pack": pack["id"], "coins": pack["coins"], **q, "test": True}), 201


def fulfil_purchase(db, purchase_id, user_id, provider_ref=""):
    """Credit the coins of a paid purchase exactly once. A real provider's webhook must call this, and only
    after verifying the provider's signature. Returns the coins credited, or None if it was already done."""
    cur = db.execute(
        "UPDATE purchases SET status = 'paid', paid_at = ?, provider_ref = ? WHERE id = ? AND user_id = ? AND status = 'pending'",
        (now(), provider_ref, purchase_id, user_id),
    )
    if cur.rowcount != 1:
        return None
    row = db.execute("SELECT coins, pack_id FROM purchases WHERE id = ?", (purchase_id,)).fetchone()
    ensure_wallet(db, user_id)
    db.execute("UPDATE wallets SET bought = bought + ? WHERE user_id = ?", (row["coins"], user_id))
    add_ledger(db, user_id, "bought", "purchase", row["coins"], f"pack {row['pack_id']}")
    return row["coins"]


@bp.post("/api/wallet/purchases/<int:purchase_id>/complete")
@login_required
def wallet_complete(purchase_id):
    """Sandbox only: pretend the payment went through."""
    if economy.MODE != "sandbox":
        return err("Not available.", 403)
    uid = current_user()["id"]
    db = get_db()
    coins = fulfil_purchase(db, purchase_id, uid, "sandbox")
    if coins is None:
        return err("That purchase was already completed or doesn't exist.", 409)
    db.commit()
    return jsonify(coins=coins, balance=wallet_summary(db, uid)["bought"])


@bp.post("/api/wallet/donate")
@login_required
def wallet_donate():
    me_row = current_user()
    data = request.get_json(silent=True) or {}
    channel_name = text_field(data, "channel", 40)
    message = " ".join(text_field(data, "message", 200).split())[:100]
    sticker = data.get("sticker") or ""
    coins = data.get("coins")

    if sticker:
        cost = economy.STICKERS.get(sticker)
        if cost is None:
            return err("Unknown sticker.")
        if cost <= 0:
            return err("Free stickers can be sent in chat.")
        coins = cost  # the server decides the price of a sticker
    if isinstance(coins, bool) or not isinstance(coins, int) or not economy.MIN_DONATION <= coins <= economy.MAX_DONATION:
        return err(f"Donate between {economy.MIN_DONATION} and {economy.MAX_DONATION:,} Yelis.")

    db = get_db()
    target = db.execute("SELECT id, username FROM users WHERE username = ?", (channel_name,)).fetchone()
    if target is None:
        return err("Channel not found.", 404)
    if target["id"] == me_row["id"]:
        return err("You can't donate to your own channel.")
    t = now()
    recent = scalar(db, "SELECT COUNT(*) FROM donations WHERE from_user = ? AND created_at >= ?", (me_row["id"], t - 60))
    if recent >= 10:
        return err("You're donating too fast. Wait a moment.", 429)

    ensure_wallet(db, me_row["id"])
    # Atomic check-and-debit: fails (and changes nothing) if the balance is too low.
    cur = db.execute(
        "UPDATE wallets SET bought = bought - ? WHERE user_id = ? AND bought >= ?", (coins, me_row["id"], coins)
    )
    if cur.rowcount != 1:
        db.rollback()
        return err("You don't have enough Yelis.", 402, balance=wallet_summary(db, me_row["id"])["bought"])
    don = db.execute(
        "INSERT INTO donations (from_user, to_user, coins, message, sticker, created_at) VALUES (?,?,?,?,?,?)",
        (me_row["id"], target["id"], coins, message, sticker, t),
    )
    add_ledger(db, me_row["id"], "bought", "donate_sent", -coins, f"to {target['username']}")
    add_ledger(db, target["id"], "earned", "donate_received", coins, f"from {me_row['username']}")
    msg = db.execute(
        "INSERT INTO chat_messages (channel_id, user_id, text, created_at, kind, sticker, amount) VALUES (?,?,?,?,?,?,?)",
        (target["id"], me_row["id"], message, t, "donation", sticker, coins),
    )
    st = chat_settings(db, target["id"])
    if st["thanks"]:
        post_bot(db, target["id"], render(st["thanks_text"], {"user": me_row["username"], "amount": coins, "channel": target["username"]}))
    db.commit()
    row = {
        "id": msg.lastrowid, "text": message, "created_at": t, "user_id": me_row["id"], "username": me_row["username"],
        "kind": "donation", "sticker": sticker, "amount": coins,
    }
    return jsonify(
        donation={"id": don.lastrowid, "coins": coins},
        balance=wallet_summary(db, me_row["id"])["bought"],
        message=chat_json(row, target["id"]),
    ), 201


@bp.post("/api/wallet/payout")
@login_required
def wallet_payout():
    uid = current_user()["id"]
    data = request.get_json(silent=True) or {}
    coins = data.get("coins")
    method = data.get("method")
    destination = text_field(data, "destination", 120)
    if isinstance(coins, bool) or not isinstance(coins, int) or coins <= 0:
        return err("Enter how many Yelis to cash out.")
    if method not in PAYOUT_METHODS:
        return err("Choose how you want to be paid.")
    if len(destination) < 3:
        return err("Tell us where to send the money (email, account or alias).", field="destination")

    db = get_db()
    db.execute("BEGIN IMMEDIATE")  # no two requests can reserve the same coins
    summary = wallet_summary(db, uid)
    if coins < economy.PAYOUT_MIN_COINS:
        db.rollback()
        return err(f"The minimum cash-out is {economy.PAYOUT_MIN_COINS:,} Yelis.")
    if coins > summary["cashable"]:
        db.rollback()
        return err("You can only cash out Yelis that have finished their hold period.")
    if scalar(db, "SELECT COUNT(*) FROM payouts WHERE user_id = ? AND status IN ('requested','approved')", (uid,)):
        db.rollback()
        return err("You already have a cash-out waiting. Wait until it's paid.")
    q = economy.quote_payout(coins, earn_rate(db, uid))
    if q["net_cents"] <= 0:
        db.rollback()
        return err("That amount is too small to cover the fees.")
    t = now()
    cur = db.execute(
        """INSERT INTO payouts (user_id, coins, gross_cents, withheld_cents, fee_cents, net_cents, method, destination,
                                status, test, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?, 'requested', ?, ?, ?)""",
        (uid, coins, q["gross_cents"], q["withheld_cents"], q["fee_cents"], q["net_cents"], method, destination,
         1 if economy.MODE == "sandbox" else 0, t, t),
    )
    add_ledger(db, uid, "earned", "payout_request", -coins, f"cash-out #{cur.lastrowid}")
    db.commit()
    return jsonify(payout={"id": cur.lastrowid, "coins": coins, **q, "status": "requested"}), 201


@bp.get("/api/wallet/statement.csv")
@login_required
def wallet_statement():
    """Yearly earnings statement, handy for the streamer's own tax filing."""
    me_row = current_user()
    year = int_arg("year", datetime.now(timezone.utc).year)
    start = int(datetime(year, 1, 1, tzinfo=timezone.utc).timestamp())
    end = int(datetime(year + 1, 1, 1, tzinfo=timezone.utc).timestamp())
    db = get_db()
    rate = earn_rate(db, me_row["id"])
    fmt = lambda ts: datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d %H:%M")  # noqa: E731
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["date_utc", "type", "yelis", "counterparty", f"value_{economy.CURRENCY.lower()}", "status"])
    for r in db.execute(
        """SELECT d.created_at, d.coins, u.username FROM donations d JOIN users u ON u.id = d.from_user
           WHERE d.to_user = ? AND d.created_at >= ? AND d.created_at < ? ORDER BY d.id""",
        (me_row["id"], start, end),
    ):
        w.writerow([fmt(r["created_at"]), "donation received", r["coins"], r["username"],
                    f"{economy.payout_value_cents(r['coins'], rate) / 100:.2f}", "received"])
    for r in db.execute(
        """SELECT created_at, coins, gross_cents, withheld_cents, fee_cents, net_cents, status FROM payouts
           WHERE user_id = ? AND created_at >= ? AND created_at < ? ORDER BY id""",
        (me_row["id"], start, end),
    ):
        w.writerow([fmt(r["created_at"]), f"cash-out (gross {r['gross_cents'] / 100:.2f}, withheld {r['withheld_cents'] / 100:.2f}, fee {r['fee_cents'] / 100:.2f})",
                    -r["coins"], "Yeli", f"{r['net_cents'] / 100:.2f}", r["status"]])
    resp = Response(buf.getvalue(), mimetype="text/csv")
    resp.headers["Content-Disposition"] = f'attachment; filename="yeli-statement-{year}.csv"'
    return resp


# ---------- Admin ----------
@bp.get("/api/admin/summary")
@admin_required
def admin_summary():
    db = get_db()
    p = db.execute(
        """SELECT COUNT(*) AS n, COALESCE(SUM(coins),0) AS coins, COALESCE(SUM(gross_cents),0) AS gross,
                  COALESCE(SUM(tax_cents),0) AS tax, COALESCE(SUM(fee_cents),0) AS fee, COALESCE(SUM(net_cents),0) AS net
           FROM purchases WHERE status = 'paid'"""
    ).fetchone()
    donated = scalar(db, "SELECT COALESCE(SUM(coins), 0) FROM donations")
    paid_coins = scalar(db, "SELECT COALESCE(SUM(coins), 0) FROM payouts WHERE status = 'paid'")
    paid_net = scalar(db, "SELECT COALESCE(SUM(net_cents), 0) FROM payouts WHERE status = 'paid'")
    pending = db.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(coins),0) AS coins, COALESCE(SUM(net_cents),0) AS net FROM payouts WHERE status IN ('requested','approved')"
    ).fetchone()
    owed_cents = 0
    for r in db.execute("SELECT to_user, SUM(coins) AS c FROM donations GROUP BY to_user").fetchall():
        paid = scalar(db, "SELECT COALESCE(SUM(coins), 0) FROM payouts WHERE user_id = ? AND status = 'paid'", (r["to_user"],))
        spent = scalar(db, "SELECT COALESCE(SUM(coins), 0) FROM spendings WHERE user_id = ?", (r["to_user"],))
        owed_cents += economy.payout_value_cents(max(0, r["c"] - paid - spent), earn_rate(db, r["to_user"]))
    paid_gross = scalar(db, "SELECT COALESCE(SUM(gross_cents), 0) FROM payouts WHERE status = 'paid'")
    upgrade_coins = scalar(db, "SELECT COALESCE(SUM(-coins), 0) FROM ledger WHERE kind = 'upgrade_points'")
    return jsonify(
        mode=economy.MODE, currency=economy.CURRENCY,
        purchases={"count": p["n"], "coins": p["coins"], "gross_cents": p["gross"], "tax_cents": p["tax"], "fee_cents": p["fee"], "net_cents": p["net"]},
        coins_in_wallets=scalar(db, "SELECT COALESCE(SUM(bought), 0) FROM wallets"),
        donated_coins=donated,
        owed_to_streamers_cents=owed_cents,
        upgrade_coins_spent=upgrade_coins,
        pending_payouts={"count": pending["n"], "coins": pending["coins"], "net_cents": pending["net"]},
        paid_out={"coins": paid_coins, "net_cents": paid_net},
        estimated_margin_cents=p["net"] - owed_cents - paid_gross,
        pack_margins=[
            {"id": k["id"], "coins": k["coins"], **economy.quote_purchase(k),
             "payout_min_cents": economy.payout_value_cents(k["coins"], economy.EARN_RATES[0]),
             "payout_max_cents": economy.payout_value_cents(k["coins"], economy.EARN_RATES[-1]),
             "margin_min_cents": economy.pack_margin(k, economy.EARN_RATES[0]),
             "margin_max_cents": economy.pack_margin(k, economy.EARN_RATES[-1])}
            for k in economy.PACKS
        ],
    )


@bp.get("/api/admin/payouts")
@admin_required
def admin_payouts():
    status = request.args.get("status", "")
    where = "WHERE p.status = ?" if status in ("requested", "approved", "paid", "rejected") else ""
    rows = get_db().execute(
        f"""SELECT p.id, p.coins, p.gross_cents, p.withheld_cents, p.fee_cents, p.net_cents, p.method, p.destination,
                   p.status, p.note, p.test, p.created_at, u.username
            FROM payouts p JOIN users u ON u.id = p.user_id {where} ORDER BY p.id DESC LIMIT 100""",
        (status,) if where else (),
    ).fetchall()
    return jsonify(payouts=[dict(r) for r in rows])


@bp.post("/api/admin/payouts/<int:payout_id>")
@admin_required
def admin_payout_action(payout_id):
    data = request.get_json(silent=True) or {}
    action = data.get("action")
    note = text_field(data, "note", 200)
    allowed = {"approve": ("requested",), "paid": ("requested", "approved"), "reject": ("requested", "approved")}
    new_status = {"approve": "approved", "paid": "paid", "reject": "rejected"}.get(action)
    if new_status is None:
        return err("Unknown action.")
    db = get_db()
    row = db.execute("SELECT user_id, coins FROM payouts WHERE id = ?", (payout_id,)).fetchone()
    if row is None:
        return err("Cash-out not found.", 404)
    marks = ",".join("?" * len(allowed[action]))
    cur = db.execute(
        f"UPDATE payouts SET status = ?, note = ?, updated_at = ? WHERE id = ? AND status IN ({marks})",
        (new_status, note, now(), payout_id, *allowed[action]),
    )
    if cur.rowcount != 1:
        return err("That cash-out can't change to that state.", 409)
    if new_status == "rejected":
        add_ledger(db, row["user_id"], "earned", "payout_rejected", row["coins"], f"cash-out #{payout_id} returned")
    db.commit()
    return jsonify(ok=True, status=new_status)
