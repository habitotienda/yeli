'use strict';

/* =========================================================================
   Live chat: messages, stickers and highlighted donations.
   Messages are fetched by polling. Everything from users goes in with textContent, never as HTML.
   ========================================================================= */
const POPOUT = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
const MEDALS = ['', 'Bronze', 'Silver', 'Gold'];
const SMILE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8.500 14.500q3.500 3 7 0"/><circle cx="9" cy="10" r=".8" fill="currentColor"/><circle cx="15" cy="10" r=".8" fill="currentColor"/></svg>';

function createChat(container, channel, { isOwner = false } = {}) {
    const MAX = 300;
    const path = `/chat/${encodeURIComponent(channel)}`;
    let lastId = 0;
    let since = 0;
    let timer = null;
    let destroyed = false;
    let stick = true;
    const seen = new Set();

    container.innerHTML = `
        <section class="chat" aria-label="Live chat">
            <header class="chat-head"><h2>Chat</h2>
                <span class="chat-tools">
                    ${isOwner ? '' : `<button type="button" class="chat-donate" data-chat-donate>${coinImg(16)}<span>Send Yelis</span></button>`}
                    <button type="button" class="chat-popout" data-chat-popout aria-label="Pop out chat in its own window" title="Pop out chat">${POPOUT}</button>
                </span>
            </header>
            <div class="chat-body">
                <div class="chat-log" role="log" aria-live="polite" tabindex="0"></div>
                <button type="button" class="chat-jump" hidden>New messages</button>
            </div>
            <div class="chat-foot"></div>
        </section>`;
    const log = $('.chat-log', container);
    const jump = $('.chat-jump', container);
    const foot = $('.chat-foot', container);

    const empty = document.createElement('p');
    empty.className = 'chat-empty';
    empty.textContent = 'No messages yet. Say hi!';
    log.appendChild(empty);

    const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 48;
    log.addEventListener('scroll', () => { stick = atBottom(); if (stick) jump.hidden = true; });
    jump.addEventListener('click', () => { log.scrollTop = log.scrollHeight; jump.hidden = true; stick = true; });
    $('[data-chat-popout]', container).addEventListener('click', () => {
        window.open(`${location.origin}${location.pathname}#/popout/${encodeURIComponent(channel)}`, `yeli-chat-${channel}`, 'popup=yes,width=380,height=700');
    });
    const donateBtn = $('[data-chat-donate]', container);
    if (donateBtn) donateBtn.addEventListener('click', () => openDonate(channel));

    function medal(m) {
        if (!m.badge) return '';
        return `<span class="chat-medal medal-${m.badge}" title="${MEDALS[m.badge]} supporter" aria-label="${MEDALS[m.badge]} badge">\u2605</span>`;
    }

    function nameLink(m) {
        const name = document.createElement('a');
        name.className = 'chat-user';
        name.href = channelHref(m.user);
        name.style.color = `hsl(${Number(m.hue) || 0} 75% 70%)`;
        name.textContent = m.user;
        return name;
    }

    function stickerImg(id, cls) {
        const img = document.createElement('img');
        img.className = cls;
        img.src = stickerSrc(id);
        img.alt = stickerName(id) + ' sticker';
        img.width = img.height = 96;
        return img;
    }

    function buildRow(m) {
        const row = document.createElement('div');
        row.dataset.id = m.id;
        if (m.kind === 'donation') {
            row.className = 'chat-msg chat-donation';
            const head = document.createElement('div');
            head.className = 'chat-donation-head';
            head.insertAdjacentHTML('beforeend', coinImg(18));
            head.append(nameLink(m), ` sent ${Number(m.amount).toLocaleString()} Yelis`);
            row.append(head);
            if (m.sticker) row.append(stickerImg(m.sticker, 'chat-sticker chat-sticker-big'));
            if (m.text) {
                const t = document.createElement('div');
                t.className = 'chat-text';
                t.textContent = m.text;
                row.append(t);
            }
        } else if (m.kind === 'sticker') {
            row.className = 'chat-msg chat-sticker-msg';
            row.append(nameLink(m));
            row.insertAdjacentHTML('beforeend', medal(m));
            if (m.owner) row.insertAdjacentHTML('beforeend', '<span class="chat-badge">Streamer</span>');
            row.append(stickerImg(m.sticker, 'chat-sticker'));
        } else if (m.kind === 'bot') {
            row.className = 'chat-msg chat-bot';
            const who = document.createElement('span');
            who.className = 'chat-user chat-bot-name';
            who.textContent = m.user;
            row.append(who);
            row.insertAdjacentHTML('beforeend', '<span class="chat-badge chat-badge-bot">Bot</span>');
            const text = document.createElement('span');
            text.className = 'chat-text';
            text.textContent = m.text;
            row.append(': ', text);
        } else {
            row.className = 'chat-msg';
            row.append(nameLink(m));
            row.insertAdjacentHTML('beforeend', medal(m));
            if (m.owner) row.insertAdjacentHTML('beforeend', '<span class="chat-badge">Streamer</span>');
            const text = document.createElement('span');
            text.className = 'chat-text';
            text.textContent = m.text;
            row.append(': ', text);
        }
        if (isOwner || (state.me && state.me.username === m.user)) {
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'chat-del';
            del.setAttribute('aria-label', `Remove message from ${m.user}`);
            del.title = 'Remove';
            del.textContent = '\u00d7';
            del.addEventListener('click', async () => {
                try {
                    await api(`${path}/delete`, { method: 'POST', body: { id: m.id } });
                    row.remove();
                    showEmptyIfNeeded();
                } catch (e) { toast(e.message); }
            });
            row.append(del);
        }
        return row;
    }

    function add(m) {
        if (seen.has(m.id)) return;
        seen.add(m.id);
        lastId = Math.max(lastId, m.id);
        empty.remove();
        log.appendChild(buildRow(m));
    }

    function showEmptyIfNeeded() {
        if (!log.querySelector('.chat-msg') && !empty.isConnected) log.appendChild(empty);
    }

    function render(messages) {
        if (!messages.length) return;
        const wasStuck = stick || atBottom();
        messages.forEach(add);
        while (log.querySelectorAll('.chat-msg').length > 200) log.querySelector('.chat-msg').remove();
        if (wasStuck) log.scrollTop = log.scrollHeight;
        else jump.hidden = false;
    }

    async function tick() {
        if (destroyed) return;
        try {
            const r = await api(`${path}?after=${lastId}${since ? `&since=${since}` : ''}`);
            if (destroyed) return;
            since = r.t;
            r.removed.forEach((id) => { const el = log.querySelector(`[data-id="${id}"]`); if (el) el.remove(); });
            render(r.messages);
            showEmptyIfNeeded();
        } catch { /* try again on the next tick */ }
        timer = setTimeout(tick, document.hidden ? 6000 : 2000);
    }

    // ---- Composer
    if (!state.me) {
        foot.innerHTML = '<button type="button" class="btn btn-secondary btn-block" data-auth="login">Log in to chat</button>';
    } else {
        foot.innerHTML = `
            <div class="sticker-pop" hidden></div>
            <form class="chat-form" autocomplete="off">
                <button type="button" class="icon-btn chat-sticker-btn" aria-label="Stickers" aria-haspopup="dialog" aria-expanded="false">${SMILE}</button>
                <label class="sr-only" for="chatInput">Send a message</label>
                <input id="chatInput" class="chat-input" maxlength="${MAX}" placeholder="Send a message" enterkeyhint="send">
                <button type="submit" class="btn btn-primary chat-send">Chat</button>
            </form>
            <p class="chat-error" role="alert" hidden></p>`;
        const form = $('.chat-form', foot);
        const input = $('.chat-input', foot);
        const errEl = $('.chat-error', foot);
        const pop = $('.sticker-pop', foot);
        const toggle = $('.chat-sticker-btn', foot);
        const fail = (e) => { errEl.textContent = e.message; errEl.hidden = false; };

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const text = input.value.trim();
            if (!text) return;
            errEl.hidden = true;
            input.disabled = true;
            try {
                const r = await api(path, { method: 'POST', body: { text } });
                input.value = '';
                stick = true;
                render([r.message, ...(r.bot || [])]);
            } catch (err) { fail(err); } finally { input.disabled = false; input.focus(); }
        });

        // ---- Sticker picker
        let tab = 'free';
        let pending = null; // premium sticker waiting for confirmation
        const closePop = () => { pop.hidden = true; toggle.setAttribute('aria-expanded', 'false'); pending = null; };

        function paintPop() {
            const list = STICKER_DEFS.filter((s) => (tab === 'free') === (stickerCost(s.id) === 0));
            pop.innerHTML = `
                <div class="sticker-tabs" role="tablist">
                    <button type="button" role="tab" aria-selected="${tab === 'free'}" data-tab="free">Free</button>
                    <button type="button" role="tab" aria-selected="${tab === 'premium'}" data-tab="premium">Premium</button>
                </div>
                ${pending ? `<div class="sticker-confirm"><img src="${stickerSrc(pending)}" alt="" width="56" height="56">
                    <p>Send <strong>${esc(stickerName(pending))}</strong> for ${coinImg(14)} <strong>${num(stickerCost(pending))}</strong> Yelis?<br><small>You have ${num(state.me.balance)}.</small></p>
                    <div class="row"><button type="button" class="btn btn-primary" data-send>Send</button><button type="button" class="btn btn-secondary" data-cancel>Cancel</button></div></div>`
                : `<div class="sticker-grid">${list.map((s) => `<button type="button" class="sticker-btn" data-sticker="${s.id}" aria-label="${esc(s.name)}${stickerCost(s.id) ? `, ${stickerCost(s.id)} Yelis` : ''}">
                        <img src="${stickerSrc(s.id)}" alt="" width="48" height="48">${stickerCost(s.id) ? `<span class="sticker-cost">${coinImg(11)}${stickerCost(s.id)}</span>` : ''}</button>`).join('')}</div>`}`;
        }

        toggle.addEventListener('click', () => {
            if (pop.hidden) { paintPop(); pop.hidden = false; toggle.setAttribute('aria-expanded', 'true'); } else closePop();
        });
        pop.addEventListener('click', async (e) => {
            const t = e.target.closest('[data-tab]');
            if (t) { tab = t.dataset.tab; pending = null; paintPop(); return; }
            if (e.target.closest('[data-cancel]')) { pending = null; paintPop(); return; }
            const s = e.target.closest('[data-sticker]');
            if (s) {
                const id = s.dataset.sticker;
                if (stickerCost(id) > 0) { pending = id; paintPop(); return; }
                closePop();
                errEl.hidden = true;
                try {
                    const r = await api(path, { method: 'POST', body: { sticker: id } });
                    stick = true;
                    render([r.message]);
                } catch (err) { fail(err); }
                return;
            }
            if (e.target.closest('[data-send]') && pending) {
                const id = pending;
                try {
                    const r = await api('/wallet/donate', { method: 'POST', body: { channel, sticker: id } });
                    setBalance(r.balance);
                    stick = true;
                    render([r.message]);
                    closePop();
                } catch (err) {
                    if (err.status === 402) { closePop(); toast('You need more Yelis for that sticker.'); location.hash = '#/wallet'; }
                    else fail(err);
                }
            }
        });
        // composedPath() is captured when the click happens; e.target may already be gone if the popover re-rendered.
        const outside = (e) => { if (!pop.hidden && !e.composedPath().some((el) => el === pop || el === toggle)) closePop(); };
        document.addEventListener('click', outside);
        container.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
        container._cleanup = () => document.removeEventListener('click', outside);
    }

    tick();
    return {
        destroy() {
            destroyed = true;
            clearTimeout(timer);
            if (container._cleanup) container._cleanup();
        },
    };
}
