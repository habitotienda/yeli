"""Upgrades: buy upgrade points with Yelis, spend points on levels (earnings, recommendation, bot, alerts, badge)."""
from flask import Blueprint, jsonify, request

from . import economy
from .core import *
from .db import get_db
from .queries import *
from .wallet import add_ledger, ensure_wallet, scalar, wallet_summary

bp = Blueprint("upgrades", __name__)


def all_levels(db, uid):
    levels = {t: 0 for t in economy.UPGRADES}
    for r in db.execute("SELECT track, level FROM upgrades WHERE user_id = ?", (uid,)):
        if r["track"] in levels:
            levels[r["track"]] = r["level"]
    return levels


def points_of(db, uid):
    return scalar(db, "SELECT COALESCE((SELECT points FROM upgrade_points WHERE user_id = ?), 0)", (uid,))


@bp.get("/api/upgrades")
@login_required
def upgrades_state():
    uid = current_user()["id"]
    db = get_db()
    w = wallet_summary(db, uid)
    levels = all_levels(db, uid)
    return jsonify(points=points_of(db, uid), levels=levels, wallet={"bought": w["bought"], "cashable": w["cashable"]},
                   palette=economy.palette_for(levels["color"]), color=current_user()["name_color"])


@bp.post("/api/upgrades/points")
@login_required
def buy_points():
    uid = current_user()["id"]
    data = request.get_json(silent=True) or {}
    points, source = data.get("points"), data.get("source", "bought")
    if isinstance(points, bool) or not isinstance(points, int) or not 1 <= points <= 100:
        return err("Choose between 1 and 100 points.")
    if source not in ("bought", "earned"):
        return err("Unknown payment source.")
    cost = points * economy.POINT_COST
    db = get_db()
    db.execute("BEGIN IMMEDIATE")
    ensure_wallet(db, uid)
    if source == "bought":
        cur = db.execute("UPDATE wallets SET bought = bought - ? WHERE user_id = ? AND bought >= ?", (cost, uid, cost))
        if cur.rowcount != 1:
            db.rollback()
            return err("You don't have enough Yelis to spend.", 402)
    else:  # earned Yelis can be reinvested once they've finished the hold period
        if cost > wallet_summary(db, uid)["cashable"]:
            db.rollback()
            return err("You don't have enough earned Yelis that are ready to use.", 402)
        db.execute("INSERT INTO spendings (user_id, coins, kind, ref, created_at) VALUES (?,?,?,?,?)",
                   (uid, cost, "upgrade_points", f"{points} points", now()))
    db.execute(
        "INSERT INTO upgrade_points (user_id, points) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET points = points + excluded.points",
        (uid, points),
    )
    add_ledger(db, uid, source if source == "earned" else "bought", "upgrade_points", -cost, f"{points} upgrade points")
    db.commit()
    return jsonify(points=points_of(db, uid), wallet=wallet_summary(db, uid)["bought"], cost=cost), 201


@bp.post("/api/upgrades/level")
@login_required
def level_up():
    uid = current_user()["id"]
    track = (request.get_json(silent=True) or {}).get("track")
    if track not in economy.UPGRADES:
        return err("Unknown upgrade.")
    db = get_db()
    db.execute("BEGIN IMMEDIATE")
    level = user_level(db, uid, track)
    if level >= economy.max_level(track):
        db.rollback()
        return err("This upgrade is already at its maximum level.")
    cost = economy.UPGRADES[track]["costs"][level]
    cur = db.execute("UPDATE upgrade_points SET points = points - ? WHERE user_id = ? AND points >= ?", (cost, uid, cost))
    if cur.rowcount != 1:
        db.rollback()
        return err(f"You need {cost} upgrade points.", 402)
    db.execute(
        "INSERT INTO upgrades (user_id, track, level) VALUES (?,?,?) ON CONFLICT(user_id, track) DO UPDATE SET level = excluded.level",
        (uid, track, level + 1),
    )
    db.commit()
    return jsonify(track=track, level=level + 1, points=points_of(db, uid), value=economy.level_value(track, level + 1))
