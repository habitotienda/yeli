'use strict';

/* =========================================================================
   Daily chest: watch live streams for an hour and the day's chest unlocks.
   The server decides everything (time, reward, one per day); this file draws the chest page, the
   opening animation, your collection and the little progress bar under a live stream.
   ========================================================================= */
const CHEST_ODDS_LABELS = { sticker: 'Exclusive sticker', color: 'Name color', points: 'Upgrade point' };

function chestSvg() {
    return `<svg class="chest-svg" viewBox="0 0 128 128" aria-hidden="true">
        <ellipse cx="64" cy="117" rx="44" ry="7" fill="#000" opacity=".22"/>
        <ellipse class="chest-glow" cx="64" cy="60" rx="38" ry="9" fill="#fff3bf"/>
        <g class="chest-beams"><polygon points="36,60 20,0 46,0" fill="#ffe066"/><polygon points="64,60 50,-6 78,-6" fill="#fff3bf"/><polygon points="92,60 82,0 108,0" fill="#ffe066"/></g>
        <rect x="20" y="58" width="88" height="52" rx="7" fill="#a0612a" stroke="#6b3d12" stroke-width="3"/>
        <path d="M24 74h80M24 92h80" stroke="#7a4515" stroke-width="2" opacity=".6"/>
        <rect x="55" y="58" width="18" height="52" fill="#f5b700" stroke="#b07d00" stroke-width="2"/>
        <rect x="20" y="58" width="88" height="8" fill="#6b3d12" opacity=".35"/>
        <g class="chest-lid">
            <path d="M18 60C18 30 38 22 64 22s46 8 46 38z" fill="#b9722f" stroke="#6b3d12" stroke-width="3" stroke-linejoin="round"/>
            <path d="M30 56C32 38 44 31 64 31" fill="none" stroke="#e0a05a" stroke-width="3" stroke-linecap="round" opacity=".7"/>
            <path d="M55 23h18v37H55z" fill="#f5b700" stroke="#b07d00" stroke-width="2"/>
        </g>
        <g class="chest-lock"><rect x="55" y="56" width="18" height="18" rx="4" fill="#ffd43b" stroke="#b07d00" stroke-width="2.500"/><circle cx="64" cy="63" r="3" fill="#6b3d12"/><path d="M64 63v6" stroke="#6b3d12" stroke-width="2.500" stroke-linecap="round"/></g>
    </svg>`;
}

const chestMinutes = (s) => Math.floor(s / 60);
function chestWait(secs) {
    const h = Math.floor(secs / 3600), m = Math.ceil((secs % 3600) / 60);
    return h > 0 ? `${h} h ${m} min` : `${Math.max(1, m)} min`;
}

function chestRewardHtml(reward) {
    if (reward.kind === 'sticker') {
        return `<img class="chest-reward-sticker" src="${stickerSrc(reward.value)}" alt="" width="96" height="96">
            <h3>New sticker: ${esc(stickerName(reward.value))}!</h3>
            <p class="muted">Send it from the sticker menu in any chat (Chest tab).</p>`;
    }
    if (reward.kind === 'color') {
        return `<span class="chest-reward-swatch" style="background:${esc(reward.value)}"></span>
            <h3>New name color!</h3>
            <p class="muted">This is how your name looks in chat: <strong style="color:${esc(reward.value)}">${esc(state.me.username)}</strong></p>
            <button type="button" class="btn btn-primary" data-use-color="${esc(reward.value)}">Use this color</button>`;
    }
    return `<span class="chest-reward-points">+1</span>
        <h3>1 upgrade point!</h3>
        <p class="muted">Spend it on Earnings, Recommendation, Badge or Chat name color.</p>
        <a class="btn btn-secondary" href="#/wallet?tab=upgrades">Open upgrades</a>`;
}

async function useChestColor(color) {
    const r = await api('/me/color', { method: 'POST', body: { color } });
    state.me = { ...state.me, ...r.user };
    toast(color ? 'Name color saved.' : 'Name color reset.');
}

function openChestReveal(reward, onClose) {
    const dlg = dialogShell('Daily chest', `<div class="chest-reveal">
        <div class="chest-art is-opening">${chestSvg()}</div>
        <div class="chest-reward" hidden>${chestRewardHtml(reward)}</div></div>`);
    const box = $('.chest-reveal', dlg);
    const rewardEl = $('.chest-reward', box);
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => { box.classList.add('shown'); rewardEl.hidden = false; }, reduced ? 0 : 900);
    dlg.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-use-color]');
        if (!btn) return;
        btn.disabled = true;
        try { await useChestColor(btn.dataset.useColor); btn.textContent = 'Saved'; } catch (err) { toast(err.message); btn.disabled = false; }
    });
    dlg.addEventListener('close', onClose);
}

async function pageChest(root, alive) {
    document.title = 'Daily chest | Yeli';
    if (!state.me) {
        root.innerHTML = emptyState('Daily chest', 'Log in, watch live streams for an hour and open a chest with a random reward every day.',
            '<button type="button" class="btn btn-primary" data-auth="login">Log In</button>');
        return;
    }
    const d = await api('/chest');
    if (!alive()) return;
    const cfg = eco().chest;
    const mode = d.opened ? 'open' : d.ready ? 'ready' : 'locked';
    const pct = Math.min(100, Math.round((d.seconds / d.needed) * 100));
    const totalW = Object.values(cfg.weights).reduce((a, b) => a + b, 0) || 1;
    const col = d.collection;
    const status = {
        open: ['Today\u2019s chest is open', `Next chest in ${chestWait(d.resets_in)} (00:00 UTC).`],
        ready: ['Your chest is ready!', 'Open it to see what you got.'],
        locked: ['Chest locked', `Watch a live stream: ${chestMinutes(d.seconds)} of ${chestMinutes(d.needed)} minutes.`],
    }[mode];
    const histLine = (h) => h.kind === 'sticker' ? `Sticker: ${esc(stickerName(h.value))}`
        : h.kind === 'color' ? `Name color <span class="chest-dot" style="background:${esc(h.value)}"></span>` : '1 upgrade point';

    root.innerHTML = `
        <div class="page-head"><h1 class="page-title">Daily chest</h1>
            <p class="page-sub">Watch live streams for an hour to unlock a random reward. A new chest arrives every day at 00:00 UTC.</p></div>
        <section class="panel chest-hero">
            <div class="chest-art is-${mode}">${chestSvg()}</div>
            <div class="chest-info">
                <h2 class="chest-status">${status[0]}</h2>
                <div class="chest-bar" role="progressbar" aria-label="Daily chest progress" aria-valuemin="0" aria-valuemax="${d.needed}" aria-valuenow="${d.seconds}"><span style="width:${pct}%"></span></div>
                <p class="muted">${status[1]}</p>
                ${mode === 'ready' ? '<button type="button" class="btn btn-primary" id="chestOpen">Open chest</button>'
                : mode === 'locked' ? '<a class="btn btn-secondary" href="#/">Find a live stream</a>' : ''}
                ${mode === 'open' && d.today ? `<div class="chest-today">Today you got: <strong>${histLine(d.today)}</strong></div>` : ''}
            </div>
        </section>
        <section class="panel">
            <h2 class="section-title">What can be inside</h2>
            <ul class="chest-odds">${Object.keys(CHEST_ODDS_LABELS).map((k) => `<li><span>${CHEST_ODDS_LABELS[k]}</span><strong>${Math.round((cfg.weights[k] / totalW) * 100)}%</strong></li>`).join('')}</ul>
            <p class="hint">Stickers and colors you already own don\u2019t drop again. Time only counts while you watch someone else\u2019s live stream with your account.</p>
        </section>
        <section class="panel">
            <h2 class="section-title">Your stickers <span class="muted">${col.stickers.length}/${col.total_stickers}</span></h2>
            <div class="chest-collection">${cfg.stickers.map((id) => col.stickers.includes(id)
                ? `<figure class="chest-item"><img src="${stickerSrc(id)}" alt="" width="56" height="56"><figcaption>${esc(stickerName(id))}</figcaption></figure>`
                : `<figure class="chest-item is-missing" aria-label="Locked sticker"><img src="${stickerSrc(id)}" alt="" width="56" height="56"><figcaption>?</figcaption></figure>`).join('')}</div>
        </section>
        <section class="panel">
            <h2 class="section-title">Your name colors <span class="muted">${col.colors.length}/${col.total_colors}</span></h2>
            <div class="swatches" role="group" aria-label="Name colors from chests">${cfg.colors.map((c) => col.colors.includes(c)
                ? `<button type="button" class="swatch${d.color === c ? ' on' : ''}" data-use-color="${c}" style="background:${c}" aria-label="Use color ${c}"></button>`
                : '<span class="swatch swatch-missing" aria-hidden="true"></span>').join('')}
                ${col.colors.length ? '<button type="button" class="obs-btn" data-use-color="">Default</button>' : ''}</div>
        </section>
        ${d.history.length ? `<section class="panel"><h2 class="section-title">Recent chests</h2>
            <ul class="chest-history">${d.history.map((h) => `<li><span>${histLine(h)}</span><time>${new Date(h.at * 1000).toLocaleDateString(window.YELI_LANG)}</time></li>`).join('')}</ul></section>` : ''}`;

    const open = $('#chestOpen', root);
    if (open) open.addEventListener('click', async () => {
        open.disabled = true;
        try {
            const r = await api('/chest/open', { method: 'POST' });
            openChestReveal(r.reward, () => { if (alive()) route(); });
        } catch (e) { toast(e.message); open.disabled = false; route(); }
    });
    root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-use-color]');
        if (!b || !root.contains(b)) return;
        try { await useChestColor(b.dataset.useColor); route(); } catch (err) { toast(err.message); }
    });
}

/* ---------- Progress under a live stream ---------- */
function createChestChip(el, { isOwner }) {
    let last = '';
    let wasReady = null;
    const paint = (key, html) => { if (key !== last) { last = key; el.innerHTML = html; el.hidden = !html; } };
    if (isOwner) { el.hidden = true; return { update() {} }; }
    return {
        update(info) {
            if (!state.me) {
                paint('guest', '<span class="chest-chip-icon" aria-hidden="true">\u{1F381}</span><span>Log in and watch for an hour to earn a daily chest.</span>');
                return;
            }
            if (!info) { paint('', ''); return; }
            if (info.blocked) {
                paint('b' + info.blocked, `<span class="chest-chip-icon" aria-hidden="true">\u{1F512}</span><span>${info.blocked === 'new'
                    ? 'Your account is too new to earn daily chests yet. Try again soon.' : 'Daily chests aren\u2019t earned on the streamer\u2019s own network.'}</span>`);
                return;
            }
            if (info.opened) {
                paint('open', '<span class="chest-chip-icon" aria-hidden="true">\u2714</span><span>Today\u2019s chest is opened. A new one comes at 00:00 UTC.</span>');
            } else if (info.ready) {
                paint('ready', '<span class="chest-chip-icon" aria-hidden="true">\u{1F381}</span><span>Your daily chest is ready!</span><a class="btn btn-primary btn-sm" href="#/chest">Open it</a>');
                if (wasReady === false) toast('Your daily chest is ready! Open it from the menu or the bar under the stream.');
            } else {
                const pct = Math.round((info.seconds / info.needed) * 100);
                paint(`p${chestMinutes(info.seconds)}`, `<span class="chest-chip-icon" aria-hidden="true">\u{1F381}</span><span>Daily chest: ${chestMinutes(info.seconds)} / ${chestMinutes(info.needed)} min</span>
                    <div class="chest-bar chest-bar-sm" role="progressbar" aria-label="Daily chest progress" aria-valuemin="0" aria-valuemax="${info.needed}" aria-valuenow="${info.seconds}"><span style="width:${pct}%"></span></div>`);
            }
            wasReady = info.ready;
        },
    };
}
