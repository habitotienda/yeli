'use strict';

/* =========================================================================
   Saved streams: the "Videos" section of a channel, the video page, and the one-time edit
   (cover, title and description). The server side is yeli/vods.py.
   ========================================================================= */
const editorHref = (id) => (id ? `#/editor/${encodeURIComponent(id)}` : '#/editor');
const videoHref = (id) => `#/video/${encodeURIComponent(id)}`;
const vodCoverSrc = (v) => `/api/vod/${encodeURIComponent(v.id)}/cover?v=${Number(v.cover)}`;
const vodDate = (t) => new Date(t * 1000).toLocaleDateString(window.YELI_LANG, { year: 'numeric', month: 'short', day: 'numeric' });

const IC = (path, fill = 'none', size = 17) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="${fill}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const HEART_PATH = '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>';
const COMMENT_PATH = '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.7-.9L3 21l1.9-5.3A8.4 8.4 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z"/>';
const SHARE_PATH = '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4M12 2v13"/>';
const EDIT_PATH = '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>';
const FILM_PATH = '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>';
const GLOBE_PATH = '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>';
const LOCK_PATH = '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';
const DOTS_PATH = '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>';
const USERS_PATH = '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>';
const CHECK_PATH = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';
const TRASH_PATH = '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3"/>';

const countText = (n) => Number(n || 0).toLocaleString(window.YELI_LANG);

/** "3 minutes ago", in the language of the page */
function vodAgo(t) {
    const secs = Math.round(t - Date.now() / 1000);
    const rtf = new Intl.RelativeTimeFormat(window.YELI_LANG, { numeric: 'auto' });
    for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
        if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit);
    }
    return rtf.format(0, 'second');
}

function videoCard(v) {
    return `
    <a class="stream-card vod-card" href="${videoHref(v.id)}">
        <div class="stream-thumb" style="--hue:${Number(v.hue)}">
            <span class="thumb-initial" aria-hidden="true">${esc(v.username.charAt(0).toUpperCase())}</span>
            ${v.cover ? `<img class="thumb-img" src="${vodCoverSrc(v)}" alt="" loading="lazy">` : ''}
            <span class="badge-viewers badge-duration">${fmtDuration(v.duration * 1000)}</span>
        </div>
        <div class="stream-meta">
            <div class="stream-text">
                <h3 class="stream-title">${esc(v.title)}</h3>
                <p class="stream-channel">${esc(vodDate(v.started_at))}</p>
                ${v.is_clip ? '' : `<p class="vod-stats" aria-hidden="true"><span>${IC(HEART_PATH)}${countText(v.likes)}</span><span>${IC(COMMENT_PATH)}${countText(v.comment_count)}</span></p>`}
                <p class="stream-cat">${v.is_clip ? `<span class="chip-static chip-clip">${IC(LOCK_PATH, 'none', 12)} Private clip</span>` : `<span class="chip-static">${esc(v.category)}</span>${v.visibility === 'followers' ? ` <span class="chip-static chip-clip">${IC(USERS_PATH, 'none', 12)} Followers only</span>` : ''}`}${v.source === 'edit' ? ' <span class="chip-static chip-edit">Edited</span>' : ''}</p>
            </div>
        </div>
    </a>`;
}

/** Fills the "Videos" section of a channel page. Returns { reload(delayMs) }. */
function mountChannelVideos(section, username, isMe, alive) {
    const body = section.querySelector('.vods-body');
    let timer = null;
    let dead = false;
    async function load() {
        try {
            const r = await api(`/channel/${encodeURIComponent(username)}/videos`);
            if (dead || !alive()) return;
            section.hidden = !r.videos.length && !isMe;
            body.innerHTML = r.videos.length
                ? `<div class="stream-grid vod-grid">${r.videos.map(videoCard).join('')}</div>`
                : '<p class="muted">Streams you finish are saved as private clips. Publish one from your clips and it shows up here.</p>';
        } catch {
            if (!dead) section.hidden = true;
        }
    }
    load();
    onLeave(() => { dead = true; clearTimeout(timer); });
    return { reload(delay = 0) { clearTimeout(timer); timer = setTimeout(load, delay); } };
}

/** The cover is a 16:9 picture, cropped from the middle, small enough for the server (80 KB). */
async function fileToCoverDataUrl(file) {
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
    if (file.size > 10 * 1024 * 1024) throw new Error('That image is too large. The limit is 10 MB.');
    let bitmap;
    try { bitmap = await createImageBitmap(file); } catch { throw new Error('This browser can\u2019t read that image. Try a JPG or PNG.'); }
    const W = 640, H = 360;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);
    const scale = Math.max(W / bitmap.width, H / bitmap.height);
    const sw = W / scale, sh = H / scale;
    ctx.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, W, H);
    bitmap.close && bitmap.close();
    for (const q of [0.85, 0.75, 0.65, 0.55, 0.45, 0.35]) {
        const url = canvas.toDataURL('image/jpeg', q);
        if (url.length * 0.75 < 78000) return url;
    }
    throw new Error('Couldn\u2019t shrink that image enough. Try a different one.');
}

/** Browsers write recorded videos without a length, which breaks the seek bar. Asking for the end once fixes it. */
function fixRecordedDuration(video) {
    video.addEventListener('loadedmetadata', () => {
        if (video.duration !== Infinity) return;
        const back = () => { video.removeEventListener('timeupdate', back); video.currentTime = 0; };
        video.addEventListener('timeupdate', back);
        video.currentTime = 1e101;
    }, { once: true });
}

async function pageVideo(root, id, alive) {
    let v;
    let popNext = false;
    try {
        v = (await api(`/vod/${encodeURIComponent(id)}`)).video;
    } catch (e) {
        if (e.status !== 404) throw e;
        document.title = 'Video not found | Yeli';
        root.innerHTML = emptyState('Video not found', 'This video doesn\u2019t exist or was deleted.', '<a class="btn btn-primary" href="#/explore">Explore channels</a>', 'explore');
        return;
    }
    if (!alive()) return;
    if (v.status !== 'ready') {
        root.innerHTML = emptyState('Still saving', 'This stream is still being saved. It will appear here when the stream ends.', `<a class="btn btn-primary" href="${channelHref(v.username)}">Back to the channel</a>`);
        return;
    }

    root.innerHTML = `
    <div class="vod-page">
        <div class="clip-bar" id="vClip" role="note" hidden></div>
        <div class="player vod-player"><video id="vodVideo" playsinline preload="metadata"></video></div>
        <div class="channel-head">
            <a href="${channelHref(v.username)}" aria-label="${esc(v.username)}">${avatar(v, 'avatar-lg')}</a>
            <div class="channel-titles">
                <h1 class="channel-title" id="vTitle" data-no-i18n></h1>
                <p class="channel-line" id="vLine"></p>
            </div>
            <div class="channel-actions" id="vActions"></div>
        </div>
        <section class="channel-about">
            <h2 class="section-title">Description</h2>
            <p id="vDesc" data-no-i18n></p>
            <p class="muted" id="vDescEmpty" hidden>No description.</p>
            <p class="muted" id="vNote"></p>
        </section>
        <section class="vod-comments" id="vComments" aria-labelledby="vcTitle">
            <h2 class="section-title" id="vcTitle"><span>Comments</span> <span class="vc-count" id="vcCount"></span></h2>
            <div id="vcCompose"></div>
            <ul class="vc-list" id="vcList"></ul>
            <p class="muted vc-empty" id="vcEmpty" hidden>No comments yet. Be the first.</p>
            <button type="button" class="btn btn-secondary vc-more" id="vcMore" hidden>Show more comments</button>
        </section>
    </div>`;

    const video = $('#vodVideo');
    video.src = `/api/vod/${encodeURIComponent(v.id)}/video`;
    fixRecordedDuration(video);
    const controls = createPlayerControls($('.vod-player'), video, { live: false, seekable: true });
    onLeave(() => { controls.destroy(); video.pause(); video.removeAttribute('src'); video.load(); });

    function paint() {
        document.title = `${v.title} | Yeli`;
        if (v.cover) video.poster = vodCoverSrc(v); else video.removeAttribute('poster');
        $('#vTitle').textContent = v.title;
        $('#vLine').innerHTML = `<a class="stream-channel" href="${channelHref(v.username)}">${esc(v.username)}</a><span class="chip-static">${esc(v.category)}</span><span class="muted">${esc(vodDate(v.started_at))} \u00b7 ${fmtDuration(v.duration * 1000)}</span>`;
        $('#vDesc').textContent = v.description || '';
        $('#vDesc').hidden = !v.description;
        $('#vDescEmpty').hidden = !!v.description || !v.is_mine;
        $('#vNote').textContent = v.is_mine && v.visibility === 'followers' ? 'Only people who follow you can watch this video.' : '';
        const bar = $('#vClip');
        bar.hidden = !v.is_clip;
        bar.innerHTML = v.is_clip ? `${IC(LOCK_PATH, 'none', 20)}<div class="clip-bar-text"><strong>Private clip</strong><span>Only you can see this. Cut it in the editor, then publish it to your channel when it is ready.</span></div>
            <div class="clip-bar-actions"><button type="button" class="btn btn-primary" data-vod="publish">${IC(GLOBE_PATH)}<span>Publish</span></button><a class="btn btn-secondary btn-ico" href="${editorHref(v.id)}">${IC(FILM_PATH)}<span>Open in editor</span></a></div>` : '';
        $('#vComments').hidden = v.is_clip;
        const pop = popNext; popNext = false;      // the heart bounces only right after you tap it, not on every repaint
        $('#vActions').innerHTML = (v.is_clip ? '' : `<button type="button" class="btn btn-secondary btn-ico like-btn${v.liked ? ' is-liked' : ''}${v.liked && pop ? ' pop' : ''}" data-vod="like" aria-pressed="${v.liked}" aria-label="${v.liked ? 'Unlike' : 'Like'}" title="${v.liked ? 'Unlike' : 'Like'}">${IC(HEART_PATH, v.liked ? 'currentColor' : 'none')}<span class="like-count">${countText(v.likes)}</span></button>`
            + `<button type="button" class="btn btn-secondary btn-ico btn-share" data-vod="share">${IC(SHARE_PATH)}<span>Share</span></button>`)
            + (v.is_mine ? vodMenuHtml(v) : '');
    }
    paint();

    const vodMenu = () => $('.vod-menu', root);
    function closeVodMenu() {
        const m = vodMenu();
        if (!m || m.hidden) return;
        m.hidden = true;
        const t = $('[data-vod="menu"]', root);
        if (t) t.setAttribute('aria-expanded', 'false');
    }
    function toggleVodMenu() {
        const m = vodMenu();
        if (!m) return;
        const open = m.hidden;
        m.hidden = !open;
        $('[data-vod="menu"]', root).setAttribute('aria-expanded', String(open));
        if (open) { const on = $('.vod-menu-item.is-on', m) || $('.vod-menu-item', m); if (on) on.focus(); }
    }
    async function setVisibility(target) {
        if (target === v.visibility) return;
        if (v.is_clip) {                          // a private clip goes through the publish step (title and description)
            openPublishDialog(v, (next) => { v = next; route(); }, target);
            return;
        }
        try {
            v = (await api(`/vod/${encodeURIComponent(v.id)}/visibility`, { method: 'POST', body: { visibility: target } })).video;
            toast(target === 'private' ? 'Moved back to your clips. Only you can see it now.'
                : target === 'followers' ? 'Now only your followers can watch this video.' : 'Now everyone can watch this video.');
            route();
        } catch (e2) { toast(e2.message); }
    }
    const onDocClick = (e) => { if (!e.target.closest('.vod-menu-wrap')) closeVodMenu(); };
    const onKey = (e) => { if (e.key === 'Escape' && vodMenu() && !vodMenu().hidden) { closeVodMenu(); const t = $('[data-vod="menu"]', root); if (t) t.focus(); } };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    onLeave(() => { document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onKey); });

    if (root._vodClick) root.removeEventListener('click', root._vodClick);
    root._vodClick = async (e) => {
        const vis = e.target.closest('[data-vis]');
        if (vis && root.contains(vis)) { closeVodMenu(); await setVisibility(vis.dataset.vis); return; }
        const b = e.target.closest('[data-vod]');
        if (!b || !root.contains(b)) return;
        if (b.dataset.vod === 'menu') { toggleVodMenu(); return; }
        closeVodMenu();
        if (b.dataset.vod === 'like') {
            if (!state.me) { openAuth('login', 'Log in to like this video.'); return; }
            if (b.disabled) return;
            b.disabled = true;
            const was = { liked: v.liked, likes: v.likes };
            v.liked = !v.liked;                       // show the change right away, undo it if the server says no
            v.likes += v.liked ? 1 : -1;
            popNext = v.liked;
            paint();
            try {
                const r = await api(`/vod/${encodeURIComponent(v.id)}/like`, { method: 'POST', body: { liked: v.liked } });
                v.liked = r.liked;
                v.likes = r.likes;
            } catch (e2) {
                Object.assign(v, was);
                toast(e2.message);
            } finally {
                paint();
            }
        } else if (b.dataset.vod === 'publish') {
            openPublishDialog(v, (next) => { v = next; route(); });
        } else if (b.dataset.vod === 'unpublish') {
            b.disabled = true;
            try {
                v = (await api(`/vod/${encodeURIComponent(v.id)}/unpublish`, { method: 'POST' })).video;
                toast('Moved back to your clips. Only you can see it now.');
                route();
            } catch (e2) { toast(e2.message); b.disabled = false; }
        } else if (b.dataset.vod === 'share') {
            openShareDialog({ title: v.title, text: `${v.title} | ${v.username} on Yeli` });
        } else if (b.dataset.vod === 'edit') {
            openVideoEdit(v, (next) => { v = next; paint(); });
        } else if (b.dataset.vod === 'delete') {
            openVideoDelete(v);
        }
    };
    root.addEventListener('click', root._vodClick);
    onLeave(() => root.removeEventListener('click', root._vodClick));

    if (!v.is_clip) mountVideoComments(v, alive);
}

/** The \u22ef menu of my own video: who can watch it (private / followers only / public) and delete. */
const VIS_OPTIONS = [
    ['private', 'Private', 'Only you', LOCK_PATH],
    ['followers', 'Followers only', 'Only people who follow you', USERS_PATH],
    ['public', 'Public', 'Anyone', GLOBE_PATH],
];
function vodMenuHtml(v) {
    const items = VIS_OPTIONS.map(([key, label, hint, icon]) => `
        <button type="button" class="vod-menu-item${v.visibility === key ? ' is-on' : ''}" role="menuitemradio" aria-checked="${v.visibility === key}" data-vis="${key}">
            ${IC(icon, 'none', 18)}<span class="vod-menu-text"><strong>${label}</strong><small>${hint}</small></span>${v.visibility === key ? IC(CHECK_PATH, 'none', 16) : ''}
        </button>`).join('');
    return `<div class="vod-menu-wrap">
        <button type="button" class="btn btn-secondary btn-more" data-vod="menu" aria-haspopup="menu" aria-expanded="false" aria-label="More options" title="More options">${IC(DOTS_PATH, 'none', 20)}</button>
        <div class="vod-menu" role="menu" aria-label="Video options" hidden>
            <p class="vod-menu-title">Privacy</p>
            ${items}
            <div class="vod-menu-sep" role="separator"></div>
            <button type="button" class="vod-menu-item is-danger" role="menuitem" data-vod="delete">${IC(TRASH_PATH, 'none', 18)}<span class="vod-menu-text"><strong>Delete</strong></span></button>
        </div>
    </div>`;
}

/** The comments under a published video: write, reply, like, read (newest first, 20 at a time) and delete.
    Replies are one level deep: every reply hangs under its top-level comment and says who it answers. */
function mountVideoComments(v, alive) {
    const list = $('#vcList'), more = $('#vcMore'), empty = $('#vcEmpty'), count = $('#vcCount'), compose = $('#vcCompose');
    const base = `/vod/${encodeURIComponent(v.id)}/comments`;
    let total = 0, oldest = 0, busy = false;

    const paintCount = () => {
        count.textContent = total ? `(${countText(total)})` : '';
        empty.hidden = total > 0 || list.children.length > 0;
    };
    const needLogin = (text) => { openAuth('login', text); };

    function likeHtml(c) {
        return `<button type="button" class="vc-act vc-like${c.liked ? ' is-liked' : ''}" data-like="${c.id}" data-liked="${c.liked ? 1 : 0}" data-n="${c.likes}" aria-pressed="${c.liked}" aria-label="${c.liked ? 'Unlike this comment' : 'Like this comment'}">${IC(HEART_PATH, c.liked ? 'currentColor' : 'none', 15)}<span class="vc-like-n">${c.likes ? countText(c.likes) : ''}</span></button>`;
    }

    function itemHtml(c) {
        const isReply = !!c.parent;
        const isStreamer = c.username === v.username;
        const answers = isReply && c.reply_to ? `<span class="vc-to" translate="no"><span aria-hidden="true">\u203a</span> <a href="${channelHref(c.reply_to)}">@${esc(c.reply_to)}</a></span>` : '';
        const thread = isReply ? '' : `
            <div class="vc-thread" data-thread="${c.id}" data-count="${c.reply_count}" data-loaded="0" data-last="0">
                <button type="button" class="vc-act vc-toggle" data-toggle="${c.id}" aria-expanded="false" ${c.reply_count ? '' : 'hidden'}></button>
                <ul class="vc-list vc-replies" hidden></ul>
                <button type="button" class="vc-act vc-more-replies" data-more-replies="${c.id}" hidden>Show more replies</button>
                <div class="vc-reply-slot"></div>
            </div>`;
        return `<li class="vc-item${isReply ? ' vc-reply' : ''}" data-id="${c.id}" data-user="${esc(c.username)}">
            <a href="${channelHref(c.username)}" tabindex="-1" aria-hidden="true">${avatar(c, isReply ? 'avatar-sm' : 'avatar-md')}</a>
            <div class="vc-body">
                <p class="vc-meta"><a class="vc-user" href="${channelHref(c.username)}" translate="no">${esc(c.username)}</a>${isStreamer ? '<span class="chip-static vc-streamer">Streamer</span>' : ''}${answers}<time class="muted" datetime="${new Date(c.created_at * 1000).toISOString()}">${esc(vodAgo(c.created_at))}</time></p>
                <p class="vc-text" translate="no">${esc(c.text)}</p>
                <div class="vc-actions">${likeHtml(c)}<button type="button" class="vc-act vc-reply-btn" data-reply="${c.id}">Reply</button></div>
                ${thread}
            </div>
            ${c.can_delete ? `<button type="button" class="vc-del" data-del="${c.id}" aria-label="Delete comment" title="Delete comment">&times;</button>` : ''}
        </li>`;
    }

    const toggleLabel = (n, open) => (open ? 'Hide replies' : (n === 1 ? 'View 1 reply' : `View ${countText(n)} replies`));
    function paintThread(thread) {
        const n = Number(thread.dataset.count);
        const btn = $('.vc-toggle', thread);
        const open = !$('.vc-replies', thread).hidden;
        btn.hidden = n === 0;
        btn.textContent = toggleLabel(n, open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    async function loadReplies(thread) {
        const id = thread.dataset.thread;
        const ul = $('.vc-replies', thread), btn = $('.vc-more-replies', thread);
        btn.disabled = true;
        try {
            const after = Number(thread.dataset.last) || 0;
            const r = await api(`${base}/${encodeURIComponent(id)}/replies${after ? `?after=${after}` : ''}`);
            if (!alive()) return;
            ul.insertAdjacentHTML('beforeend', r.comments.map(itemHtml).join(''));
            if (r.comments.length) thread.dataset.last = r.comments[r.comments.length - 1].id;
            thread.dataset.loaded = '1';
            btn.hidden = !r.more;
        } catch (e) {
            if (alive()) toast(e.message);
        } finally {
            btn.disabled = false;
        }
    }

    async function openThread(thread) {
        $('.vc-replies', thread).hidden = false;
        paintThread(thread);
        if (thread.dataset.loaded !== '1') await loadReplies(thread);
    }

    async function load() {
        if (busy) return;
        busy = true;
        more.disabled = true;
        try {
            const r = await api(oldest ? `${base}?before=${oldest}` : base);
            if (!alive()) return;
            list.insertAdjacentHTML('beforeend', r.comments.map(itemHtml).join(''));
            list.querySelectorAll('.vc-thread').forEach(paintThread);
            if (r.comments.length) oldest = r.comments[r.comments.length - 1].id;
            total = r.total;
            more.hidden = !r.more;
            paintCount();
        } catch (e) {
            if (alive()) toast(e.message);
        } finally {
            busy = false;
            more.disabled = false;
        }
    }

    function paintCompose() {
        if (!state.me) {
            compose.innerHTML = '<button type="button" class="btn btn-secondary vc-login" data-auth="login">Log in to comment</button>';
            return;
        }
        compose.innerHTML = `<form class="vc-form" id="vcForm" novalidate>
            ${avatar(state.me, 'avatar-md')}
            <input id="vcInput" maxlength="300" autocomplete="off" placeholder="Add a comment\u2026" aria-label="Add a comment">
            <button type="submit" class="btn btn-primary" id="vcSend">Comment</button>
        </form>`;
        $('#vcForm').addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const input = $('#vcInput'), send = $('#vcSend');
            const text = input.value.trim();
            if (!text) return;
            send.disabled = true;
            try {
                const r = await api(base, { method: 'POST', body: { text } });
                input.value = '';
                total = r.total;
                list.insertAdjacentHTML('afterbegin', itemHtml(r.comment));
                paintCount();
            } catch (e) {
                toast(e.message);
            } finally {
                send.disabled = false;
                input.focus();
            }
        });
    }

    /** The little form under a comment: it answers `target` (a comment or a reply) and lands at the end of the thread. */
    function openReplyForm(item) {
        if (!state.me) { needLogin('Log in to reply.'); return; }
        const root = item.closest('.vc-item:not(.vc-reply)');
        const thread = $('.vc-thread', root);
        const slot = $('.vc-reply-slot', thread);
        const name = item.dataset.user;
        slot.innerHTML = `<form class="vc-form vc-reply-form" novalidate>
            ${avatar(state.me, 'avatar-sm')}
            <input maxlength="300" autocomplete="off" placeholder="Reply to ${esc(name)}\u2026" aria-label="Reply to ${esc(name)}">
            <button type="submit" class="btn btn-primary">Reply</button>
            <button type="button" class="btn btn-secondary" data-reply-cancel>Cancel</button>
        </form>`;
        const form = $('form', slot), input = $('input', slot);
        input.focus();
        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const text = input.value.trim();
            if (!text) return;
            const send = $('button[type="submit"]', form);
            send.disabled = true;
            try {
                const r = await api(base, { method: 'POST', body: { text, parent: Number(item.dataset.id) } });
                total = r.total;
                thread.dataset.count = String(Number(thread.dataset.count) + 1);
                const ul = $('.vc-replies', thread), olderLeft = !$('.vc-more-replies', thread).hidden;
                if (ul.hidden) {                       // closed thread: open it fresh, the server list already has the new reply
                    ul.innerHTML = '';
                    thread.dataset.loaded = '0';
                    thread.dataset.last = '0';
                    await openThread(thread);
                } else if (olderLeft) {                // older replies are still to load: the new one comes after them
                    toast('Reply sent.');
                } else {
                    ul.insertAdjacentHTML('beforeend', itemHtml(r.comment));
                    thread.dataset.last = String(r.comment.id);
                }
                paintThread(thread);
                paintCount();
                slot.innerHTML = '';
            } catch (e) {
                toast(e.message);
                send.disabled = false;
            }
        });
        form.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') slot.innerHTML = ''; });
        $('[data-reply-cancel]', form).addEventListener('click', () => { slot.innerHTML = ''; });
    }

    list.addEventListener('click', async (e) => {
        const like = e.target.closest('[data-like]');
        if (like) {
            if (!state.me) { needLogin('Log in to like this comment.'); return; }
            if (like.disabled) return;
            like.disabled = true;
            const was = { liked: like.dataset.liked === '1', n: Number(like.dataset.n) };
            const paint = (liked, n, pop) => {
                like.dataset.liked = liked ? '1' : '0';
                like.dataset.n = String(n);
                like.classList.toggle('is-liked', liked);
                like.classList.toggle('pop', !!pop && liked);
                like.setAttribute('aria-pressed', liked ? 'true' : 'false');
                like.setAttribute('aria-label', liked ? 'Unlike this comment' : 'Like this comment');
                like.innerHTML = `${IC(HEART_PATH, liked ? 'currentColor' : 'none', 15)}<span class="vc-like-n">${n ? countText(n) : ''}</span>`;
            };
            paint(!was.liked, was.n + (was.liked ? -1 : 1), true);   // show it right away, undo it if the server says no
            try {
                const r = await api(`${base}/${encodeURIComponent(like.dataset.like)}/like`, { method: 'POST', body: { liked: !was.liked } });
                paint(r.liked, r.likes, false);
            } catch (e2) {
                paint(was.liked, was.n, false);
                toast(e2.message);
            } finally {
                like.disabled = false;
            }
            return;
        }
        const reply = e.target.closest('[data-reply]');
        if (reply) { openReplyForm(reply.closest('.vc-item')); return; }
        const toggle = e.target.closest('[data-toggle]');
        if (toggle) {
            const thread = toggle.closest('.vc-thread');
            const ul = $('.vc-replies', thread);
            if (ul.hidden) {
                await openThread(thread);
            } else {                                   // closing forgets the list; opening again loads it fresh
                ul.hidden = true;
                ul.innerHTML = '';
                thread.dataset.loaded = '0';
                thread.dataset.last = '0';
                $('.vc-more-replies', thread).hidden = true;
                paintThread(thread);
            }
            return;
        }
        const moreReplies = e.target.closest('[data-more-replies]');
        if (moreReplies) { await loadReplies(moreReplies.closest('.vc-thread')); return; }

        const b = e.target.closest('[data-del]');
        if (!b) return;
        b.disabled = true;
        try {
            const r = await api(`${base}/${encodeURIComponent(b.dataset.del)}/delete`, { method: 'POST' });
            const item = b.closest('.vc-item');
            if (item.classList.contains('vc-reply')) {
                const thread = item.closest('.vc-thread');
                thread.dataset.count = String(Math.max(0, Number(thread.dataset.count) - 1));
                item.remove();
                paintThread(thread);
            } else {
                item.remove();
            }
            total = r.total;
            paintCount();
        } catch (e2) {
            b.disabled = false;
            toast(e2.message);
        }
    });
    more.addEventListener('click', load);
    paintCompose();
    load();
}

function openVideoEdit(v, done) {
    let coverUrl = null; // a new cover waiting to be saved
    const dlg = dialogShell('Edit your video', `
        <form id="vodForm" class="props-form" novalidate>
            ${v.is_clip
        ? '<div class="notice" role="note">This is a private clip, so you can change these as often as you like. After you publish it you can change them one more time.</div>'
        : '<div class="notice notice-test" role="note"><strong>You can only do this one time.</strong> After you save, the cover, the title and the description are locked for this video.</div>'}
            <div class="field"><label>Cover</label>
                <div class="vod-cover-edit">
                    <div class="vod-cover-box" id="vfCoverBox">${v.cover ? `<img src="${vodCoverSrc(v)}" alt="">` : '<span class="muted">No cover</span>'}</div>
                    <label class="btn btn-secondary file-btn">Choose picture<input type="file" id="vfCover" accept="image/*" hidden></label>
                </div></div>
            <div class="field"><label for="vfTitle">Title</label><input id="vfTitle" maxlength="80" autocomplete="off" required></div>
            <div class="field"><label for="vfDesc">Description</label><textarea id="vfDesc" rows="4" maxlength="500" placeholder="Tell people what this video is about"></textarea><small id="vfCount"></small></div>
            <p class="form-error" id="vfErr" role="alert" hidden></p>
            <button type="submit" class="btn btn-primary btn-block" id="vfSave">${v.is_clip ? 'Save' : 'Save (last time)'}</button>
        </form>`);
    const title = $('#vfTitle', dlg), desc = $('#vfDesc', dlg), err = $('#vfErr', dlg);
    title.value = v.title;
    desc.value = v.description;
    const count = () => { $('#vfCount', dlg).textContent = `${desc.value.length}/500`; };
    desc.addEventListener('input', count);
    count();

    $('#vfCover', dlg).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        err.hidden = true;
        try {
            coverUrl = await fileToCoverDataUrl(file);
            $('#vfCoverBox', dlg).innerHTML = `<img src="${coverUrl}" alt="">`;
        } catch (e2) {
            err.textContent = e2.message;
            err.hidden = false;
        }
    });

    $('#vodForm', dlg).addEventListener('submit', async (ev) => {
        ev.preventDefault();
        err.hidden = true;
        const btn = $('#vfSave', dlg);
        btn.disabled = true;
        try {
            const body = { title: title.value, description: desc.value };
            if (coverUrl) body.cover = coverUrl;
            const r = await api(`/vod/${encodeURIComponent(v.id)}/edit`, { method: 'POST', body });
            dlg.close();
            toast(v.is_clip ? 'Saved.' : 'Saved. This video can\u2019t be edited again.');
            done(r.video);
        } catch (e2) {
            err.textContent = e2.message;
            err.hidden = false;
            if (e2.status === 403) setTimeout(() => { dlg.close(); route(); }, 1500);
        } finally {
            btn.disabled = false;
        }
    });
}

/** Publishing a clip: pick the title and the description people will see, then it goes on the channel. */
function openPublishDialog(v, done, visibility = 'public') {
    const onlyFollowers = visibility === 'followers';
    const dlg = dialogShell('Publish this clip', `
        <form id="pubForm" class="props-form" novalidate>
            <div class="notice" role="note">${onlyFollowers ? 'Only people who follow you will be able to watch it, like it and comment. You can change who sees it later.' : 'Anyone will be able to watch it on your channel, like it and comment. You can make it private again later.'}</div>
            <div class="field"><label for="pbTitle">Title</label><input id="pbTitle" maxlength="80" autocomplete="off" required></div>
            <div class="field"><label for="pbDesc">Description</label><textarea id="pbDesc" rows="3" maxlength="500" placeholder="Tell people what this video is about"></textarea></div>
            <p class="form-error" id="pbErr" role="alert" hidden></p>
            <button type="submit" class="btn btn-primary btn-block" id="pbGo">Publish</button>
        </form>`);
    const title = $('#pbTitle', dlg), desc = $('#pbDesc', dlg), err = $('#pbErr', dlg);
    title.value = v.title;
    desc.value = v.description || '';
    $('#pubForm', dlg).addEventListener('submit', async (ev) => {
        ev.preventDefault();
        err.hidden = true;
        const btn = $('#pbGo', dlg);
        btn.disabled = true;
        try {
            const r = await api(`/vod/${encodeURIComponent(v.id)}/publish`, { method: 'POST', body: { title: title.value, description: desc.value, visibility } });
            dlg.close();
            toast(onlyFollowers ? 'Published for your followers.' : 'Published on your channel.');
            done(r.video);
        } catch (e2) {
            err.textContent = e2.message;
            err.hidden = false;
            btn.disabled = false;
        }
    });
}

function openVideoDelete(v) {
    const dlg = dialogShell('Delete this video?', `
        <p>${v.is_clip ? 'This removes the clip for good.' : 'This removes the video from your profile for good.'}</p>
        <p class="form-error" id="vdErr" role="alert" hidden></p>
        <div class="row"><button type="button" class="btn btn-secondary" id="vdNo">Cancel</button><button type="button" class="btn btn-primary" id="vdYes">${v.is_clip ? 'Delete clip' : 'Delete video'}</button></div>`);
    $('#vdNo', dlg).addEventListener('click', () => dlg.close());
    $('#vdYes', dlg).addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        try {
            await api(`/vod/${encodeURIComponent(v.id)}/delete`, { method: 'POST' });
            dlg.close();
            toast(v.is_clip ? 'Clip deleted.' : 'Video deleted.');
            location.hash = v.is_clip ? '#/clips' : channelHref(v.username);
        } catch (e2) {
            const err = $('#vdErr', dlg);
            err.textContent = e2.message;
            err.hidden = false;
            e.currentTarget.disabled = false;
        }
    });
}
