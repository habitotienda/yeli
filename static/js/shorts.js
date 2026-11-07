'use strict';

/* =========================================================================
   Shorts: the feed of vertical (9:16) videos, up to 3 minutes each.
   A video becomes a Short when its owner publishes it in the vertical format (see publish dialog in vods.js and
   yeli/vods.py). Here they play one at a time, full height, and you swipe or scroll to the next one.
   Route: #/shorts            (everyone)         #/shorts?channel=name   (one channel)       #/shorts?v=<id>  (start at one)
   ========================================================================= */
let shortsMuted = true; // browsers only start sound after a tap, so the feed begins muted and remembers what you choose

const SOUND_ON = '<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>';
const SOUND_OFF = '<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M16 9l5 6M21 9l-5 6"/>';
const PLAY_PATH = '<path d="M8 5l11 7-11 7z"/>';

function shortSlide(v) {
    return `
    <article class="short" data-id="${esc(v.id)}" aria-label="${esc(v.title)}">
        <div class="short-stage" style="--hue:${Number(v.hue)}">
            <video class="short-video" loop playsinline preload="none" poster="${v.cover ? esc(vodCoverSrc(v)) : ''}"
                   controlslist="nodownload" disablepictureinpicture disableremoteplayback></video>
            <button type="button" class="short-tap" data-short="toggle" aria-label="Play or pause"></button>
            <span class="short-pause" aria-hidden="true">${IC(PLAY_PATH, 'currentColor', 44)}</span>
            <div class="short-progress" aria-hidden="true"><i></i></div>
            <div class="short-info">
                <a class="short-author" href="${channelHref(v.username)}">${avatar(v, 'avatar-sm')}<strong translate="no">${esc(v.username)}</strong></a>
                <h2 class="short-title" translate="no">${esc(v.title)}</h2>
                ${v.description ? `<p class="short-desc" translate="no">${esc(v.description)}</p>` : ''}
            </div>
            <div class="short-rail">
                <button type="button" class="short-act${v.liked ? ' is-on' : ''}" data-short="like" aria-pressed="${v.liked}" aria-label="Like">
                    ${IC(HEART_PATH, v.liked ? 'currentColor' : 'none', 26)}<span class="short-count">${countText(v.likes)}</span>
                </button>
                <a class="short-act" href="${videoHref(v.id)}" aria-label="Comments">${IC(COMMENT_PATH, 'none', 26)}<span class="short-count">${countText(v.comment_count)}</span></a>
                <button type="button" class="short-act" data-short="share" aria-label="Share">${IC(SHARE_PATH, 'none', 26)}<span class="short-count">Share</span></button>
                <button type="button" class="short-act" data-short="sound" aria-label="Sound">${IC(shortsMuted ? SOUND_OFF : SOUND_ON, 'none', 26)}<span class="short-count">${shortsMuted ? 'Muted' : 'Sound'}</span></button>
            </div>
        </div>
    </article>`;
}

async function pageShorts(root, params, alive) {
    document.title = 'Shorts | Yeli';
    const channel = params.get('channel') || '';
    const start = params.get('v') || '';
    root.innerHTML = `<section class="shorts-page" aria-label="Shorts">
        ${channel ? `<div class="shorts-chan"><a class="btn btn-secondary" href="#/shorts">All Shorts</a><span translate="no">${esc(channel)}</span></div>` : ''}
        <div class="shorts-feed" id="shortsFeed" tabindex="0">${'<div class="short skeleton-short" aria-hidden="true"><div class="skeleton"></div></div>'}</div>
    </section>`;
    document.body.classList.add('shorts-open');
    onLeave(() => document.body.classList.remove('shorts-open'));

    const feed = $('#shortsFeed');
    let list = [];
    let offset = 0;
    let more = true;
    let loading = false;
    let current = null;

    const empty = () => {
        feed.innerHTML = `<div class="shorts-empty">${emptyState(channel ? 'No Shorts here yet' : 'No Shorts yet',
            'A vertical video (9:16) of up to 3 minutes becomes a Short when you publish it. Pick the vertical format in the video editor, then publish it from your clips.',
            state.me ? '<a class="btn btn-primary" href="#/clips">Go to my clips</a><a class="btn btn-secondary" href="#/editor">Open video editor</a>'
                : '<button type="button" class="btn btn-primary" data-auth="login">Log In</button>', 'broadcast')}</div>`;
    };

    const io = new IntersectionObserver((entries) => {
        for (const en of entries) {
            const slide = en.target;
            const video = slide.querySelector('video');
            if (en.isIntersecting && en.intersectionRatio >= 0.6) {
                current = slide;
                if (!video.src) video.src = `/api/vod/${encodeURIComponent(slide.dataset.id)}/video`;
                video.muted = shortsMuted;
                video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
                slide.classList.remove('is-paused');
                // the next one is fetched when you get to the last two
                if (more && !loading && slide === feed.children[feed.children.length - 2]) loadMore();
                else if (more && !loading && slide === feed.lastElementChild) loadMore();
            } else {
                video.pause();
                if (slide !== current) video.currentTime = 0;
            }
        }
    }, { root: feed, threshold: [0, 0.6, 1] });

    function addSlides(items) {
        const html = items.map(shortSlide).join('');
        feed.insertAdjacentHTML('beforeend', html);
        for (const v of items) {
            const slide = feed.querySelector(`.short[data-id="${v.id}"]`);
            const video = slide.querySelector('video');
            const bar = slide.querySelector('.short-progress i');
            video.addEventListener('timeupdate', () => { if (video.duration) bar.style.width = `${(video.currentTime / video.duration) * 100}%`; });
            video.addEventListener('error', () => {
                if (video.getAttribute('src') && !slide.querySelector('.short-error')) slide.querySelector('.short-stage').insertAdjacentHTML('beforeend', '<p class="short-error">This video can\u2019t be played.</p>');
            });
            io.observe(slide);
        }
    }

    async function loadMore() {
        if (loading || !more) return;
        loading = true;
        try {
            const r = await api(`/shorts?offset=${offset}${channel ? `&channel=${encodeURIComponent(channel)}` : ''}`);
            if (!alive()) return;
            offset = r.next_offset;
            more = r.more;
            const fresh = r.shorts.filter((v) => !list.some((x) => x.id === v.id));
            list = list.concat(fresh);
            if (!list.length) { empty(); return; }
            if (feed.querySelector('.skeleton-short')) feed.innerHTML = '';
            addSlides(fresh);
            if (!fresh.length && more) { loading = false; await loadMore(); }
        } catch (e) {
            if (alive() && !list.length) feed.innerHTML = `<div class="shorts-empty"><p class="form-error">${esc(e.message)}</p><button type="button" class="btn btn-primary" data-action="reload-route">Try again</button></div>`;
        } finally { loading = false; }
    }

    // one Short asked for by link goes first
    if (start) {
        try {
            const { video } = await api(`/vod/${encodeURIComponent(start)}`);
            if (alive() && video && video.is_short) { list.push(video); feed.innerHTML = ''; addSlides([video]); }
        } catch { /* it isn't available: the feed starts normally */ }
    }
    await loadMore();
    if (!alive()) return;

    const setSoundButton = (btn) => {
        btn.innerHTML = `${IC(shortsMuted ? SOUND_OFF : SOUND_ON, 'none', 26)}<span class="short-count">${shortsMuted ? 'Muted' : 'Sound'}</span>`;
    };

    const onClick = async (e) => {
        const b = e.target.closest('[data-short]');
        if (!b) return;
        const slide = b.closest('.short');
        const v = list.find((x) => x.id === slide.dataset.id);
        const video = slide.querySelector('video');
        const act = b.dataset.short;
        if (act === 'toggle') {
            if (video.paused) { video.play().catch(() => {}); slide.classList.remove('is-paused'); }
            else { video.pause(); slide.classList.add('is-paused'); }
        } else if (act === 'sound') {
            shortsMuted = !shortsMuted;
            feed.querySelectorAll('video').forEach((el) => { el.muted = shortsMuted; });
            feed.querySelectorAll('[data-short="sound"]').forEach(setSoundButton);
        } else if (act === 'share' && v) {
            openShareDialog({ title: v.title, text: `${v.title} | ${v.username} on Yeli`, url: `${location.origin}${location.pathname}#/shorts?v=${encodeURIComponent(v.id)}` });
        } else if (act === 'like' && v) {
            if (!state.me) { openAuth('login', 'Log in to like Shorts.'); return; }
            const want = !v.liked;
            b.disabled = true;
            try {
                const r = await api(`/vod/${encodeURIComponent(v.id)}/like`, { method: 'POST', body: { liked: want } });
                v.liked = r.liked;
                v.likes = r.likes;
                b.classList.toggle('is-on', r.liked);
                b.setAttribute('aria-pressed', String(r.liked));
                b.innerHTML = `${IC(HEART_PATH, r.liked ? 'currentColor' : 'none', 26)}<span class="short-count">${countText(r.likes)}</span>`;
            } catch (e2) { toast(e2.message); } finally { b.disabled = false; }
        }
    };
    root.addEventListener('click', onClick);

    // the arrow keys and Page Up/Down move one Short at a time
    const onKey = (e) => {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement && document.activeElement.tagName)) return;
        const dir = e.key === 'ArrowDown' || e.key === 'PageDown' ? 1 : e.key === 'ArrowUp' || e.key === 'PageUp' ? -1 : 0;
        if (!dir || !current) return;
        const to = dir > 0 ? current.nextElementSibling : current.previousElementSibling;
        if (to) { e.preventDefault(); to.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    };
    document.addEventListener('keydown', onKey);

    onLeave(() => {
        root.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onKey);
        io.disconnect();
        feed.querySelectorAll('video').forEach((el) => { el.pause(); el.removeAttribute('src'); el.load(); });
    });
}
