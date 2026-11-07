'use strict';

/* =========================================================================
   The site around the streams: the footer (links + social networks), the legal pages
   (About us, Terms and Conditions, Cookies Policy), What's new, Support, and the Admin hub tabs
   (Support inbox, Updates, Social links).
   The server side is yeli/site.py. Texts of the legal pages live in legal.js (Spanish and English).
   Loaded before script.js; everything here runs later, from the router, so it can use $, api, esc, state, toast...
   ========================================================================= */

/* ---------- icons (line icons, same style as the rest of the app) ---------- */
const SITE_ICON_PATHS = {
    youtube: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M10.500 9.500v5l4.500-2.500z"/>',
    twitch: '<path d="M5 3h15v10l-4 4h-4l-3 3v-3H5z"/><path d="M15 7.500v3M11 7.500v3"/>',
    kick: '<path d="M7 5v14M7 12l8-7M10.500 10l5.500 9"/>',
    tiktok: '<path d="M14 4v10.500a3.500 3.500 0 1 1-3.500-3.500"/><path d="M14 4c.4 2.300 2 3.800 4.500 4"/>',
    instagram: '<rect x="4" y="4" width="16" height="16" rx="4.500"/><circle cx="12" cy="12" r="3.600"/><path d="M16.800 7.200h.01"/>',
    x: '<path d="M5 4l14 16M19 4L5 20"/>',
    facebook: '<path d="M15 4h-2.500A3.500 3.500 0 0 0 9 7.500V10H6.500v3.500H9V20h3.500v-6.500H15l.5-3.500h-3V7.800c0-.5.300-.8.800-.8H15z"/>',
    discord: '<path d="M7.500 7C9 6.300 10.400 6 12 6s3 .3 4.500 1c1.600 2.300 2.600 5 3 8.200-1.300 1-2.700 1.600-4.200 1.900l-.9-1.600M7.500 7C6 9.300 5 12 4.500 15.200c1.300 1 2.700 1.600 4.200 1.900l.9-1.600M8.300 14.800c2.400.7 4.900.7 7.400 0"/><circle cx="9.500" cy="11.500" r="1"/><circle cx="14.500" cy="11.500" r="1"/>',
    telegram: '<path d="M20.500 4L3.500 11l5.500 2 2 6 3-4 4.500 3z"/><path d="M9 13l11-9"/>',
    whatsapp: '<path d="M4 20l1.200-4A8 8 0 1 1 8 18.800z"/><path d="M9.500 9c.2 2.500 3 5 5.500 5.300l1-1.300-2-1-.8.700c-.8-.3-1.700-1.200-2-2l.7-.8-1-2z"/>',
    reddit: '<circle cx="12" cy="14" r="6"/><path d="M12 8l1-4 4 1M8.500 13.500h.01M15.500 13.500h.01M9.500 16.500c1.500 1 3.500 1 5 0"/>',
    github: '<path d="M9 19c-4 1.200-4-2-6-2.500m12 4.500v-3a2.600 2.600 0 0 0-.7-2c3-.3 6-1.500 6-6.500a5 5 0 0 0-1.400-3.500 4.600 4.600 0 0 0-.1-3.500s-1.100-.3-3.600 1.400a12.300 12.300 0 0 0-6.500 0C6.200 2.500 5.100 2.800 5.100 2.800a4.600 4.600 0 0 0-.1 3.500A5 5 0 0 0 3.600 9.800c0 5 3 6.200 6 6.500a2.600 2.600 0 0 0-.7 2v3"/>',
    web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.500 2.600 3.800 5.600 3.800 9s-1.300 6.400-3.800 9c-2.500-2.600-3.800-5.600-3.800-9S9.500 5.600 12 3z"/>',
};
const siteIcon = (name, size = 18) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SITE_ICON_PATHS[name] || SITE_ICON_PATHS.web}</svg>`;

const siteLang = () => (window.YELI_LANG === 'es' ? 'es' : 'en');
const siteDate = (ts) => new Date(ts * 1000).toLocaleDateString(siteLang(), { year: 'numeric', month: 'long', day: 'numeric' });

/** A written text (an update, a support message): paragraphs and line breaks kept, nothing else. */
function plainTextHtml(text) {
    return String(text || '').split(/\n{2,}/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
}

/* =========================================================================
   Social networks (added and removed by the admin). They are shown at the end of the legal pages and of What's new.
   ========================================================================= */
let siteSocials = [];
let sitePlatforms = [];

function socialsHtml() {
    if (!siteSocials.length) return '';
    return `<section class="soc-block" aria-labelledby="socT"><h2 id="socT">Follow us</h2>
        <ul class="soc-list">${siteSocials.map((s) => `
            <li><a class="soc-link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer me">
                ${siteIcon(s.platform, 18)}<span translate="no" data-no-i18n>${esc(s.label || s.name)}</span></a></li>`).join('')}
        </ul></section>`;
}

function setSocials(r) {
    siteSocials = r.socials || [];
    sitePlatforms = r.platforms || sitePlatforms;
}

async function loadSiteSocials() {
    try { setSocials(await api('/site/socials')); } catch { /* the pages work without the links */ }
}

/* =========================================================================
   Legal pages: About us, Terms and Conditions, Cookies Policy
   ========================================================================= */
const LEGAL_TABS = [['about', 'About us'], ['terms', 'Terms and Conditions'], ['cookies', 'Cookies Policy'], ['support', 'Support']];

function legalTable(t) {
    return `<div class="table-wrap"><table class="table legal-table"><thead><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${t.rows.map((r) => `<tr>${r.map((c, i) => `<td class="wrap"${i === 0 ? ' translate="no"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

const legalTabs = (kind) => `<nav class="tabs" role="tablist" aria-label="Legal">${LEGAL_TABS.map(([k, l]) => `<a role="tab" class="tab" href="#/${k}" aria-selected="${k === kind}">${l}</a>`).join('')}</nav>`;

function legalHtml(kind) {
    const lang = siteLang();
    const doc = window.YELI_LEGAL[kind][lang];
    const numbered = kind !== 'about';
    const secs = doc.sections.map((s, i) => `
        <section class="legal-sec" id="sec-${i + 1}">
            <h2>${numbered ? `<span class="legal-n">${i + 1}.</span> ` : ''}${esc(s.h)}</h2>
            ${(s.p || []).map((p) => `<p>${esc(p)}</p>`).join('')}
            ${s.ul ? `<ul>${s.ul.map((li) => `<li>${esc(li)}</li>`).join('')}</ul>` : ''}
            ${s.table ? legalTable(s.table) : ''}
        </section>`).join('');
    const toc = numbered && doc.sections.length > 6 ? `
        <nav class="legal-toc" aria-label="${lang === 'es' ? 'Índice' : 'Contents'}">
            <ol>${doc.sections.map((s, i) => `<li><button type="button" class="link-btn" data-goto="sec-${i + 1}">${esc(s.h)}</button></li>`).join('')}</ol>
        </nav>` : '';
    return `
    ${legalTabs(kind)}
    <article class="legal" lang="${lang}" data-no-i18n>
        <header class="legal-head">
            <h1 class="page-title">${esc(doc.title)}</h1>
            ${doc.updated ? `<p class="page-sub">${esc(doc.updated)}</p>` : ''}
        </header>
        ${doc.intro.map((p) => `<p class="legal-intro">${esc(p)}</p>`).join('')}
        ${toc}
        ${secs}
        <p class="legal-end"><a class="btn btn-secondary" href="#/support">${lang === 'es' ? 'Contactar con Soporte' : 'Contact Support'}</a></p>
    </article>
    ${socialsHtml()}`;
}

async function pageLegal(root, kind) {
    const doc = window.YELI_LEGAL[kind][siteLang()];
    document.title = `${doc.title} | Yeli`;
    root.innerHTML = legalHtml(kind);
    if (!siteSocials.length) { await loadSiteSocials(); if (siteSocials.length && root.isConnected) root.innerHTML = legalHtml(kind); }
}

// The text changes with the interface language, so draw the page again when it changes.
window.addEventListener('yeli:lang', () => {
    if (['/about', '/terms', '/cookies'].includes(parseHash().path)) route();
});

document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) {
        const el = document.getElementById(go.dataset.goto);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
});

/* =========================================================================
   What's new
   ========================================================================= */
function updateHtml(u) {
    return `<article class="upd" id="upd-${u.id}">
        <header class="upd-head">
            <time datetime="${new Date(u.created_at * 1000).toISOString()}">${esc(siteDate(u.created_at))}</time>
            ${u.tag ? `<span class="chip-static upd-tag" data-no-i18n>${esc(u.tag)}</span>` : ''}
        </header>
        <h2 class="upd-title" data-no-i18n>${esc(u.title)}</h2>
        <div class="upd-body" data-no-i18n>${plainTextHtml(u.body)}</div>
    </article>`;
}

async function pageUpdates(root, alive) {
    document.title = 'What’s new | Yeli';
    root.innerHTML = `
        <div class="page-head"><h1 class="page-title">What’s new</h1><p class="page-sub">The latest changes and announcements.</p></div>
        <div id="updBody" class="upd-list">${'<div class="skeleton upd-skel" aria-hidden="true"></div>'}</div>`;
    const body = $('#updBody');
    let before = 0;
    const load = async () => {
        const r = await api(`/site/updates?limit=10${before ? `&before=${before}` : ''}`);
        if (!alive()) return;
        if (!before) body.innerHTML = '';
        body.querySelector('[data-more]')?.remove();
        if (!r.updates.length && !before) {
            body.innerHTML = emptyState('Nothing new yet', 'Announcements and changes will show up here.',
                state.me && state.me.is_admin ? '<a class="btn btn-primary" href="#/admin?tab=updates">Publish an update</a>' : '');
            return;
        }
        body.insertAdjacentHTML('beforeend', r.updates.map(updateHtml).join(''));
        if (r.updates.length) before = r.updates[r.updates.length - 1].id;
        if (r.more) body.insertAdjacentHTML('beforeend', '<div class="upd-more" data-more><button type="button" class="btn btn-secondary">Load more</button></div>');
    };
    await load();
    if (!siteSocials.length) await loadSiteSocials();
    if (alive() && siteSocials.length) root.insertAdjacentHTML('beforeend', socialsHtml());
    root.onclick = (e) => {
        if (e.target.closest('[data-more] button')) load().catch((err) => toast(err.message));
    };
}

/* =========================================================================
   Support
   ========================================================================= */
const SUPPORT_TOPICS = [
    ['account', 'My account'], ['payments', 'Payments and Yelis'], ['streaming', 'Streaming and video'],
    ['bug', 'Something is broken'], ['report', 'Report a user or content'], ['other', 'Something else'],
];
const topicName = (k) => (SUPPORT_TOPICS.find((t) => t[0] === k) || [k, k])[1];
const STATUS_NAME = { open: 'Waiting for an answer', answered: 'Answered', closed: 'Closed' };
const statusBadge = (s) => `<span class="badge sup-status sup-${esc(s)}">${STATUS_NAME[s] || esc(s)}</span>`;

function ticketRow(t, staff, href) {
    return `<a class="sup-item${t.status === 'closed' ? ' is-closed' : ''}" href="${href}">
        ${staff ? avatar({ username: t.username, hue: t.hue, avatar: '' }, 'avatar-md') : ''}
        <span class="sup-main">
            <span class="sup-top"><strong class="sup-subject" data-no-i18n>${esc(t.subject)}</strong>${statusBadge(t.status)}</span>
            <span class="sup-meta">${staff ? `<span translate="no" data-no-i18n>${esc(t.username)}</span> · ` : ''}<span>${topicName(t.category)}</span> · <time>${vodAgo(t.updated_at)}</time></span>
            ${t.preview ? `<span class="sup-preview" data-no-i18n>${t.last_from_staff ? '<em>Support:</em> ' : ''}${esc(t.preview)}</span>` : ''}
        </span>
    </a>`;
}

async function pageSupport(root, alive, params) {
    document.title = 'Support | Yeli';
    if (!state.me) {
        root.innerHTML = emptyState('Log in to contact Support',
            'Write to us and you will get the answer as a notification, and you can read it here.',
            '<button type="button" class="btn btn-primary" data-auth="login">Log In</button><button type="button" class="btn btn-secondary" data-auth="signup">Sign Up</button>');
        return;
    }
    const tid = Number(params.get('ticket'));
    if (tid) { await supportThread(root, alive, tid, { staff: false, backHref: '#/support', backLabel: 'All my requests' }); return; }

    root.innerHTML = `
        ${legalTabs('support')}
        <div class="page-head"><h1 class="page-title">Support</h1><p class="page-sub">Tell us what happened. We answer here and send you a notification.</p></div>
        <div class="sup-layout">
            <section class="panel sup-new" aria-labelledby="supNewT">
                <h2 class="section-title" id="supNewT">New request</h2>
                <form id="supForm" novalidate>
                    <div class="field"><label for="supTopic">Topic</label>
                        <select id="supTopic" name="category">${SUPPORT_TOPICS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
                    <div class="field"><label for="supSubject">Subject</label>
                        <input id="supSubject" name="subject" maxlength="100" required></div>
                    <div class="field"><label for="supMsg">Message</label>
                        <textarea id="supMsg" name="message" rows="6" maxlength="2000" required></textarea>
                        <small id="supCount">0 / 2000</small></div>
                    <p class="form-error" id="supErr" role="alert" hidden></p>
                    <button type="submit" class="btn btn-primary">Send request</button>
                </form>
            </section>
            <section class="sup-mine" aria-labelledby="supMineT">
                <h2 class="section-title" id="supMineT">My requests</h2>
                <div id="supList">${'<div class="skeleton upd-skel" aria-hidden="true"></div>'}</div>
            </section>
        </div>`;

    const form = $('#supForm');
    const err = $('#supErr');
    form.message.addEventListener('input', () => { $('#supCount').textContent = `${form.message.value.length} / 2000`; });
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.hidden = true;
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
            const r = await api('/support/tickets', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
            toast('Request sent. You will get the answer as a notification.');
            location.hash = `#/support?ticket=${r.ticket.id}`;
        } catch (e2) {
            err.textContent = e2.message;
            err.hidden = false;
            if (e2.field) form.querySelector(`[name="${e2.field}"]`)?.focus();
        } finally { btn.disabled = false; }
    });

    const list = painter($('#supList'));
    const load = async () => {
        const { tickets } = await api('/support/tickets');
        if (!alive()) return;
        list(JSON.stringify(tickets), tickets.length
            ? `<div class="sup-items">${tickets.map((t) => ticketRow(t, false, `#/support?ticket=${t.id}`)).join('')}</div>`
            : '<p class="muted">You have not written to Support yet.</p>');
    };
    await load();
    poll(load, 30000);
}

/** One request with its messages and the reply box. `staff` = the admin's view (from the Admin hub). */
async function supportThread(root, alive, tid, { staff, backHref, backLabel }) {
    root.innerHTML = `<div class="sup-thread"><a class="back-link" href="${backHref}">← <span>${backLabel}</span></a><div id="supHead"></div><div id="supMsgs" class="sup-msgs" aria-live="polite">${'<div class="skeleton upd-skel" aria-hidden="true"></div>'}</div><div id="supReply"></div></div>`;
    const head = $('#supHead', root);
    const msgs = painter($('#supMsgs', root));
    const reply = $('#supReply', root);
    let lastKey = '';

    const paint = (d) => {
        const t = d.ticket;
        head.innerHTML = `
            <div class="page-head"><h1 class="page-title sup-title" data-no-i18n>${esc(t.subject)}</h1>
            <p class="page-sub sup-sub">${statusBadge(t.status)} <span>${topicName(t.category)}</span>${d.staff ? ` · <span>From</span> <strong translate="no" data-no-i18n>${esc(t.username)}</strong>` : ''} · <time>${esc(siteDate(t.created_at))}</time></p></div>`;
        msgs(JSON.stringify(d.messages), d.messages.map((m) => {
            const mine = d.staff ? m.staff : !m.staff;
            return `<article class="sup-msg ${m.staff ? 'is-staff' : 'is-user'}${mine ? ' is-mine' : ''}">
                <header><strong>${m.staff ? '<span>Yeli Support</span>' : `<span translate="no" data-no-i18n>${esc(m.username)}</span>`}</strong>${m.staff && d.staff ? `<small translate="no" data-no-i18n>${esc(m.username)}</small>` : ''}<time>${vodAgo(m.created_at)}</time></header>
                <div class="sup-body" data-no-i18n>${plainTextHtml(m.body)}</div>
            </article>`;
        }).join(''));
        const key = t.status === 'closed' ? 'closed' : 'active';  // the reply box is only rebuilt when it must change, so a draft survives the refresh
        if (key === lastKey) return;
        lastKey = key;
        if (t.status === 'closed') {
            reply.innerHTML = `<div class="notice">This request is closed. ${d.staff ? '' : '<a href="#/support">Open a new one</a> if you still need help.'}</div>`;
            return;
        }
        reply.innerHTML = `
            <form class="sup-reply" id="supReplyForm" novalidate>
                <div class="field"><label for="supReplyMsg">${d.staff ? 'Your answer' : 'Your message'}</label>
                    <textarea id="supReplyMsg" name="message" rows="4" maxlength="2000" required></textarea></div>
                <p class="form-error" id="supReplyErr" role="alert" hidden></p>
                <div class="sup-actions">
                    <button type="submit" class="btn btn-primary">${d.staff ? 'Send answer' : 'Send'}</button>
                    <button type="button" class="btn btn-secondary" id="supClose">Close request</button>
                </div>
            </form>`;
        const form = $('#supReplyForm', reply);
        const err = $('#supReplyErr', reply);
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            err.hidden = true;
            const btn = form.querySelector('button[type="submit"]');
            btn.disabled = true;
            try {
                const r = await api(`/support/tickets/${tid}/messages`, { method: 'POST', body: { message: form.message.value } });
                form.message.value = '';
                toast(d.staff ? 'Answer sent.' : 'Message sent.');
                paint(r);
            } catch (e2) { err.textContent = e2.message; err.hidden = false; } finally { btn.disabled = false; }
        });
        $('#supClose', reply).addEventListener('click', async () => {
            if (!window.confirm(window.YeliI18n ? window.YeliI18n.t('Close this request? Nobody will be able to write in it any more.') : 'Close this request?')) return;
            try { await api(`/support/tickets/${tid}/close`, { method: 'POST' }); toast('Request closed.'); paint(await api(`/support/tickets/${tid}`)); } catch (e2) { toast(e2.message); }
        });
    };

    const load = async () => {
        let d;
        try { d = await api(`/support/tickets/${tid}`); } catch (e) {
            if (!alive()) return;
            root.innerHTML = emptyState('Request not found', 'That request doesn’t exist or isn’t yours.', `<a class="btn btn-primary" href="${backHref}">${backLabel}</a>`);
            throw e;
        }
        if (alive()) paint(d);
    };
    try { await load(); } catch { return; }
    poll(load, 20000);
}

/* =========================================================================
   Admin hub: Payments (wallet.js) + Support inbox + Updates + Social links
   ========================================================================= */
const ADMIN_TABS = [['payments', 'Payments'], ['support', 'Support'], ['updates', 'Updates'], ['social', 'Social links']];

async function pageAdminHub(root, alive, params) {
    if (!state.me || !state.me.is_admin) { await pageAdmin(root, alive); return; }
    document.title = 'Admin | Yeli';
    const tab = ADMIN_TABS.some((t) => t[0] === params.get('tab')) ? params.get('tab') : 'payments';
    let waiting = 0;
    try { waiting = (await api('/admin/support?status=open')).counts.open; } catch { /* the badge is optional */ }
    if (!alive()) return;
    root.innerHTML = `
        <div class="page-head"><h1 class="page-title">Admin</h1></div>
        <nav class="tabs" role="tablist" aria-label="Admin sections">${ADMIN_TABS.map(([k, l]) => `<a role="tab" class="tab" href="#/admin?tab=${k}" aria-selected="${k === tab}">${l}${k === 'support' && waiting ? `<span class="tab-count">${waiting}</span>` : ''}</a>`).join('')}</nav>
        <section class="tab-body" role="tabpanel" id="adminTab"></section>`;
    const body = $('#adminTab');
    if (tab === 'payments') await pageAdmin(body, alive, true);
    else if (tab === 'support') await adminSupport(body, alive, params);
    else if (tab === 'updates') await adminUpdates(body, alive);
    else await adminSocials(body, alive);
}

async function adminSupport(body, alive, params) {
    const tid = Number(params.get('ticket'));
    if (tid) { await supportThread(body, alive, tid, { staff: true, backHref: '#/admin?tab=support', backLabel: 'Inbox' }); return; }
    const status = ['open', 'answered', 'closed', 'all'].includes(params.get('status')) ? params.get('status') : 'open';
    const d = await api(`/admin/support?status=${status}`);
    if (!alive()) return;
    const label = { open: 'Waiting for an answer', answered: 'Answered', closed: 'Closed', all: 'All' };
    body.innerHTML = `
        <nav class="chips" aria-label="Filter">${['open', 'answered', 'closed', 'all'].map((s) => `
            <a class="chip" href="#/admin?tab=support&status=${s}" ${s === status ? 'aria-current="true"' : ''}>${label[s]}${s !== 'all' ? `<span class="chip-count">${d.counts[s]}</span>` : ''}</a>`).join('')}</nav>
        ${d.tickets.length
            ? `<div class="sup-items">${d.tickets.map((t) => ticketRow(t, true, `#/admin?tab=support&ticket=${t.id}`)).join('')}</div>`
            : '<p class="muted">Nothing here. When someone writes to Support you get a notification and the request shows up in this inbox.</p>'}`;
}

async function adminUpdates(body, alive) {
    const { updates } = await api('/site/updates?limit=50');
    if (!alive()) return;
    body.innerHTML = `
        <section class="panel">
            <h2 class="section-title">Publish an update</h2>
            <p class="muted">It appears in <a href="#/updates">What’s new</a>, newest first. Write it in the language your audience reads.</p>
            <form id="updForm" novalidate>
                <div class="field-row">
                    <div class="field"><label for="updTitle">Title</label><input id="updTitle" name="title" maxlength="100" required></div>
                    <div class="field"><label for="updTag">Label (optional)</label><input id="updTag" name="tag" maxlength="20" placeholder="New, Fix, Event…"></div>
                </div>
                <div class="field"><label for="updBodyIn">Text</label><textarea id="updBodyIn" name="body" rows="6" maxlength="4000" required></textarea>
                    <small>A blank line starts a new paragraph.</small></div>
                <p class="form-error" id="updErr" role="alert" hidden></p>
                <div><button type="submit" class="btn btn-primary">Publish</button></div>
            </form>
        </section>
        <section class="section"><h2 class="section-title">Published</h2>
            ${updates.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Title</th><th></th></tr></thead><tbody>
                ${updates.map((u) => `<tr data-id="${u.id}"><td>${esc(siteDate(u.created_at))}</td><td class="wrap" data-no-i18n>${esc(u.title)}${u.tag ? ` <span class="badge" data-no-i18n>${esc(u.tag)}</span>` : ''}</td>
                    <td class="actions"><button type="button" class="obs-btn" data-del>Delete</button></td></tr>`).join('')}
            </tbody></table></div>` : '<p class="muted">Nothing published yet.</p>'}
        </section>`;
    const form = $('#updForm', body);
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = $('#updErr', body);
        err.hidden = true;
        try {
            await api('/admin/updates', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
            toast('Update published.');
            route();
        } catch (e2) { err.textContent = e2.message; err.hidden = false; if (e2.field) form.querySelector(`[name="${e2.field}"]`)?.focus(); }
    });
    body.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-del]');
        if (!b) return;
        if (!window.confirm(window.YeliI18n ? window.YeliI18n.t('Delete this update?') : 'Delete this update?')) return;
        b.disabled = true;
        try { await api(`/admin/updates/${b.closest('tr').dataset.id}`, { method: 'DELETE' }); route(); } catch (e2) { toast(e2.message); b.disabled = false; }
    });
}

async function adminSocials(body, alive) {
    const r = await api('/site/socials');
    if (!alive()) return;
    setSocials(r);
    body.innerHTML = `
        <section class="panel">
            <h2 class="section-title">Add a social network</h2>
            <p class="muted">These links appear at the end of the Legal pages and What\u2019s new. Only https:// addresses are accepted.</p>
            <form id="socForm" novalidate>
                <div class="field-row">
                    <div class="field"><label for="socPlatform">Network</label>
                        <select id="socPlatform" name="platform">${r.platforms.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('')}</select></div>
                    <div class="field"><label for="socLabel">Name shown (optional)</label><input id="socLabel" name="label" maxlength="30" placeholder="@yeli"></div>
                </div>
                <div class="field"><label for="socUrl">Address</label><input id="socUrl" name="url" type="url" maxlength="300" placeholder="https://www.youtube.com/@yeli" required></div>
                <p class="form-error" id="socErr" role="alert" hidden></p>
                <div><button type="submit" class="btn btn-primary">Add</button></div>
            </form>
        </section>
        <section class="section"><h2 class="section-title">Shown now</h2>
            ${r.socials.length ? `<ul class="soc-admin">${r.socials.map((s) => `
                <li data-id="${s.id}"><span class="soc-admin-ic">${siteIcon(s.platform, 20)}</span>
                    <span class="soc-admin-txt"><strong translate="no" data-no-i18n>${esc(s.label || s.name)}</strong><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" translate="no" data-no-i18n>${esc(s.url)}</a></span>
                    <button type="button" class="obs-btn" data-del>Remove</button></li>`).join('')}</ul>`
            : '<p class="muted">No social networks yet.</p>'}
        </section>`;
    const form = $('#socForm', body);
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = $('#socErr', body);
        err.hidden = true;
        try {
            setSocials(await api('/admin/socials', { method: 'POST', body: Object.fromEntries(new FormData(form)) }));
            toast('Added.');
            route();
        } catch (e2) { err.textContent = e2.message; err.hidden = false; if (e2.field) form.querySelector(`[name="${e2.field}"]`)?.focus(); }
    });
    body.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-del]');
        if (!b) return;
        b.disabled = true;
        try { setSocials(await api(`/admin/socials/${b.closest('li').dataset.id}`, { method: 'DELETE' })); toast('Removed.'); route(); } catch (e2) { toast(e2.message); b.disabled = false; }
    });
}
