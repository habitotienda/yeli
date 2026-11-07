'use strict';

/* =========================================================================
   Live chat: messages, stickers and highlighted donations.
   Messages are fetched by polling. Everything from users goes in with textContent, never as HTML.
   ========================================================================= */
const POPOUT = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
const SPEAKER_ON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500z"/><path d="M15.500 9a4.200 4.200 0 0 1 0 6M18 6.500a8 8 0 0 1 0 11"/></svg>';
const SPEAKER_OFF = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500z"/><path d="M16 9.500l5 5m0-5l-5 5"/></svg>';
const MEDALS = ['', 'Bronze', 'Silver', 'Gold'];
const SMILE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8.500 14.500q3.500 3 7 0"/><circle cx="9" cy="10" r=".8" fill="currentColor"/><circle cx="15" cy="10" r=".8" fill="currentColor"/></svg>';

/* =========================================================================
   Voice: reads the !say messages aloud with the browser's own speech engine.
   Shared by every chat (viewers, the studio, the pop-out) and by the "Test voice" button.
   ========================================================================= */
const PLATFORM_LABELS = { kick: 'Kick', tiktok: 'TikTok', twitch: 'Twitch', youtube: 'YouTube', facebook: 'Facebook', instagram: 'Instagram' };
const PLATFORM_COLORS = { kick: '#53fc18', tiktok: '#fe2c55', twitch: '#9146ff', youtube: '#ff0000', facebook: '#1877f2', instagram: '#e1306c' };
const platformLabel = (p) => PLATFORM_LABELS[p] || String(p || '').slice(0, 10);
const platformColor = (p) => PLATFORM_COLORS[p] || '#9aa0a6';

const Voice = (() => {
    const synth = () => ('speechSynthesis' in window ? window.speechSynthesis : null);
    let unlocked = false;
    let queued = 0;
    let lastActivity = Date.now();
    let audioCtx = null;

    /* Phones only let a page speak after the person has touched it once, and the streamer never taps the chat box.
       The first touch, click or key press "unlocks" speech with a silent utterance. */
    function unlock() {
        const s = synth();
        if (!s || unlocked) return;
        unlocked = true;
        try {
            const u = new SpeechSynthesisUtterance(' ');
            u.volume = 0;
            s.speak(u);
        } catch { /* speech not available */ }
    }
    ['pointerdown', 'touchend', 'keydown', 'click'].forEach((ev) => document.addEventListener(ev, unlock, { passive: true }));

    /* A short tone, used when the device has no voice to read with, so the streamer still knows a message arrived. */
    function beep() {
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 660;
            gain.gain.value = 0.06;
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.2);
        } catch { /* no audio either */ }
    }

    /** 'ok', 'none' (the browser can't speak) or 'novoices' (it can, but this device has no voice installed). */
    function status() {
        const s = synth();
        if (!s) return 'none';
        return s.getVoices && s.getVoices().length === 0 ? 'novoices' : 'ok';
    }

    function speak(text, lang) {
        const s = synth();
        if (!s) { beep(); return false; }
        try {
            if (s.paused) s.resume();
            // Chrome sometimes leaves its queue stuck after a long time in the background: clear it
            if (queued > 0 && Date.now() - lastActivity > 20000) { s.cancel(); queued = 0; }
            if (queued >= 3) return false; // don't pile up a backlog
            const u = new SpeechSynthesisUtterance(text);
            if (lang) u.lang = lang;
            const done = () => { queued = Math.max(0, queued - 1); lastActivity = Date.now(); };
            u.onstart = () => { lastActivity = Date.now(); };
            u.onend = done;
            u.onerror = done;
            queued++;
            lastActivity = Date.now();
            s.speak(u);
            if (status() === 'novoices') beep();
            return true;
        } catch {
            beep();
            return false;
        }
    }

    function cancel() {
        const s = synth();
        if (s) { s.cancel(); queued = 0; }
    }

    return { speak, cancel, status, beep };
})();

function createChat(container, channel, { isOwner = false, canMod = isOwner, onVoice = null } = {}) {
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
                    <button type="button" class="chat-popout" data-chat-tts hidden aria-pressed="true" aria-label="Read voice messages aloud" title="Voice messages"></button>
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

    let armed = false;      // messages that were already in the chat when it opened are never read aloud
    let ttsLang = '';
    let streamVoice = false; // the server turns the voice into audio and the studio mixes it into the stream
    const ttsBtn = $('[data-chat-tts]', container);
    // The streamer's studio has its own mute switch, so muting the voice while watching other channels doesn't silence it
    const TTS_KEY = isOwner ? 'yeli:tts:own' : 'yeli:tts';
    const ttsOn = () => { try { return localStorage.getItem(TTS_KEY) !== '0'; } catch { return true; } };
    const paintTts = () => { ttsBtn.innerHTML = ttsOn() ? SPEAKER_ON : SPEAKER_OFF; ttsBtn.setAttribute('aria-pressed', String(ttsOn())); };
    ttsBtn.addEventListener('click', () => {
        try { localStorage.setItem(TTS_KEY, ttsOn() ? '0' : '1'); } catch { /* private mode */ }
        if (!ttsOn()) Voice.cancel();
        paintTts();
    });
    paintTts();
    function speak(text) {
        if (ttsOn()) Voice.speak(text, ttsLang);
    }


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

    /** Custom icons after the name: admin, verified, streamer or mod, and the supporter medal (see badges.js). */
    function medal(m) {
        return userBadgesHtml({ admin: m.admin, verified: m.verified, streamer: m.owner, mod: m.mod, tier: m.badge }, 16);
    }

    function nameLink(m) {
        if (m.platform) { // someone from another platform: no profile to link to, so show where they come from
            const wrap = document.createElement('span');
            wrap.className = 'chat-user chat-ext';
            const tag = document.createElement('span');
            tag.className = `plat-tag plat-${m.platform}`;
            tag.textContent = platformLabel(m.platform);
            const who = document.createElement('span');
            who.style.color = `hsl(${Number(m.hue) || 0} 75% 70%)`;
            who.textContent = m.user;
            wrap.append(tag, who);
            return wrap;
        }
        const name = document.createElement('a');
        name.className = 'chat-user';
        name.href = channelHref(m.user);
        name.style.color = m.color || `hsl(${Number(m.hue) || 0} 75% 70%)`;
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
            head.append(nameLink(m), ` sent ${Number(m.amount).toLocaleString(window.YELI_LANG)} Yelis`);
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
            row.append(stickerImg(m.sticker, 'chat-sticker'));
        } else if (m.kind === 'tts') {
            row.className = 'chat-msg chat-tts';
            row.insertAdjacentHTML('beforeend', `<span class="chat-tts-icon" aria-label="Voice message">${SPEAKER_ON}</span>`);
            const text = document.createElement('span');
            text.className = 'chat-text';
            text.textContent = m.text;
            row.append(text, ' ');
            const who = nameLink(m);
            who.classList.add('chat-tts-by');
            row.append('(', who, ')');
        } else if (m.kind === 'bot') {
            row.className = 'chat-msg chat-bot';
            const who = document.createElement('span');
            who.className = 'chat-user chat-bot-name';
            who.textContent = m.user;
            row.append(who);
            row.insertAdjacentHTML('beforeend', userBadgesHtml({ bot: true }, 16));
            const text = document.createElement('span');
            text.className = 'chat-text';
            text.textContent = m.text;
            row.append(': ', text);
        } else {
            row.className = 'chat-msg';
            row.append(nameLink(m));
            row.insertAdjacentHTML('beforeend', medal(m));
            const text = document.createElement('span');
            text.className = 'chat-text';
            text.textContent = m.text;
            row.append(': ', text);
        }
        row.dataset.user = m.user;
        if (canMod || (state.me && state.me.username === m.user)) {
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
        if (canMod && m.kind !== 'bot' && !m.owner && !m.platform && state.me && state.me.username !== m.user) {
            const tools = document.createElement('span');
            tools.className = 'chat-modtools';
            for (const [label, minutes, purge, title] of [['10m', 10, false, 'Time out for 10 minutes'], ['Ban', 0, true, 'Ban and delete their messages']]) {
                const b = document.createElement('button');
                b.type = 'button';
                b.textContent = label;
                b.title = `${title}: ${m.user}`;
                b.setAttribute('aria-label', `${title}: ${m.user}`);
                b.addEventListener('click', async () => {
                    try {
                        await api(`/mod/${encodeURIComponent(channel)}/ban`, { method: 'POST', body: { user: m.user, minutes, purge } });
                        toast(`${m.user} ${minutes ? 'timed out for 10 minutes' : 'banned'}.`);
                        if (purge) log.querySelectorAll(`.chat-msg[data-user="${CSS.escape(m.user)}"]`).forEach((el) => el.remove());
                        showEmptyIfNeeded();
                    } catch (e) { toast(e.message); }
                });
                tools.append(b);
            }
            row.append(tools);
        }
        return row;
    }

    function add(m) {
        if (seen.has(m.id)) return;
        seen.add(m.id);
        lastId = Math.max(lastId, m.id);
        empty.remove();
        log.appendChild(buildRow(m));
        if (armed && m.kind === 'tts' && Date.now() / 1000 - m.ts < (isOwner ? 180 : 30)) {
            // In the stream, the studio plays it (onVoice) and every other browser stays quiet; otherwise this browser reads it
            if (streamVoice) { if (onVoice) onVoice(m); } else speak(m.text);
        }
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
            streamVoice = !!r.tts_stream;
            if (r.tts_lang !== undefined) { ttsLang = r.tts_lang || ''; ttsBtn.hidden = r.tts_lang === null || streamVoice; }
            r.removed.forEach((id) => { const el = log.querySelector(`[data-id="${id}"]`); if (el) el.remove(); });
            render(r.messages);
            armed = true;
            showEmptyIfNeeded();
        } catch { /* try again on the next tick */ }
        timer = setTimeout(tick, document.hidden && !isOwner ? 6000 : 2000);
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
            const found = (state.chestStickers || []);
            const gifs = (state.myGifs || []).map((g) => ({ id: `g:${g.id}`, name: g.title }));   // GIFs bought in the gallery
            const list = tab === 'gifs' ? gifs : tab === 'chest' ? CHEST_STICKER_DEFS.filter((s) => found.includes(s.id))
                : STICKER_DEFS.filter((s) => (tab === 'free') === (stickerCost(s.id) === 0));
            pop.innerHTML = `
                <div class="sticker-tabs" role="tablist">
                    <button type="button" role="tab" aria-selected="${tab === 'free'}" data-tab="free">Free</button>
                    <button type="button" role="tab" aria-selected="${tab === 'premium'}" data-tab="premium">Premium</button>
                    <button type="button" role="tab" aria-selected="${tab === 'chest'}" data-tab="chest">Chest</button>
                    <button type="button" role="tab" aria-selected="${tab === 'gifs'}" data-tab="gifs">GIFs</button>
                </div>
                ${pending ? `<div class="sticker-confirm"><img src="${stickerSrc(pending)}" alt="" width="56" height="56">
                    <p>Send <strong>${esc(stickerName(pending))}</strong> for ${coinImg(14)} <strong>${num(stickerCost(pending))}</strong> Yelis?<br><small>You have ${num(state.me.balance)}.</small></p>
                    <div class="row"><button type="button" class="btn btn-primary" data-send>Send</button><button type="button" class="btn btn-secondary" data-cancel>Cancel</button></div></div>`
                : tab === 'gifs' && !list.length ? `<p class="sticker-empty">${state.me ? 'Buy a picture in the gallery and you get it here as a GIF to send in chat.' : 'Log in to use your GIFs.'} <a href="#/gallery">Gallery</a></p>`
                : tab === 'chest' && !list.length ? '<p class="sticker-empty">Watch live streams for an hour to open your daily chest and find exclusive stickers. <a href="#/chest">Daily chest</a></p>'
                : `<div class="sticker-grid">${list.map((s) => `<button type="button" class="sticker-btn" data-sticker="${s.id}" aria-label="${esc(s.name)}${stickerCost(s.id) ? `, ${stickerCost(s.id)} Yelis` : ''}">
                        <img src="${stickerSrc(s.id)}" alt="" width="48" height="48">${stickerCost(s.id) ? `<span class="sticker-cost">${coinImg(11)}${stickerCost(s.id)}</span>` : ''}</button>`).join('')}</div>`}`;
        }

        toggle.addEventListener('click', () => {
            if (pop.hidden) {
                paintPop(); pop.hidden = false; toggle.setAttribute('aria-expanded', 'true');
                if (state.me) api('/gallery?scope=owned').then((g) => { state.myGifs = g.items; if (!pop.hidden && tab === 'gifs' && !pending) paintPop(); }).catch(() => {});
                if (state.me) api('/chest').then((c) => { state.chestStickers = c.collection.stickers; if (!pop.hidden && tab === 'chest' && !pending) paintPop(); }).catch(() => {});
            } else closePop();
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
