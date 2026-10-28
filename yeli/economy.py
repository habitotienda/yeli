"""Yelis economy: pricing, taxes, fees and stickers. Pure functions, no Flask.

Everything here is configurable with environment variables so the owner can tune
the margins. Money is always handled as integer cents, coins as integers.

How the money flows
  buyer pays  pack price (tax included)
  - tax       portion of the price that is owed to the tax authority (YELI_TAX_RATE)
  - fee       payment processor fee estimate (YELI_PROCESSOR_PCT + YELI_PROCESSOR_FIXED_CENTS)
  = net       what the platform actually keeps from the sale

  streamer cashes out  coins * (their earnings rate) / 100.  The rate starts at 50 cents per 100 Yelis and the
                       "Earnings" upgrade raises it up to 80 (see UPGRADES)
  - withholding  optional tax withholding (YELI_PAYOUT_WITHHOLD_PCT)
  - fee          optional transfer fee (YELI_PAYOUT_FEE_CENTS)
  = net payout   what is sent to the streamer

The platform margin is the spread between `net` on purchases and the payout value
of the coins that end up being cashed out. `pack_margin` shows it per pack.
"""
import json
import os


def _float(name, default):
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return float(default)


def _int(name, default):
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return int(default)


# "sandbox" = play money: purchases are free and nothing can be paid out for real.
MODE = os.environ.get("YELI_PAYMENTS", "sandbox")
CURRENCY = os.environ.get("YELI_CURRENCY", "USD")

TAX_RATE = _float("YELI_TAX_RATE", 0.0)              # included in the price, e.g. 0.21 for 21 % VAT
PROCESSOR_PCT = _float("YELI_PROCESSOR_PCT", 0.039)   # estimate, for the accounting only
PROCESSOR_FIXED_CENTS = _int("YELI_PROCESSOR_FIXED_CENTS", 30)

PAYOUT_MIN_COINS = _int("YELI_PAYOUT_MIN_COINS", 5000)
PAYOUT_HOLD_DAYS = _int("YELI_PAYOUT_HOLD_DAYS", 14)           # donations can't be cashed out until this old
PAYOUT_WITHHOLD_PCT = _float("YELI_PAYOUT_WITHHOLD_PCT", 0.0)
PAYOUT_FEE_CENTS = _int("YELI_PAYOUT_FEE_CENTS", 0)

MIN_DONATION = 10
MAX_DONATION = 100000

DEFAULT_PACKS = [
    {"id": "p100", "coins": 100, "price_cents": 149},
    {"id": "p500", "coins": 500, "price_cents": 699},
    {"id": "p1000", "coins": 1000, "price_cents": 1299},
    {"id": "p5000", "coins": 5000, "price_cents": 5999},
]


def _load_packs():
    raw = os.environ.get("YELI_PACKS")  # JSON: [{"id":"p100","coins":100,"price_cents":149}, ...]
    if raw:
        try:
            packs = json.loads(raw)
            if isinstance(packs, list) and all(
                isinstance(p, dict) and isinstance(p.get("id"), str)
                and isinstance(p.get("coins"), int) and p["coins"] > 0
                and isinstance(p.get("price_cents"), int) and p["price_cents"] > 0
                for p in packs
            ):
                return packs
        except ValueError:
            pass
    return DEFAULT_PACKS


PACKS = _load_packs()

# Chat stickers. Cost 0 = free for everyone. Paid stickers are a donation of that many Yelis
# that shows up big in chat. The artwork lives in static/js/stickers.js (ids must match).
STICKERS = {
    "gg": 0, "lol": 0, "wow": 0, "hype": 0, "love": 0, "fire": 0,
    "party": 0, "sad": 0, "cool": 0, "ok": 0, "rip": 0, "zzz": 0,
    "crown": 100, "star": 100, "diamond": 200, "rocket": 300, "trophy": 300, "fireworks": 500,
}


# ---- Upgrades --------------------------------------------------------------------------------------------
# Upgrade points cost POINT_COST Yelis each. Level L -> L+1 costs costs[L] points and changes the value to values[L+1].
POINT_COST = _int("YELI_POINT_COST", 100)


def _load_earn_rates():
    raw = os.environ.get("YELI_EARN_RATES")  # JSON list of cents per 100 Yelis, one per level
    if raw:
        try:
            rates = json.loads(raw)
            if isinstance(rates, list) and len(rates) == 6 and all(isinstance(x, int) and x > 0 for x in rates):
                return rates
        except ValueError:
            pass
    return [50, 56, 62, 68, 74, 80]


EARN_RATES = _load_earn_rates()

UPGRADES = {
    "earnings": {
        "name": "Earnings", "unit": "% of each donation",
        "desc": "The share of every Yeli you receive that you can cash out.",
        "costs": [2, 4, 6, 9, 13], "values": EARN_RATES,
    },
    "boost": {
        "name": "Account recommendation", "unit": "x visibility",
        "desc": "How often your channel shows up in Recommended on Home, even when you're offline.",
        "costs": [2, 3, 5, 8, 12], "values": [1, 2, 4, 7, 11, 16],
    },
    "badge": {
        "name": "Chat badge", "unit": "",
        "desc": "A badge next to your name in every chat: bronze, silver, then gold.",
        "costs": [2, 4, 8], "values": [0, 1, 2, 3],
    },
    "color": {
        "name": "Chat name color", "unit": "",
        "desc": "Pick the color of your name in every chat: 4 colors, then 8, then any color you like.",
        "costs": [1, 3, 6], "values": [0, 4, 8, 99],
    },
}

NAME_PALETTE = ["#ff6b6b", "#ffa94d", "#ffd43b", "#a9e34b", "#38d9a9", "#4dabf7", "#9775fa", "#f783ac"]


def palette_for(level):
    """Colors a user with this Chat name color level may use (None = any #rrggbb)."""
    if level <= 0:
        return []
    if level == 1:
        return NAME_PALETTE[::2]
    return NAME_PALETTE if level == 2 else None


def max_level(track):
    return len(UPGRADES[track]["costs"])


def level_value(track, level):
    values = UPGRADES[track]["values"]
    return values[min(level, len(values) - 1)]


def pack(pack_id):
    return next((p for p in PACKS if p["id"] == pack_id), None)


def _round(x):
    return int(x + 0.5)


def quote_purchase(p):
    gross = p["price_cents"]
    tax = _round(gross - gross / (1 + TAX_RATE)) if TAX_RATE > 0 else 0
    fee = _round(gross * PROCESSOR_PCT + PROCESSOR_FIXED_CENTS)
    return {"gross_cents": gross, "tax_cents": tax, "fee_cents": fee, "net_cents": gross - tax - fee}


def payout_value_cents(coins, rate=None):
    """Money value of earned Yelis. `rate` = cents per 100 Yelis (defaults to the starting rate)."""
    return coins * (EARN_RATES[0] if rate is None else rate) // 100


def quote_payout(coins, rate=None):
    gross = payout_value_cents(coins, rate)
    withheld = _round(gross * PAYOUT_WITHHOLD_PCT)
    fee = PAYOUT_FEE_CENTS
    return {"gross_cents": gross, "withheld_cents": withheld, "fee_cents": fee, "net_cents": max(0, gross - withheld - fee)}


def pack_margin(p, rate=None):
    """Cents the platform keeps if every coin of the pack ends up cashed out at `rate` (default: the highest rate)."""
    return quote_purchase(p)["net_cents"] - payout_value_cents(p["coins"], EARN_RATES[-1] if rate is None else rate)


def public_config():
    return {
        "mode": MODE,
        "currency": CURRENCY,
        "packs": PACKS,
        "taxIncluded": TAX_RATE > 0,
        "payout": {
            "rates": EARN_RATES, "minCoins": PAYOUT_MIN_COINS, "holdDays": PAYOUT_HOLD_DAYS,
            "withholdPct": PAYOUT_WITHHOLD_PCT, "feeCents": PAYOUT_FEE_CENTS,
        },
        "minDonation": MIN_DONATION,
        "maxDonation": MAX_DONATION,
        "stickers": STICKERS,
        "pointCost": POINT_COST,
        "upgrades": UPGRADES,
    }
