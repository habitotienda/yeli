"""YeliBot: !commands (built in and custom), timers, and the chat moderation settings of each channel."""
import random
import re
import time

from flask import Blueprint, jsonify, request

from . import economy
from .core import *
from .db import get_db
from .queries import *

bp = Blueprint("bot", __name__)

BOT_NAME = "YeliBot"
NAME_RE = re.compile(r"^[a-z0-9_]{1,20}$")
PERMS = ("everyone", "followers", "owner")
LINK_RE = re.compile(r"(https?://|www\.)\S+|\b[\w-]+\.(com|net|org|io|gg|tv|me|ly|app|xyz)\b", re.I)
BUILTIN = ("commands", "uptime", "followers", "viewers", "title", "dice", "coinflip", "8ball", "lurk", "hug", "so", "yelis")
VARIABLES = ["{user}", "{channel}", "{args}", "{target}", "{count}", "{uptime}", "{followers}", "{viewers}", "{title}",
             "{category}", "{time}", "{dice}", "{random:a|b|c}"]
BALL = ["It is certain.", "Without a doubt.", "Yes, definitely.", "Most likely.", "Ask again later.",
        "Cannot predict now.", "Don't count on it.", "My sources say no.", "Very doubtful."]
DEFAULTS = {"slow_seconds": 0, "followers_only": 0, "block_links": 0, "banned_words": "", "caps_percent": 0,
            "welcome": 0, "welcome_text": "Thanks for the follow, {user}!", "thanks": 0,
            "thanks_text": "Thank you {user} for {amount} Yelis!"}
_cooldowns = {}  # (channel, command[, user]) -> last use; per process, which is fine for chat spam control


def scalar(db, sql, params=()):
    return db.execute(sql, params).fetchone()[0]


def chat_settings(db, channel_id):
    row = db.execute("SELECT * FROM chat_settings WHERE channel_id = ?", (channel_id,)).fetchone()
    out = dict(DEFAULTS)
    if row:
        out.update({k: row[k] for k in DEFAULTS})
    return out


def command_slots(db, uid):
    return economy.level_value("commands", user_level(db, uid, "commands"))


def post_bot(db, channel_id, text):
    """A message from the bot. It's stored under the channel owner's id and shown as YeliBot."""
    cur = db.execute(
        "INSERT INTO chat_messages (channel_id, user_id, text, created_at, kind) VALUES (?,?,?,?, 'bot')",
        (channel_id, channel_id, text[:300], now()),
    )
    return cur.lastrowid


def uptime_text(started):
    s = max(0, now() - started)
    h, m = s // 3600, (s % 3600) // 60
    return f"{h}h {m:02d}m" if h else f"{m}m"


def channel_context(db, channel_id):
    row = query_channels("WHERE u.id = :id", {"id": channel_id}, "", 1)[0]
    live = bool(row["live"])
    return {
        "channel": row["username"], "followers": row["followers"], "viewers": row["viewers"] if live else 0,
        "title": (row["title"] or "") if live else "", "category": (row["category"] or "") if live else "",
        "uptime": uptime_text(row["started_at"]) if live and row["started_at"] else "offline", "live": live,
    }


def render(template, ctx):
    def sub(m):
        name, arg = m.group(1).lower(), m.group(2)
        if name == "random" and arg:
            return random.choice(arg.split("|")).strip()
        if name == "dice":
            return str(random.randint(1, 6))
        value = ctx.get(name)
        return str(value) if value is not None else m.group(0)

    return re.sub(r"\{(\w+)(?::([^}]*))?\}", sub, template)[:300]


def moderate(db, channel_id, user_id, text):
    """Returns (message, status) when the chat settings reject the message, else None. The owner is never limited."""
    if user_id == channel_id:
        return None
    st = chat_settings(db, channel_id)
    if st["followers_only"] and not db.execute(
        "SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?", (user_id, channel_id)
    ).fetchone():
        return "Only followers can chat here. Follow the channel first.", 403
    if st["slow_seconds"]:
        last = scalar(db, "SELECT COALESCE(MAX(created_at), 0) FROM chat_messages WHERE channel_id = ? AND user_id = ? AND kind IN ('msg','sticker')",
                      (channel_id, user_id))
        wait = st["slow_seconds"] - (now() - last)
        if wait > 0:
            return f"Slow mode is on. Wait {wait}s.", 429
    if st["block_links"] and LINK_RE.search(text):
        return "Links aren't allowed in this chat.", 400
    low = text.lower()
    if any(w and w in low for w in (x.strip().lower() for x in st["banned_words"].split(","))):
        return "That message has a word this channel doesn't allow.", 400
    letters = [c for c in text if c.isalpha()]
    if st["caps_percent"] and len(letters) >= 10 and 100 * sum(c.isupper() for c in letters) / len(letters) > st["caps_percent"]:
        return "Too many capital letters.", 400
    return None


def run_command(db, channel_id, me_row, text):
    """If `text` starts with !name and it's a known command, returns the bot's reply (and records its use)."""
    parts = text[1:].split(None, 1)
    if not parts:
        return None
    name, args = parts[0].lower(), (parts[1].strip() if len(parts) > 1 else "")
    is_owner = me_row["id"] == channel_id
    ctx = channel_context(db, channel_id)
    ctx.update(user=me_row["username"], args=args, target=(args.split()[0].lstrip("@") if args else me_row["username"]),
               time=time.strftime("%H:%M", time.gmtime()) + " UTC")

    custom = db.execute("SELECT * FROM commands WHERE channel_id = ? AND name = ? AND enabled = 1", (channel_id, name)).fetchone()
    if name not in BUILTIN and custom is None:
        return None
    perm = custom["perm"] if custom else ("owner" if name == "so" else "everyone")
    if perm == "owner" and not is_owner:
        return None
    if perm == "followers" and not is_owner and not db.execute(
        "SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?", (me_row["id"], channel_id)
    ).fetchone():
        return None

    t = time.monotonic()
    gap = custom["cooldown"] if custom else 3
    if t - _cooldowns.get((channel_id, name), -1e9) < gap:
        return None
    if not is_owner and t - _cooldowns.get((channel_id, name, me_row["id"]), -1e9) < 10:
        return None
    _cooldowns[(channel_id, name)] = _cooldowns[(channel_id, name, me_row["id"])] = t

    if custom:
        db.execute("UPDATE commands SET uses = uses + 1 WHERE id = ?", (custom["id"],))
        ctx["count"] = custom["uses"] + 1
        return render(custom["response"], ctx)

    if name == "commands":
        mine = [f"!{r['name']}" for r in db.execute("SELECT name FROM commands WHERE channel_id = ? AND enabled = 1 ORDER BY name", (channel_id,))]
        return "Commands: " + " ".join([f"!{b}" for b in BUILTIN if b != "so"] + mine)
    if name == "uptime":
        return render("{channel} has been live for {uptime}.", ctx) if ctx["live"] else render("{channel} is offline right now.", ctx)
    if name == "followers":
        return render("{channel} has {followers} followers.", ctx)
    if name == "viewers":
        return render("{viewers} watching {channel} right now.", ctx) if ctx["live"] else render("{channel} is offline.", ctx)
    if name == "title":
        return render("{title} ({category})", ctx) if ctx["live"] else render("{channel} is offline.", ctx)
    if name == "dice":
        sides = int(args.split()[0]) if args.split() and args.split()[0].isdigit() else 6
        sides = min(max(sides, 2), 1000)
        return f"{me_row['username']} rolled a {random.randint(1, sides)} (d{sides})."
    if name == "coinflip":
        return f"{me_row['username']} flipped {random.choice(['heads', 'tails'])}."
    if name == "8ball":
        return f"{random.choice(BALL)}"
    if name == "lurk":
        return render("{user} is lurking. Thanks for the support!", ctx)
    if name == "hug":
        return render("{user} gives {target} a big hug.", ctx)
    if name == "so":
        return render("Go check out {target}: " + request.host_url + "#/c/{target}", ctx)
    if name == "yelis":
        return render("Support {channel} with Yelis: use the Send Yelis button above the chat, or send a premium sticker.", ctx)
    return None


def run_timers(db, channel_id):
    """Called from the streamer's heartbeat while live: posts the commands that have an auto-post interval."""
    rows = db.execute(
        "SELECT * FROM commands WHERE channel_id = ? AND enabled = 1 AND every_min > 0 AND last_run + every_min * 60 <= ?",
        (channel_id, now()),
    ).fetchall()
    if not rows:
        return
    ctx = channel_context(db, channel_id)
    ctx.update(user=ctx["channel"], args="", target=ctx["channel"], time=time.strftime("%H:%M", time.gmtime()) + " UTC")
    for r in rows:
        db.execute("UPDATE commands SET last_run = ?, uses = uses + 1 WHERE id = ?", (now(), r["id"]))
        post_bot(db, channel_id, render(r["response"], {**ctx, "count": r["uses"] + 1}))


# ---------------------------------------------------------------------------------------------- settings API
def command_json(r):
    return {k: r[k] for k in ("id", "name", "response", "cooldown", "perm", "uses", "enabled", "every_min")}


@bp.get("/api/bot")
@login_required
def bot_state():
    uid = current_user()["id"]
    db = get_db()
    cmds = db.execute("SELECT * FROM commands WHERE channel_id = ? ORDER BY name", (uid,)).fetchall()
    return jsonify(settings=chat_settings(db, uid), commands=[command_json(r) for r in cmds], slots=command_slots(db, uid),
                   builtin=list(BUILTIN), variables=VARIABLES)


@bp.post("/api/bot/settings")
@login_required
def bot_settings():
    uid = current_user()["id"]
    d = request.get_json(silent=True) or {}

    def num(key, lo, hi):
        v = d.get(key, DEFAULTS[key])
        return min(max(v, lo), hi) if isinstance(v, int) and not isinstance(v, bool) else DEFAULTS[key]

    words = ",".join(w.strip().lower() for w in str(d.get("banned_words", ""))[:500].split(",") if w.strip())[:500]
    vals = {
        "slow_seconds": num("slow_seconds", 0, 300), "followers_only": 1 if d.get("followers_only") else 0,
        "block_links": 1 if d.get("block_links") else 0, "banned_words": words, "caps_percent": num("caps_percent", 0, 100),
        "welcome": 1 if d.get("welcome") else 0, "welcome_text": text_field(d, "welcome_text", 200) or DEFAULTS["welcome_text"],
        "thanks": 1 if d.get("thanks") else 0, "thanks_text": text_field(d, "thanks_text", 200) or DEFAULTS["thanks_text"],
    }
    db = get_db()
    cols = list(vals)
    db.execute(
        f"INSERT INTO chat_settings (channel_id, {', '.join(cols)}) VALUES (?{',?' * len(cols)}) "
        f"ON CONFLICT(channel_id) DO UPDATE SET {', '.join(f'{c} = excluded.{c}' for c in cols)}",
        (uid, *vals.values()),
    )
    db.commit()
    return jsonify(settings=chat_settings(db, uid))


@bp.post("/api/bot/commands")
@login_required
def bot_command_save():
    uid = current_user()["id"]
    d = request.get_json(silent=True) or {}
    name = text_field(d, "name", 30).lstrip("!").lower()
    response = text_field(d, "response", 300)
    perm = d.get("perm", "everyone")
    cooldown, every = d.get("cooldown", 5), d.get("every_min", 0)
    if not NAME_RE.match(name):
        return err("Command names use letters, numbers or _ (up to 20).", field="name")
    if name in BUILTIN:
        return err(f"!{name} is already a built-in command.", field="name")
    if not response:
        return err("Write what the bot should say.", field="response")
    if perm not in PERMS:
        return err("Unknown permission.")
    if not isinstance(cooldown, int) or isinstance(cooldown, bool) or not 0 <= cooldown <= 3600:
        return err("The cooldown is 0 to 3600 seconds.", field="cooldown")
    if not isinstance(every, int) or isinstance(every, bool) or not (every == 0 or 5 <= every <= 720):
        return err("Auto-post every 5 to 720 minutes, or 0 to turn it off.", field="every_min")
    enabled = 0 if d.get("enabled") is False else 1
    db = get_db()
    cmd_id = d.get("id")
    existing = db.execute("SELECT id FROM commands WHERE channel_id = ? AND name = ?", (uid, name)).fetchone()
    if cmd_id is not None:
        row = db.execute("SELECT id FROM commands WHERE id = ? AND channel_id = ?", (cmd_id, uid)).fetchone()
        if row is None:
            return err("Command not found.", 404)
        if existing and existing["id"] != row["id"]:
            return err("You already have a command with that name.", 409, field="name")
        db.execute("UPDATE commands SET name = ?, response = ?, cooldown = ?, perm = ?, every_min = ?, enabled = ? WHERE id = ?",
                   (name, response, cooldown, perm, every, enabled, row["id"]))
    else:
        if existing:
            return err("You already have a command with that name.", 409, field="name")
        used = scalar(db, "SELECT COUNT(*) FROM commands WHERE channel_id = ?", (uid,))
        if used >= command_slots(db, uid):
            return err("You've used all your command slots. Upgrade \"Bot commands\" for more.", 402)
        db.execute("INSERT INTO commands (channel_id, name, response, cooldown, perm, every_min, enabled) VALUES (?,?,?,?,?,?,?)",
                   (uid, name, response, cooldown, perm, every, enabled))
    db.commit()
    return jsonify(commands=[command_json(r) for r in db.execute("SELECT * FROM commands WHERE channel_id = ? ORDER BY name", (uid,))]), 201


@bp.post("/api/bot/commands/delete")
@login_required
def bot_command_delete():
    uid = current_user()["id"]
    db = get_db()
    db.execute("DELETE FROM commands WHERE id = ? AND channel_id = ?", ((request.get_json(silent=True) or {}).get("id"), uid))
    db.commit()
    return jsonify(ok=True)
