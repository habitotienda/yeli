"""Yelis economy: pricing, taxes, fees and stickers. Pure functions, no Flask.

Everything here is configurable with environment variables so the owner can tune
the margins. Money is always handled as integer cents, coins as integers.

How the money flows
  buyer pays  pack price (tax included)
  - tax       portion of the price that is owed to the tax authority (YELI_TAX_RATE)
  - fee       payment processor fee estimate (YELI_PROCESSOR_PCT + YELI_PROCESSOR_FIXED_CENTS)
  = net       what the platform actually keeps from the sale

  streamer cashes out  coins * YELI_PAYOUT_CENTS_PER_100 / 100
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

PAYOUT_CENTS_PER_100 = _int("YELI_PAYOUT_CENTS_PER_100", 80)   # value of 100 earned Yelis when cashed out
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


def pack(pack_id):
    return next((p for p in PACKS if p["id"] == pack_id), None)


def _round(x):
    return int(x + 0.5)


def quote_purchase(p):
    gross = p["price_cents"]
    tax = _round(gross - gross / (1 + TAX_RATE)) if TAX_RATE > 0 else 0
    fee = _round(gross * PROCESSOR_PCT + PROCESSOR_FIXED_CENTS)
    return {"gross_cents": gross, "tax_cents": tax, "fee_cents": fee, "net_cents": gross - tax - fee}


def payout_value_cents(coins):
    return coins * PAYOUT_CENTS_PER_100 // 100


def quote_payout(coins):
    gross = payout_value_cents(coins)
    withheld = _round(gross * PAYOUT_WITHHOLD_PCT)
    fee = PAYOUT_FEE_CENTS
    return {"gross_cents": gross, "withheld_cents": withheld, "fee_cents": fee, "net_cents": max(0, gross - withheld - fee)}


def pack_margin(p):
    """Cents the platform keeps if every coin of the pack ends up cashed out."""
    return quote_purchase(p)["net_cents"] - payout_value_cents(p["coins"])


def public_config():
    return {
        "mode": MODE,
        "currency": CURRENCY,
        "packs": PACKS,
        "taxIncluded": TAX_RATE > 0,
        "payout": {
            "centsPer100": PAYOUT_CENTS_PER_100, "minCoins": PAYOUT_MIN_COINS, "holdDays": PAYOUT_HOLD_DAYS,
            "withholdPct": PAYOUT_WITHHOLD_PCT, "feeCents": PAYOUT_FEE_CENTS,
        },
        "minDonation": MIN_DONATION,
        "maxDonation": MAX_DONATION,
        "stickers": STICKERS,
    }
