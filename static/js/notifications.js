'use strict';

/* =========================================================================
   Notifications: the bell in the header (panel + unread badge + a toast when something new arrives)
   and the "Notifications" settings panel (what to receive in the app and by email).
   The server decides who gets what (yeli/notifications.py); this file only shows it.
   ========================================================================= */
const notif = { items: [], unread: 0, last: null, open: false, loaded: false, timer: null };

const BELL_PATH = '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8.5 3 8.5H3S6 15 6 8z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>';
const BELL_IC = (size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${BELL_PATH}</svg>`;

/** Where each kind of notification leads when you click it. */
function notifHref(n) {
    if (n.kind === 'like' || n.kind === 'comment' || n.kind === 'reply') return `#/video/${encodeURIComponent(n.ref)}`;
    if (n.kind === 'donation') return '#/wallet';
    if (n.kind === 'support') return `#/support?ticket=${encodeURIComponent(n.ref)}`;
    if (n.kind === 'ticket') return `#/admin?tab=support&ticket=${encodeURIComponent(n.ref)}`;
    return channelHref(n.actor);
}

/** The sentence. Names are marked translate="no"; the words around them go through the Spanish dictionary. */
function notifText(n) {
    const who = `<strong translate="no">${esc(n.actor)}</strong>`;
    const title = n.title ? ` <em class="notif-quote" translate="no">${esc(n.title)}</em>` : '';
    switch (n.kind) {
        case 'follow': return `${who} <span>started following you</span>`;
        case 'donation': return `${who} <span>sent you</span> <b class="notif-amt">${coinImg(14)} ${num(n.amount)}</b> <span>Yelis</span>`;
        case 'comment': return `${who} <span>commented on</span>${title}`;
        case 'reply': return `${who} <span>replied to your comment on</span>${title}`;
        case 'like': return `${who} <span>liked</span>${title}`;
        case 'live': return `${who} <span>is live now</span>${title ? ` <span class="notif-sub" translate="no">${esc(n.title)}</span>` : ''}`;
        case 'ticket': return `${who} <span>wrote to Support:</span>${title}`;
        case 'support': return `<strong>Yeli Support</strong> <span>answered your request</span>${title}`;
        default: return who;
    }
}

const NOTIF_ICON = {
    follow: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    donation: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5h4a1.8 1.8 0 0 1 0 3.6h-3a1.8 1.8 0 0 0 0 3.6h4.2M12 7v2M12 17v2"/>',
    reply: '<path d="M9 14L4 9l5-5"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
    comment: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.7-.9L3 21l1.9-5.3A8.4 8.4 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z"/>',
    like: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
    ticket: '<path d="M4 6h16v10H9l-5 4z"/><path d="M12 9.500v2.500M12 14.500h.01"/>',
    support: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.500"/><path d="M5.600 5.600l3.900 3.900M14.500 14.500l3.900 3.900M18.400 5.600l-3.900 3.900M9.500 14.500l-3.900 3.900"/>',
    live: '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5"/>',
};
const notifKindIcon = (kind) => `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${NOTIF_ICON[kind] || ''}</svg>`;

function notifItemHtml(n) {
    return `<a class="notif-item${n.read ? '' : ' is-unread'}" role="menuitem" href="${notifHref(n)}" data-nid="${n.id}">
        <span class="notif-av">${avatar({ username: n.actor, hue: n.hue, avatar: n.avatar }, 'avatar-md')}<span class="notif-kind notif-kind-${esc(n.kind)}">${notifKindIcon(n.kind)}</span></span>
        <span class="notif-body">
            <span class="notif-line">${notifText(n)}</span>
            ${n.body ? `<span class="notif-msg" translate="no">“${esc(n.body)}”</span>` : ''}
            <time class="notif-time" datetime="${new Date(n.created_at * 1000).toISOString()}">${vodAgo(n.created_at)}</time>
        </span>
        ${n.read ? '' : '<span class="notif-dot" aria-hidden="true"></span>'}
    </a>`;
}

/* ---------- the bell in the header ---------- */
function bellHtml() {
    return `<div class="notif-menu">
        <button type="button" class="notif-btn" aria-haspopup="true" aria-expanded="false" aria-label="Notifications" title="Notifications">
            ${BELL_IC(20)}<span class="notif-badge" hidden></span>
        </button>
        <div class="notif-panel" id="notifPanel" role="menu" aria-label="Notifications" hidden></div>
    </div>`;
}

function paintBell() {
    const btn = $('.notif-btn');
    if (!btn) return;
    const badge = btn.querySelector('.notif-badge');
    badge.hidden = notif.unread <= 0;
    badge.textContent = notif.unread > 99 ? '99+' : String(notif.unread);
    btn.classList.toggle('has-unread', notif.unread > 0);
    const label = notif.unread > 0 ? `Notifications (${notif.unread} new)` : 'Notifications';
    btn.setAttribute('aria-label', label);
}

function paintPanel() {
    const panel = $('#notifPanel');
    if (!panel || panel.hidden) return;
    const list = notif.items.length
        ? notif.items.map(notifItemHtml).join('')
        : `<div class="notif-empty">${BELL_IC(30)}<strong>No notifications yet</strong><span>Follows, Yelis, comments and live streams will show up here.</span></div>`;
    panel.innerHTML = `
        <div class="notif-head">
            <h3>Notifications</h3>
            <span class="notif-tools">
                <button type="button" class="notif-link" data-notif="read-all" ${notif.unread ? '' : 'disabled'}>Mark all as read</button>
                <a class="notif-gear" href="#/settings?tab=notifications" data-notif="settings" aria-label="Notification settings" title="Notification settings">${IC('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>')}</a>
            </span>
        </div>
        <div class="notif-list">${list}</div>
        ${notif.items.length ? '<div class="notif-foot"><button type="button" class="notif-link" data-notif="clear">Clear all</button></div>' : ''}`;
}

async function loadNotifications() {
    try {
        const r = await api(`/notifications?lang=${window.YELI_LANG === 'es' ? 'es' : 'en'}`);
        notif.items = r.notifications;
        notif.unread = r.unread;
        notif.loaded = true;
        if (r.notifications.length) notif.last = Math.max(notif.last || 0, ...r.notifications.map((n) => n.id));
    } catch { /* keep what we had */ }
    paintBell();
    paintPanel();
}

function openNotifPanel() {
    const btn = $('.notif-btn');
    const panel = $('#notifPanel');
    if (!btn || !panel) return;
    closeUserMenu();
    notif.open = true;
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('notif-open');
    paintPanel();   // what we already know, instantly...
    loadNotifications();   // ...then the fresh list
}

function closeNotifPanel() {
    notif.open = false;
    const btn = $('.notif-btn');
    const panel = $('#notifPanel');
    if (panel) panel.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('notif-open');
}

/** Every ~30 s: how many are unread and, if there is something new, a small toast. */
async function pollNotifications() {
    if (!state.me || document.hidden) return;
    try {
        const q = notif.last === null ? '' : `after=${notif.last}&`;
        const r = await api(`/notifications/poll?${q}lang=${window.YELI_LANG === 'es' ? 'es' : 'en'}`);
        const first = notif.last === null;
        notif.unread = r.unread;
        if (r.notifications.length && !first) {
            notif.items = [...r.notifications, ...notif.items.filter((o) => !r.notifications.some((n) => n.id === o.id))].slice(0, 40);
            const n = r.notifications[0];
            toast(notifPlain(n, r.notifications.length));
            if (notif.open) paintPanel();
        }
        notif.last = Math.max(notif.last || 0, r.last);
    } catch { /* offline: try again next time */ }
    paintBell();
}

/** One line of plain text for the toast (Spanish comes from the patterns in i18n-es.js). */
function notifPlain(n, count) {
    if (count > 1) return `${count} new notifications`;
    switch (n.kind) {
        case 'follow': return `${n.actor} started following you`;
        case 'donation': return `${n.actor} sent you ${num(n.amount)} Yelis`;
        case 'comment': return `${n.actor} commented on ${n.title}`;
        case 'reply': return `${n.actor} replied to your comment on ${n.title}`;
        case 'like': return `${n.actor} liked ${n.title}`;
        case 'live': return `${n.actor} is live now`;
        case 'ticket': return `${n.actor} wrote to Support: ${n.title}`;
        case 'support': return `Yeli Support answered your request ${n.title}`;
        default: return n.actor;
    }
}

function startNotifications() {
    clearInterval(notif.timer);
    notif.items = []; notif.unread = 0; notif.last = null; notif.loaded = false;
    if (!state.me) { paintBell(); return; }
    pollNotifications();
    notif.timer = setInterval(pollNotifications, 30000);
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) pollNotifications(); });

document.addEventListener('click', async (e) => {
    const bell = e.target.closest('.notif-btn');
    if (bell) { notif.open ? closeNotifPanel() : openNotifPanel(); return; }
    const panel = e.target.closest('#notifPanel');
    if (!panel) { if (notif.open) closeNotifPanel(); return; }

    const act = e.target.closest('[data-notif]');
    if (act) {
        const what = act.dataset.notif;
        if (what === 'settings') { closeNotifPanel(); return; }
        e.preventDefault();
        try {
            if (what === 'read-all') {
                const r = await api('/notifications/read', { method: 'POST', body: { all: true } });
                notif.items.forEach((n) => { n.read = true; });
                notif.unread = r.unread;
            } else if (what === 'clear') {
                await api('/notifications/clear', { method: 'POST' });
                notif.items = []; notif.unread = 0;
            }
        } catch (err) { toast(err.message); }
        paintBell(); paintPanel();
        return;
    }
    const item = e.target.closest('.notif-item');
    if (item) {
        const n = notif.items.find((x) => x.id === Number(item.dataset.nid));
        if (n && !n.read) {
            n.read = true;
            notif.unread = Math.max(0, notif.unread - 1);
            api('/notifications/read', { method: 'POST', body: { ids: [n.id] } }).catch(() => {});
            paintBell();
        }
        closeNotifPanel();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && notif.open) { closeNotifPanel(); const b = $('.notif-btn'); if (b) b.focus(); }
});
window.addEventListener('hashchange', () => { if (notif.open) closeNotifPanel(); });

/* ---------- Settings panel: what do you want to receive, and where ---------- */
const NOTIF_KINDS = [
    ['follow', 'New followers', 'Someone follows your channel.'],
    ['donation', 'Yelis and stickers', 'Someone sends you Yelis or a paid sticker.'],
    ['comment', 'Comments', 'Someone comments on one of your videos.'],
    ['reply', 'Replies', 'Someone replies to one of your comments.'],
    ['like', 'Likes', 'Someone likes one of your videos.'],
    ['live', 'Live streams', 'A channel you follow goes live.'],
    ['support', 'Support answers', 'Yeli Support answers one of your requests.'],
    ['ticket', 'New Support requests', 'Someone writes to Support (admins only).'],
];

function notifPrefsPanelHtml() {
    const rows = NOTIF_KINDS.filter(([k]) => k !== 'ticket' || (state.me && state.me.is_admin)).map(([k, name, hint]) => `
        <div class="np-row" role="row">
            <div class="np-what" role="rowheader"><strong>${name}</strong><small>${hint}</small></div>
            <label class="np-toggle"><input type="checkbox" data-np="${k}:in_app"><span class="np-switch" aria-hidden="true"></span><span class="np-cap">In the app</span></label>
            <label class="np-toggle"><input type="checkbox" data-np="${k}:email"><span class="np-switch" aria-hidden="true"></span><span class="np-cap">Email</span></label>
        </div>`).join('');
    return `
    <section class="panel" id="notifPrefs">
        <h2 class="section-title">Notifications</h2>
        <p class="muted">Choose what you want to be told about. The bell in the top bar shows the ones marked <em>In the app</em>.</p>
        <p class="np-email muted" id="npEmail" hidden></p>
        <div class="np-table" role="table" aria-label="Notifications">${rows}</div>
        <p class="form-error" id="npError" role="alert" hidden></p>
        <div class="row"><button type="button" class="btn btn-secondary" id="npTest" hidden>Send me a test email</button></div>
    </section>`;
}

async function setupNotifPrefs(root) {
    const box = $('#notifPrefs', root);
    if (!box) return;
    const err = $('#npError', box);
    const test = $('#npTest', box);
    let data;
    try { data = await api('/notifications/prefs'); } catch (e) { err.textContent = e.message; err.hidden = false; return; }
    box.querySelectorAll('input[data-np]').forEach((inp) => {
        const [kind, key] = inp.dataset.np.split(':');
        inp.checked = !!data.prefs[kind][key];
    });
    const mail = $('#npEmail', box);
    mail.hidden = false;
    mail.innerHTML = data.email_ready
        ? `<span>Emails go to</span> <strong translate="no">${esc(data.email)}</strong>.`
        : `<span>Emails are not set up on this server yet, so only the app notifications will arrive.</span>`;
    box.querySelectorAll('input[data-np$=":email"]').forEach((inp) => { inp.disabled = !data.email_ready; });
    test.hidden = !data.email_ready;

    box.addEventListener('change', async (e) => {
        const inp = e.target.closest('input[data-np]');
        if (!inp) return;
        const [kind, key] = inp.dataset.np.split(':');
        err.hidden = true;
        try {
            await api('/notifications/prefs', { method: 'POST', body: { prefs: { [kind]: { [key]: inp.checked } } } });
            toast('Saved.');
        } catch (e2) {
            inp.checked = !inp.checked;
            err.textContent = e2.message;
            err.hidden = false;
        }
    });
    test.addEventListener('click', async () => {
        test.disabled = true;
        err.hidden = true;
        try {
            const r = await api('/notifications/test', { method: 'POST', body: { lang: window.YELI_LANG === 'es' ? 'es' : 'en' } });
            toast(`Test email sent to ${r.to}`);
        } catch (e2) {
            err.textContent = e2.message;
            err.hidden = false;
        } finally {
            setTimeout(() => { test.disabled = false; }, 3000);
        }
    });
}
