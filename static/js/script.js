'use strict';

/* =========================================================================
   Sidebar toggle
   ========================================================================= */
const menuBtn = document.querySelector('.menu-toggle-btn');
const sidebar = document.querySelector('.sidebar');

menuBtn.addEventListener('click', () => {
    const open = sidebar.classList.toggle('expanded');
    menuBtn.setAttribute('aria-expanded', String(open));
});

/* =========================================================================
   Helpers
   ========================================================================= */
const $ = (selector, root = document) => root.querySelector(selector);

const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const plural = (n, one, many) => `${Number(n).toLocaleString()} ${n === 1 ? one : many}`;

function fmtDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function uid() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const channelHref = (name) => `#/c/${encodeURIComponent(name)}`;

async function api(path, { method = 'GET', body, keepalive = false } = {}) {
    const options = { method, headers: {}, credentials: 'same-origin', keepalive };
    if (method !== 'GET') {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body ?? {});
    }
    let res;
    try {
        res = await fetch('/api' + path, options);
    } catch {
        const error = new Error('Can\u2019t reach the server. Check your connection.');
        error.status = 0;
        throw error;
    }
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
        const error = new Error(data.error || 'Something went wrong.');
        error.status = res.status;
        error.field = data.field;
        throw error;
    }
    return data;
}

let toastTimer = null;
function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

/* =========================================================================
   App state
   ========================================================================= */
const state = {
    me: null,
    following: [],
    config: { categories: [], iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
};

let broadcast = null; // the active broadcast (survives page navigation)

/* =========================================================================
   Router
   ========================================================================= */
let routeToken = 0;
let cleanups = [];
const onLeave = (fn) => cleanups.push(fn);

function runCleanups() {
    const fns = cleanups;
    cleanups = [];
    fns.forEach((fn) => { try { fn(); } catch (e) { console.warn(e); } });
}

/** Run `fn` now and then every `ms` while the current page is open and the tab is visible. */
function poll(fn, ms) {
    const id = setInterval(() => {
        if (!document.hidden) fn().catch(() => {});
    }, ms);
    onLeave(() => clearInterval(id));
}

function parseHash() {
    const raw = location.hash.slice(1) || '/';
    const [path, query = ''] = raw.split('?');
    return { path, params: new URLSearchParams(query) };
}

function setActiveNav(path) {
    document.querySelectorAll('[data-route]').forEach((el) => {
        const active = el.dataset.route === path;
        el.classList.toggle('active', active);
        if (active) el.setAttribute('aria-current', 'page');
        else el.removeAttribute('aria-current');
    });
    $('#followingNavIcon').src = path === '/following' ? 'static/svg/heart-filled.svg' : 'static/svg/heart.svg';
}

async function route(focus = false) {
    const token = ++routeToken;
    const alive = () => token === routeToken;
    runCleanups();
    hideSuggest();
    studioRoot = null;

    const { path, params } = parseHash();
    const isPopout = path.startsWith('/popout/');
    document.body.classList.toggle('popout', isPopout);
    document.body.classList.toggle('popout-overlay', isPopout && !!params.get('overlay'));
    const root = $('#view');
    setActiveNav(path);
    window.scrollTo(0, 0);
    if (focus) root.focus({ preventScroll: true });

    try {
        if (path === '/') await pageHome(root, alive);
        else if (path === '/explore') await pageExplore(root, params, alive);
        else if (path === '/following') await pageFollowing(root, alive);
        else if (path === '/search') await pageSearch(root, params, alive);
        else if (path === '/studio') pageStudio(root);
        else if (path === '/settings') await pageSettings(root, alive);
        else if (path === '/wallet') await pageWallet(root, alive, params);
        else if (path === '/bot') await pageBot(root, alive);
        else if (path.startsWith('/popout/')) pagePopout(root, decodeURIComponent(path.slice(8)), params);
        else if (path === '/admin') await pageAdmin(root, alive);
        else if (path.startsWith('/c/')) await pageChannel(root, decodeURIComponent(path.slice(3)), alive);
        else root.innerHTML = emptyState('Page not found', 'That page doesn\u2019t exist.', '<a class="btn btn-primary" href="#/">Back to Home</a>');
    } catch (e) {
        if (!alive()) return;
        root.innerHTML = emptyState('Something went wrong', esc(e.message), '<button type="button" class="btn btn-primary" data-action="reload-route">Try again</button>');
    }
}

window.addEventListener('hashchange', () => route(true));

/* =========================================================================
   Shared markup
   ========================================================================= */
function emptyState(title, text, actionHtml = '', icon = 'broadcast') {
    return `<div class="empty">
        <span class="empty-icon"><img src="static/svg/${icon}.svg" alt="" width="28" height="28"></span>
        <h2>${esc(title)}</h2><p>${text}</p>${actionHtml ? `<div class="empty-actions">${actionHtml}</div>` : ''}</div>`;
}

function skeletonGrid(n = 8) {
    const card = `<div class="skeleton-card" aria-hidden="true">
        <div class="skeleton skeleton-thumb"></div>
        <div class="stream-meta"><div class="skeleton skeleton-avatar"></div>
        <div class="skeleton-lines"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div></div></div></div>`;
    return `<div class="stream-grid" role="status" aria-label="Loading">${card.repeat(n)}</div>`;
}

function streamCard(c) {
    return `
    <a class="stream-card" href="${channelHref(c.username)}">
        <div class="stream-thumb" style="--hue:${Number(c.hue)}">
            <span class="thumb-initial" aria-hidden="true">${esc(c.username.charAt(0).toUpperCase())}</span>
            ${c.thumb ? `<img class="thumb-img" src="/api/thumb/${encodeURIComponent(c.username)}?v=${Number(c.thumb)}" alt="" loading="lazy">` : ''}
            <span class="badge-live">LIVE</span>
            <span class="badge-viewers">${plural(c.viewers, 'viewer', 'viewers')}</span>
        </div>
        <div class="stream-meta">
            ${avatar(c)}
            <div class="stream-text">
                <h3 class="stream-title">${esc(c.title)}</h3>
                <p class="stream-channel">${esc(c.username)}</p>
                <p class="stream-cat"><span class="chip-static">${esc(c.category)}</span></p>
            </div>
        </div>
    </a>`;
}

document.addEventListener('error', (e) => {
    if (e.target.classList && e.target.classList.contains('thumb-img')) e.target.remove();
}, true);

function channelCard(c) {
    return `
    <a class="channel-card" href="${channelHref(c.username)}">
        ${avatar(c, 'avatar-md')}
        <div class="stream-text">
            <h3 class="stream-title">${esc(c.username)}</h3>
            <p class="stream-channel">${plural(c.followers, 'follower', 'followers')}</p>
        </div>
    </a>`;
}

const streamGrid = (list) => `<div class="stream-grid">${list.map(streamCard).join('')}</div>`;
const channelGrid = (list) => `<div class="channel-grid">${list.map(channelCard).join('')}</div>`;

const goLiveAction = () =>
    state.me
        ? '<a class="btn btn-primary" href="#/studio">Go live</a>'
        : '<button type="button" class="btn btn-primary" data-auth="signup">Sign Up</button>';

/** Re-render only when the data changed, so polling doesn't make the page flicker. */
function painter(el) {
    let last = '';
    return (key, html) => {
        if (key === last) return;
        last = key;
        el.innerHTML = html;
    };
}

/* =========================================================================
   Pages: Home, Explore, Following, Search
   ========================================================================= */
async function pageHome(root, alive) {
    document.title = 'Yeli | Streaming App';
    root.innerHTML = `
        ${state.me ? '' : `
        <section class="banner">
            <div>
                <h1 class="banner-title">Watch anything, live.</h1>
                <p>Follow the channels you like and get them in your sidebar the moment they go live. Make a free account to start streaming yourself.</p>
            </div>
            <div class="banner-actions">
                <button type="button" class="btn btn-primary btn-lg" data-auth="signup">Sign Up</button>
                <button type="button" class="btn btn-secondary btn-lg" data-auth="login">Log In</button>
            </div>
        </section>`}
        <div class="page-head"><h1 class="page-title">${state.me ? 'Live now' : 'Streaming right now'}</h1><p class="page-sub" id="homeCount"></p></div>
        <div id="homeBody">${skeletonGrid(8)}</div>`;
    const body = painter($('#homeBody'));
    const count = $('#homeCount');

    const load = async () => {
        const [{ streams }, { channels: rec }] = await Promise.all([api('/live'), api('/recommended')]);
        if (!alive()) return;
        count.textContent = streams.length ? `${plural(streams.length, 'channel', 'channels')} streaming` : '';
        const followed = new Set(state.following.map((c) => c.username));
        const recNames = new Set(rec.map((c) => c.username));
        const mine = streams.filter((c) => followed.has(c.username) && !recNames.has(c.username));
        const rest = streams.filter((c) => !followed.has(c.username) && !recNames.has(c.username));
        let html;
        if (!streams.length) {
            html = emptyState(
                'Nobody is live right now',
                state.me ? 'Start a stream and it will show up here.' : 'Create an account to start streaming, or check back soon.',
                goLiveAction()
            );
        } else {
            html = mine.length ? `<section class="section"><h2 class="section-title">From channels you follow</h2>${streamGrid(mine)}</section>` : '';
            if (rest.length) html += `<section class="section">${mine.length ? '<h2 class="section-title">More live channels</h2>' : ''}${streamGrid(rest)}</section>`;
        }
        if (rec.length) html = `<section class="section"><h2 class="section-title">Recommended</h2><div class="stream-grid">${rec.map((c) => (c.live ? streamCard(c) : channelCard(c))).join('')}</div></section>` + (html && streams.length ? html : '');
        body(JSON.stringify([streams, rec, [...followed]]), html);
    };
    await load();
    poll(load, 15000);
}

async function pageExplore(root, params, alive) {
    const cat = params.get('cat') || '';
    document.title = `${cat || 'Explore'} | Yeli`;
    root.innerHTML = `
        <div class="page-head"><h1 class="page-title">${cat ? esc(cat) : 'Explore'}</h1></div>
        <nav class="chips" id="chips" aria-label="Categories"></nav>
        <div id="exploreBody">${skeletonGrid(4)}</div>`;
    const chips = painter($('#chips'));
    const body = painter($('#exploreBody'));

    const load = async () => {
        const [cats, live, chans] = await Promise.all([
            api('/categories'),
            api('/live' + (cat ? `?category=${encodeURIComponent(cat)}` : '')),
            cat ? Promise.resolve(null) : api('/channels'),
        ]);
        if (!alive()) return;

        chips(JSON.stringify([cats, cat]), [
            `<a class="chip" href="#/explore" ${!cat ? 'aria-current="true"' : ''}>All</a>`,
            ...cats.categories.map((c) => `
                <a class="chip" href="#/explore?cat=${encodeURIComponent(c.name)}" ${c.name === cat ? 'aria-current="true"' : ''}>
                    ${esc(c.name)}${c.live ? `<span class="chip-count">${c.live}</span>` : ''}
                </a>`),
        ].join(''));

        let html = `<section class="section"><h2 class="section-title">${cat ? `Live in ${esc(cat)}` : 'Live now'}</h2>`;
        html += live.streams.length
            ? streamGrid(live.streams)
            : `<p class="muted">${cat ? `Nobody is live in ${esc(cat)} right now.` : 'Nobody is live right now.'}</p>`;
        html += '</section>';

        if (chans) {
            const others = chans.channels.filter((c) => !c.live);
            html += `<section class="section"><h2 class="section-title">Channels</h2>${
                others.length ? channelGrid(others) : '<p class="muted">No other channels yet. Create an account to be the first.</p>'}</section>`;
        }
        body(JSON.stringify([live, chans]), html);
    };
    await load();
    poll(load, 15000);
}

async function pageFollowing(root, alive) {
    document.title = 'Following | Yeli';
    if (!state.me) {
        root.innerHTML = emptyState(
            'Log in to see who you follow',
            'Follow channels and they appear here, live ones first.',
            '<button type="button" class="btn btn-primary" data-auth="login">Log In</button>',
            'heart'
        );
        return;
    }
    root.innerHTML = `<div class="page-head"><h1 class="page-title">Following</h1></div><div id="followBody">${skeletonGrid(4)}</div>`;
    const body = painter($('#followBody'));

    const load = async () => {
        const { channels } = await api('/following');
        if (!alive()) return;
        const live = channels.filter((c) => c.live);
        const offline = channels.filter((c) => !c.live);
        let html = '';
        if (!channels.length) {
            html = emptyState('You\u2019re not following anyone yet', 'Find channels you like and tap Follow.', '<a class="btn btn-primary" href="#/explore">Explore channels</a>', 'heart');
        } else {
            html += `<section class="section"><h2 class="section-title">Live now</h2>${
                live.length ? streamGrid(live) : '<p class="muted">None of your channels are live right now.</p>'}</section>`;
            if (offline.length) html += `<section class="section"><h2 class="section-title">Offline</h2>${channelGrid(offline)}</section>`;
        }
        body(JSON.stringify(channels), html);
    };
    await load();
    poll(load, 15000);
}

async function pageSearch(root, params, alive) {
    const q = (params.get('q') || '').trim();
    document.title = `${q || 'Search'} | Yeli`;
    $('#searchInput').value = q;
    if (!q) {
        root.innerHTML = emptyState('Search Yeli', 'Look for a channel name, a stream title or a category.', '', 'search');
        return;
    }
    root.innerHTML = `<div class="page-head"><h1 class="page-title">Results for \u201c${esc(q)}\u201d</h1></div><div id="searchBody">${skeletonGrid(4)}</div>`;
    const body = painter($('#searchBody'));

    const load = async () => {
        const { results } = await api(`/search?q=${encodeURIComponent(q)}`);
        if (!alive()) return;
        const live = results.filter((c) => c.live);
        const offline = results.filter((c) => !c.live);
        let html = '';
        if (!results.length) {
            html = emptyState('No matches', `Nothing matched \u201c${esc(q)}\u201d. Try a shorter name or browse by category.`, '<a class="btn btn-primary" href="#/explore">Explore</a>', 'search');
        } else {
            if (live.length) html += `<section class="section"><h2 class="section-title">Live now</h2>${streamGrid(live)}</section>`;
            if (offline.length) html += `<section class="section"><h2 class="section-title">Channels</h2>${channelGrid(offline)}</section>`;
        }
        body(JSON.stringify(results), html);
    };
    await load();
    poll(load, 20000);
}

/* =========================================================================
   Channel page: watch a stream (WebRTC viewer)
   ========================================================================= */
function createWatcher(username, video, cb) {
    const peer = uid();
    const path = `/watch/${encodeURIComponent(username)}`;
    let pc = null;
    let after = 0;
    let stopped = false;
    let connected = false;
    let timer = null;
    let pending = [];

    const send = (kind, payload) =>
        api(`${path}/signal`, { method: 'POST', body: { peer, kind, payload } }).catch(() => {});

    function closePc() {
        if (pc) { pc.onicecandidate = pc.ontrack = pc.onconnectionstatechange = null; pc.close(); pc = null; }
        pending = [];
    }

    function tryPlay() {
        const p = video.play();
        if (p && p.catch) {
            p.catch(() => {
                video.dataset.noPersist = '1';
                video.muted = true;
                video.play().then(() => cb.status('blocked')).catch(() => {});
            });
        }
    }

    async function handle(sig) {
        if (sig.kind === 'offer') {
            closePc();
            pc = new RTCPeerConnection({ iceServers: state.config.iceServers });
            pc.ontrack = (e) => {
                if (video.srcObject !== e.streams[0]) video.srcObject = e.streams[0];
                tryPlay();
            };
            pc.onicecandidate = (e) => { if (e.candidate) send('candidate', e.candidate.toJSON()); };
            pc.onconnectionstatechange = () => {
                if (!pc) return;
                const s = pc.connectionState;
                if (s === 'connected') { connected = true; cb.status('playing'); }
                else if (s === 'disconnected') cb.status('reconnecting');
                else if (s === 'failed') { connected = false; cb.status('failed'); }
            };
            await pc.setRemoteDescription(sig.payload);
            for (const c of pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            send('answer', { type: pc.localDescription.type, sdp: pc.localDescription.sdp });
        } else if (sig.kind === 'candidate') {
            if (pc && pc.remoteDescription) await pc.addIceCandidate(sig.payload).catch(() => {});
            else pending.push(sig.payload);
        }
    }

    async function join() {
        connected = false;
        cb.status('connecting');
        try {
            await api(`${path}/join`, { method: 'POST', body: { peer } });
            return true;
        } catch (e) {
            stopped = true;
            if (e.status === 429) cb.status('full');
            else if (e.status === 404) cb.ended();
            else cb.status('failed');
            return false;
        }
    }

    async function tick() {
        if (stopped) return;
        let delay = connected ? 5000 : 700;
        try {
            const r = await api(`${path}/poll?peer=${peer}&after=${after}`);
            if (stopped) return;
            if (!r.live) { stopped = true; cb.ended(); return; }
            if (r.superseded) { stopped = true; closePc(); cb.superseded(); return; }
            if (!r.joined) {
                if (!(await join())) return;
            } else {
                for (const s of r.signals) {
                    after = Math.max(after, s.id);
                    await handle(s).catch((e) => console.warn('signal error', e));
                }
                if (cb.viewers) cb.viewers(r.viewers);
            }
        } catch (e) {
            if (e.status === 404) { stopped = true; cb.ended(); return; }
        }
        timer = setTimeout(tick, delay);
    }

    (async () => {
        if (await join()) tick();
    })();

    return {
        setQuality(height) {
            if (!stopped) send('quality', { height });
        },
        stop() {
            if (stopped && !pc) return;
            stopped = true;
            clearTimeout(timer);
            closePc();
            api(`${path}/leave`, { method: 'POST', body: { peer }, keepalive: true }).catch(() => {});
        },
    };
}

function channelMarkup(ch) {
    return `
    <div class="channel-layout">
        <div class="channel">
            <div class="player" id="player">
                <video id="video" playsinline autoplay hidden></video>
                <div class="player-overlay" id="overlay"></div>
                <button type="button" class="unmute-btn" id="unmuteBtn" hidden>Tap to unmute</button>
            </div>
            <div class="channel-head">
                ${avatar(ch, 'avatar-lg')}
                <div class="channel-titles">
                    <h1 class="channel-title" id="chTitle"></h1>
                    <p class="channel-line" id="chLine"></p>
                </div>
                <div class="channel-actions" id="chActions"></div>
            </div>
            <p class="channel-stats" id="chStats"></p>
            <section class="donate" id="chDonate" aria-label="Support this channel">
                <p class="donate-label" id="chDonateLabel"></p>
                <button type="button" class="btn btn-yelis" id="chDonateBtn">${coinImg(18)}<span>Send Yelis</span></button>
            </section>
            <section class="channel-about">
                <h2 class="section-title">About</h2>
                <p id="chBio"></p>
                <p class="muted" id="chJoined"></p>
            </section>
        </div>
        <aside class="channel-chat" id="chatPanel"></aside>
    </div>`;
}

async function pageChannel(root, name, alive) {
    let ch;
    try {
        ch = (await api(`/channel/${encodeURIComponent(name)}`)).channel;
    } catch (e) {
        if (e.status !== 404) throw e;
        document.title = 'Channel not found | Yeli';
        root.innerHTML = emptyState('Channel not found', `There\u2019s no channel called \u201c${esc(name)}\u201d.`, '<a class="btn btn-primary" href="#/explore">Explore channels</a>', 'explore');
        return;
    }
    if (!alive()) return;
    document.title = `${ch.username} | Yeli`;
    root.innerHTML = channelMarkup(ch);

    const player = $('#player');
    const video = $('#video');
    const overlay = $('#overlay');
    const unmuteBtn = $('#unmuteBtn');
    let watcher = null;

    // Quality choices exist only in peer-to-peer mode; a media server forwards a single stream.
    const controls = createPlayerControls(player, video, {
        live: true,
        quality: ch.mode === 'sfu' ? null : { onChange: (h) => { if (watcher) watcher.setQuality(h); } },
    });
    const chat = createChat($('#chatPanel'), ch.username, { isOwner: ch.is_me });
    onLeave(() => { controls.destroy(); chat.destroy(); });

    function setOverlay(kind) {
        const showVideo = kind === 'playing' || kind === 'reconnecting';
        video.hidden = !showVideo;
        overlay.hidden = kind === 'playing';
        overlay.className = 'player-overlay' + (kind === 'reconnecting' ? ' is-dim' : '');
        const retry = '<button type="button" class="btn btn-primary" data-retry>Try again</button>';
        const html = {
            connecting: '<div><div class="spinner" aria-hidden="true"></div><p>Connecting to the stream\u2026</p></div>',
            reconnecting: '<div><div class="spinner" aria-hidden="true"></div><p>Reconnecting\u2026</p></div>',
            failed: `<div><p class="overlay-title">Couldn\u2019t connect to the stream</p><p>Your network may be blocking peer-to-peer video.</p>${retry}</div>`,
            full: `<div><p class="overlay-title">This stream is full right now</p><p>Try again in a moment.</p>${retry}</div>`,
            elsewhere: `<div><p class="overlay-title">You\u2019re watching in another tab</p><p>Each account watches a stream in one place at a time.</p><button type="button" class="btn btn-primary" data-retry>Watch here instead</button></div>`,
            offline: `<div>${avatar(ch, 'avatar-lg')}<p class="overlay-title">${esc(ch.username)} is offline</p>${
                ch.is_me ? '<a class="btn btn-primary" href="#/studio">Go live</a>' : '<p>Follow this channel to see it in your sidebar when it goes live.</p>'}</div>`,
            playing: '',
        }[kind] || '';
        overlay.innerHTML = html;
        const retryBtn = overlay.querySelector('[data-retry]');
        if (retryBtn) retryBtn.addEventListener('click', startWatch);
    }

    function stopWatch() {
        if (watcher) { watcher.stop(); watcher = null; }
        video.srcObject = null;
        unmuteBtn.hidden = true;
    }

    function startWatch() {
        stopWatch();
        // Watching your own live channel: show the local preview instead of connecting to yourself.
        if (ch.is_me && broadcast && broadcast.stream) {
            video.dataset.noPersist = '1';
            video.srcObject = broadcast.stream;
            video.muted = true;
            video.play().catch(() => {});
            setOverlay('playing');
            return;
        }
        setOverlay('connecting');
        watcher = (ch.mode === 'sfu' ? createSfuWatcher : createWatcher)(ch.username, video, {
            status(s) {
                if (s === 'blocked') { unmuteBtn.hidden = false; return; }
                if (s === 'playing' && controls.getQuality()) watcher.setQuality(controls.getQuality());
                setOverlay(s);
            },
            ended() {
                stopWatch();
                ch.live = false;
                paintInfo();
                setOverlay('offline');
            },
            superseded() {
                stopWatch();
                setOverlay('elsewhere');
            },
            viewers(n) {
                ch.viewers = n;
                paintStats();
            },
        });
    }

    unmuteBtn.addEventListener('click', () => {
        delete video.dataset.noPersist;
        video.muted = false;
        unmuteBtn.hidden = true;
    });

    function paintStats() {
        const parts = [plural(ch.followers, 'follower', 'followers')];
        if (ch.live) {
            parts.push(plural(ch.viewers, 'viewer', 'viewers') + ' watching');
            if (ch.started_at) parts.push('Live for ' + fmtDuration(Date.now() - ch.started_at * 1000));
        }
        $('#chStats').innerHTML = parts.map((t) => `<span>${esc(t)}</span>`).join('');
    }

    function paintInfo() {
        $('#chTitle').textContent = ch.live ? ch.title : ch.username;
        $('#chLine').innerHTML = ch.live
            ? `<span class="badge-live">LIVE</span><span class="stream-channel">${esc(ch.username)}</span><span class="chip-static">${esc(ch.category)}</span>`
            : '<span class="muted">Offline</span>';
        $('#chBio').textContent = ch.bio || (ch.is_me ? 'You haven\u2019t written a bio yet.' : 'This channel has no bio yet.');
        $('#chJoined').textContent = `Joined ${new Date(ch.joined * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}`;
        paintStats();
        $('#chDonate').hidden = ch.is_me;
        $('#chDonateLabel').textContent = `Support ${ch.username} with Yelis, or send a sticker in chat.`;
        const share = '<button type="button" class="btn btn-secondary" id="shareBtn">Share</button>';
        $('#chActions').innerHTML = share + (ch.is_me
            ? `<a class="btn btn-secondary" href="#/settings">Edit profile</a><a class="btn btn-primary" href="#/studio">${broadcast ? 'Open studio' : 'Go live'}</a>`
            : `<button type="button" class="btn ${ch.following ? 'btn-secondary is-following' : 'btn-primary'}" id="followBtn" aria-pressed="${ch.following}">
                   <img src="static/svg/${ch.following ? 'heart-filled' : 'heart'}.svg" alt="" width="16" height="16">${ch.following ? 'Following' : 'Follow'}
               </button>`);
    }

    function applyInfo(next) {
        const modeChanged = next.live && ch.live && next.mode !== ch.mode;
        ch = { ...ch, ...next };
        if (modeChanged) { route(); return; } // the streamer switched between media server and peer-to-peer
        paintInfo();
        if (ch.live && !watcher && !overlay.querySelector('[data-retry]') && !(ch.is_me && broadcast && broadcast.stream && video.srcObject)) startWatch();
        else if (!ch.live) {
            if (watcher) stopWatch();
            setOverlay('offline');
        }
    }

    $('#chDonateBtn').addEventListener('click', () => openDonate(ch.username));

    $('#chActions').addEventListener('click', async (e) => {
        if (e.target.closest('#shareBtn')) {
            try { await navigator.clipboard.writeText(location.href); toast('Link copied.'); }
            catch { toast('Copy the link from your address bar.'); }
            return;
        }
        const btn = e.target.closest('#followBtn');
        if (!btn) return;
        if (!state.me) { openAuth('login', `Log in to follow ${ch.username}.`); return; }
        btn.disabled = true;
        try {
            const r = await api(`/follow/${encodeURIComponent(ch.username)}`, { method: 'POST', body: { follow: !ch.following } });
            ch.following = r.following;
            ch.followers = r.followers;
            paintInfo();
            refreshSidebar();
        } catch (err) {
            btn.disabled = false;
            toast(err.message);
        }
    });

    paintInfo();
    if (ch.live) startWatch(); else setOverlay('offline');
    const uptime = setInterval(() => { if (ch.live) paintStats(); }, 1000);
    onLeave(() => clearInterval(uptime));

    poll(async () => {
        const next = (await api(`/channel/${encodeURIComponent(name)}`)).channel;
        if (alive()) applyInfo(next);
    }, 10000);
    onLeave(stopWatch);
}

/* =========================================================================
   Header: account area
   ========================================================================= */
function renderAuth() {
    const box = $('#authActions');
    if (!state.me) {
        box.innerHTML = `
            <button type="button" class="btn btn-secondary" data-auth="login">Log In</button>
            <button type="button" class="btn btn-primary" data-auth="signup">Sign Up</button>`;
        return;
    }
    const liveBtn = broadcast
        ? '<a class="live-pill" href="#/studio"><span class="live-dot" aria-hidden="true"></span>You\u2019re live</a>'
        : '<a class="btn btn-primary btn-icon" href="#/studio"><img src="static/svg/broadcast.svg" alt="" width="18" height="18">Go live</a>';
    box.innerHTML = `
        <a class="coin-chip" href="#/wallet" aria-label="Your wallet: ${Number(state.me.balance || 0).toLocaleString()} Yelis" title="Your wallet">${coinImg(18)}<span>${Number(state.me.balance || 0).toLocaleString()}</span></a>
        ${liveBtn}
        <div class="user-menu">
            <button type="button" class="user-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Account menu for ${esc(state.me.username)}">
                ${avatar(state.me, 'avatar-md')}
            </button>
            <div class="user-dropdown" role="menu" hidden>
                <p class="user-name">${esc(state.me.username)}</p>
                <a role="menuitem" href="${channelHref(state.me.username)}">My channel</a>
                <a role="menuitem" href="#/wallet">Wallet</a>
                <a role="menuitem" href="#/wallet?tab=upgrades">Upgrades</a>
                <a role="menuitem" href="#/bot">Bot &amp; chat</a>
                <a role="menuitem" href="#/settings">Edit profile</a>
                ${state.me.is_admin ? '<a role="menuitem" href="#/admin">Admin</a>' : ''}
                <a role="menuitem" href="#/following">Following</a>
                <button type="button" role="menuitem" data-action="logout">Log out</button>
            </div>
        </div>`;
}

function closeUserMenu() {
    const btn = $('.user-btn');
    const menu = $('.user-dropdown');
    if (btn && menu) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
}

/* =========================================================================
   Sidebar: my channel + followed channels
   ========================================================================= */
async function refreshSidebar() {
    if (state.me) {
        try { state.following = (await api('/following')).channels; } catch { /* keep the old list */ }
    } else {
        state.following = [];
    }
    renderSidebar();
}

function renderSidebar() {
    const mine = $('#sidebarMine');
    const list = $('#sidebarFollowing');
    $('#mineDivider').hidden = !state.me;
    mine.hidden = !state.me;
    $('#followingDivider').hidden = !state.me || !state.following.length;

    if (state.me) {
        mine.innerHTML = `
            <a href="#/studio" class="sidebar-item" data-route="/studio" aria-label="Go live">
                <img src="static/svg/broadcast.svg" alt="" aria-hidden="true">
                <span class="item-text">Go live</span>
            </a>
            <a href="${channelHref(state.me.username)}" class="sidebar-circle-wrapper" aria-label="My channel">
                <span class="sidebar-circle">${avatar(state.me)}</span>
                <span class="item-text">My channel</span>
            </a>`;
    } else {
        mine.innerHTML = '';
    }

    list.innerHTML = (state.following.length ? '<p class="sidebar-label">Following</p>' : '') + state.following.map((c) => `
        <a href="${channelHref(c.username)}" class="sidebar-circle-wrapper" title="${esc(c.username)}${c.live ? ' (live)' : ''}" aria-label="${esc(c.username)}${c.live ? ', live' : ''}">
            <span class="sidebar-circle">${avatar(c)}${c.live ? '<i class="live-dot-badge" aria-hidden="true"></i>' : ''}</span>
            <span class="item-text">${esc(c.username)}</span>
        </a>`).join('');
    setActiveNav(parseHash().path);
}

/* =========================================================================
   Search box with suggestions
   ========================================================================= */
const searchForm = $('#searchForm');
const searchInput = $('#searchInput');
const suggestBox = $('#searchSuggest');
let suggestTimer = null;
let suggestSeq = 0;

function hideSuggest() {
    suggestBox.hidden = true;
    suggestBox.innerHTML = '';
    searchInput.setAttribute('aria-expanded', 'false');
}

function showSuggest(results, q) {
    const rows = results.map((c) => `
        <a role="option" class="suggest-row" href="${channelHref(c.username)}">
            ${avatar(c, 'avatar-sm')}
            <span class="suggest-name">${esc(c.username)}</span>
            ${c.live ? `<span class="badge-live badge-small">LIVE</span><span class="suggest-sub">${esc(c.title)}</span>` : `<span class="suggest-sub">${plural(c.followers, 'follower', 'followers')}</span>`}
        </a>`).join('');
    suggestBox.innerHTML = rows + `<a role="option" class="suggest-row suggest-all" href="#/search?q=${encodeURIComponent(q)}">Search for \u201c${esc(q)}\u201d</a>`;
    suggestBox.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
}

searchInput.addEventListener('input', () => {
    clearTimeout(suggestTimer);
    const q = searchInput.value.trim();
    if (!q) { suggestSeq++; hideSuggest(); return; }
    suggestTimer = setTimeout(async () => {
        const seq = ++suggestSeq;
        try {
            const { results } = await api(`/search?q=${encodeURIComponent(q)}&limit=6`);
            if (seq === suggestSeq && searchInput.value.trim() === q) showSuggest(results, q);
        } catch { /* suggestions are optional */ }
    }, 180);
});

searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideSuggest();
});

searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    if (!q) return;
    suggestSeq++;
    hideSuggest();
    const target = `#/search?q=${encodeURIComponent(q)}`;
    if (location.hash === target) route(true); else location.hash = target;
});

/* =========================================================================
   Auth dialog
   ========================================================================= */
const authDialog = $('#authDialog');
const authForm = $('#authForm');

function openAuth(mode = 'login', note = '') {
    const login = mode === 'login';
    $('#authTitle').textContent = login ? 'Log in to Yeli' : 'Create your account';
    authForm.dataset.mode = mode;
    authForm.innerHTML = `
        ${note ? `<p class="form-note">${esc(note)}</p>` : ''}
        ${login ? `
            <div class="field"><label for="auId">Username or email</label>
                <input id="auId" name="identifier" autocomplete="username" required></div>
            <div class="field"><label for="auPw">Password</label>
                <input id="auPw" name="password" type="password" autocomplete="current-password" required></div>`
        : `
            <div class="field"><label for="auUser">Username</label>
                <input id="auUser" name="username" autocomplete="username" minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" required>
                <small>3 to 20 letters, numbers or underscores.</small></div>
            <div class="field"><label for="auEmail">Email</label>
                <input id="auEmail" name="email" type="email" autocomplete="email" required></div>
            <div class="field"><label for="auPw">Password</label>
                <input id="auPw" name="password" type="password" autocomplete="new-password" minlength="8" required>
                <small>At least 8 characters.</small></div>`}
        <p class="form-error" role="alert" hidden></p>
        <button type="submit" class="btn btn-primary btn-block">${login ? 'Log In' : 'Sign Up'}</button>`;
    $('#authSwitch').innerHTML = login
        ? 'New to Yeli? <button type="button" class="link-btn" data-auth="signup">Sign up</button>'
        : 'Already have an account? <button type="button" class="link-btn" data-auth="login">Log in</button>';
    if (!authDialog.open) authDialog.showModal();
    authForm.querySelector('input').focus();
}

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = authForm.dataset.mode;
    const body = Object.fromEntries(new FormData(authForm));
    const errEl = authForm.querySelector('.form-error');
    const btn = authForm.querySelector('button[type="submit"]');
    errEl.hidden = true;
    btn.disabled = true;
    try {
        const r = await api(mode === 'login' ? '/login' : '/register', { method: 'POST', body });
        state.me = r.user;
        authDialog.close();
        toast(mode === 'login' ? `Welcome back, ${r.user.username}.` : `Welcome to Yeli, ${r.user.username}.`);
        renderAuth();
        await refreshSidebar();
        route();
    } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
        if (err.field) { const f = authForm.querySelector(`[name="${err.field}"]`); if (f) f.focus(); }
    } finally {
        btn.disabled = false;
    }
});

authDialog.addEventListener('click', (e) => { if (e.target === authDialog) authDialog.close(); });

async function logout() {
    if (broadcast) await stopBroadcast();
    closeSession();
    try { await api('/logout', { method: 'POST' }); } catch { /* the session is cleared client-side anyway */ }
    state.me = null;
    state.following = [];
    renderAuth();
    renderSidebar();
    if (location.hash && location.hash !== '#/') location.hash = '#/'; else route();
}

/* =========================================================================
   Global click handling
   ========================================================================= */
document.addEventListener('click', (e) => {
    const authBtn = e.target.closest('[data-auth]');
    if (authBtn) { openAuth(authBtn.dataset.auth); return; }

    const action = e.target.closest('[data-action]');
    if (action) {
        const name = action.dataset.action;
        if (name === 'close-auth') authDialog.close();
        else if (name === 'logout') { closeUserMenu(); logout(); }
        else if (name === 'reload-route') route();
        return;
    }

    const userBtn = e.target.closest('.user-btn');
    if (userBtn) {
        const menu = $('.user-dropdown');
        const open = menu.hidden;
        menu.hidden = !open;
        userBtn.setAttribute('aria-expanded', String(open));
        return;
    }
    if (!e.target.closest('.user-dropdown')) closeUserMenu();
    else if (e.target.closest('a')) closeUserMenu();

    if (!e.target.closest('#searchForm')) hideSuggest();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeUserMenu();
});

/* If the tab is closed or reloaded, don't leave a ghost stream behind. */
window.addEventListener('pagehide', () => {
    if (broadcast) api('/stream/stop', { method: 'POST', keepalive: true }).catch(() => {});
    runCleanups();
});

/* =========================================================================
   Boot
   ========================================================================= */
(async function init() {
    try {
        const r = await api('/me');
        state.me = r.user;
        state.config = r.config;
    } catch { /* the app still works as a guest */ }
    if (state.config.demo) {
        const bar = document.createElement('div');
        bar.className = 'demo-banner';
        bar.setAttribute('role', 'note');
        bar.textContent = 'Demo server: accounts, Yelis and chats can be reset whenever the server restarts.';
        document.body.prepend(bar);
    }
    renderAuth();
    await refreshSidebar();
    route();
    setInterval(() => { if (!document.hidden && state.me) refreshSidebar(); }, 30000);
})();
