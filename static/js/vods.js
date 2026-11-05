'use strict';

/* =========================================================================
   Saved streams: the "Videos" section of a channel, the video page, and the one-time edit
   (cover, title and description). The server side is yeli/vods.py.
   ========================================================================= */
const videoHref = (id) => `#/video/${encodeURIComponent(id)}`;
const vodCoverSrc = (v) => `/api/vod/${encodeURIComponent(v.id)}/cover?v=${Number(v.cover)}`;
const vodDate = (t) => new Date(t * 1000).toLocaleDateString(window.YELI_LANG, { year: 'numeric', month: 'short', day: 'numeric' });

const IC = (path, fill = 'none') => `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="${fill}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const HEART_PATH = '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>';
const COMMENT_PATH = '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.7-.9L3 21l1.9-5.3A8.4 8.4 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z"/>';
const SHARE_PATH = '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4M12 2v13"/>';
const EDIT_PATH = '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>';
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
                <p class="vod-stats" aria-hidden="true"><span>${IC(HEART_PATH)}${countText(v.likes)}</span><span>${IC(COMMENT_PATH)}${countText(v.comment_count)}</span></p>
                <p class="stream-cat"><span class="chip-static">${esc(v.category)}</span>${v.can_edit ? ' <span class="chip-static chip-edit">Edit available</span>' : ''}</p>
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
                : '<p class="muted">When you finish a live stream, it is saved here automatically as a video.</p>';
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
            <p class="muted" id="vNote"></p>
        </section>
        <section class="vod-comments" aria-labelledby="vcTitle">
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
        $('#vDesc').textContent = v.description || (v.is_mine ? 'No description.' : '');
        $('#vDesc').hidden = !v.description && !v.is_mine;
        $('#vNote').textContent = v.is_mine ? (v.can_edit ? 'You can change the cover, the title and the description one time.' : 'You already used your one change for this video.') : '';
        const pop = popNext; popNext = false;      // the heart bounces only right after you tap it, not on every repaint
        $('#vActions').innerHTML = `<button type="button" class="btn btn-secondary btn-ico like-btn${v.liked ? ' is-liked' : ''}${v.liked && pop ? ' pop' : ''}" data-vod="like" aria-pressed="${v.liked}" aria-label="${v.liked ? 'Unlike' : 'Like'}" title="${v.liked ? 'Unlike' : 'Like'}">${IC(HEART_PATH, v.liked ? 'currentColor' : 'none')}<span class="like-count">${countText(v.likes)}</span></button>`
            + `<button type="button" class="btn btn-secondary btn-ico btn-share" data-vod="share">${IC(SHARE_PATH)}<span>Share</span></button>`
            + (v.is_mine ? `${v.can_edit ? `<button type="button" class="btn btn-primary btn-ico btn-edit" data-vod="edit">${IC(EDIT_PATH)}<span>Edit (one time)</span></button>` : ''}<button type="button" class="btn btn-secondary btn-ico btn-trash" data-vod="delete">${IC(TRASH_PATH)}<span>Delete</span></button>` : '');
    }
    paint();

    $('#vActions').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-vod]');
        if (!b) return;
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
        } else if (b.dataset.vod === 'share') {
            openShareDialog({ title: v.title, text: `${v.title} | ${v.username} on Yeli` });
        } else if (b.dataset.vod === 'edit') {
            openVideoEdit(v, (next) => { v = next; paint(); });
        } else if (b.dataset.vod === 'delete') {
            openVideoDelete(v);
        }
    });

    mountVideoComments(v, alive);
}

/** The comments under a saved video: write, read (newest first, 20 at a time) and delete. */
function mountVideoComments(v, alive) {
    const list = $('#vcList'), more = $('#vcMore'), empty = $('#vcEmpty'), count = $('#vcCount'), compose = $('#vcCompose');
    const base = `/vod/${encodeURIComponent(v.id)}/comments`;
    let total = 0, oldest = 0, busy = false;

    const paintCount = () => {
        count.textContent = total ? `(${countText(total)})` : '';
        empty.hidden = total > 0 || list.children.length > 0;
    };

    function itemHtml(c) {
        const isStreamer = c.username === v.username;
        return `<li class="vc-item" data-id="${c.id}">
            <a href="${channelHref(c.username)}" tabindex="-1" aria-hidden="true">${avatar(c, 'avatar-md')}</a>
            <div class="vc-body">
                <p class="vc-meta"><a class="vc-user" href="${channelHref(c.username)}" translate="no">${esc(c.username)}</a>${isStreamer ? '<span class="chip-static vc-streamer">Streamer</span>' : ''}<time class="muted" datetime="${new Date(c.created_at * 1000).toISOString()}">${esc(vodAgo(c.created_at))}</time></p>
                <p class="vc-text" translate="no">${esc(c.text)}</p>
            </div>
            ${c.can_delete ? `<button type="button" class="vc-del" data-del="${c.id}" aria-label="Delete comment" title="Delete comment">&times;</button>` : ''}
        </li>`;
    }

    async function load() {
        if (busy) return;
        busy = true;
        more.disabled = true;
        try {
            const r = await api(oldest ? `${base}?before=${oldest}` : base);
            if (!alive()) return;
            list.insertAdjacentHTML('beforeend', r.comments.map(itemHtml).join(''));
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

    list.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-del]');
        if (!b) return;
        b.disabled = true;
        try {
            const r = await api(`${base}/${encodeURIComponent(b.dataset.del)}/delete`, { method: 'POST' });
            b.closest('.vc-item').remove();
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
            <div class="notice notice-test" role="note"><strong>You can only do this one time.</strong> After you save, the cover, the title and the description are locked for this video.</div>
            <div class="field"><label>Cover</label>
                <div class="vod-cover-edit">
                    <div class="vod-cover-box" id="vfCoverBox">${v.cover ? `<img src="${vodCoverSrc(v)}" alt="">` : '<span class="muted">No cover</span>'}</div>
                    <label class="btn btn-secondary file-btn">Choose picture<input type="file" id="vfCover" accept="image/*" hidden></label>
                </div></div>
            <div class="field"><label for="vfTitle">Title</label><input id="vfTitle" maxlength="80" autocomplete="off" required></div>
            <div class="field"><label for="vfDesc">Description</label><textarea id="vfDesc" rows="4" maxlength="500" placeholder="Tell people what this video is about"></textarea><small id="vfCount"></small></div>
            <p class="form-error" id="vfErr" role="alert" hidden></p>
            <button type="submit" class="btn btn-primary btn-block" id="vfSave">Save (last time)</button>
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
            toast('Saved. This video can\u2019t be edited again.');
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

function openVideoDelete(v) {
    const dlg = dialogShell('Delete this video?', `
        <p>This removes the video from your profile for good.</p>
        <p class="form-error" id="vdErr" role="alert" hidden></p>
        <div class="row"><button type="button" class="btn btn-secondary" id="vdNo">Cancel</button><button type="button" class="btn btn-primary" id="vdYes">Delete video</button></div>`);
    $('#vdNo', dlg).addEventListener('click', () => dlg.close());
    $('#vdYes', dlg).addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        try {
            await api(`/vod/${encodeURIComponent(v.id)}/delete`, { method: 'POST' });
            dlg.close();
            toast('Video deleted.');
            location.hash = channelHref(v.username);
        } catch (e2) {
            const err = $('#vdErr', dlg);
            err.textContent = e2.message;
            err.hidden = false;
            e.currentTarget.disabled = false;
        }
    });
}
