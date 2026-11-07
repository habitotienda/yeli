'use strict';

/* =========================================================================
   Content: one entry in the menu with three options: Video, Short and Gallery.
   Routes: #/content (the three options)   #/videos (regular videos)   #/shorts   #/gallery
   ========================================================================= */
const CONTENT_ICONS = {
    video: '<rect x="3" y="5" width="18" height="14" rx="3.5"/><path d="M10.2 9.6v4.8l4.2-2.4z" fill="currentColor"/>',
    short: '<rect x="5.5" y="2.5" width="13" height="19" rx="4.2"/><path d="M13.2 6.4L9.3 12.5h2.8l-1 5.1 4-6.3h-2.8z" fill="currentColor" stroke-width="1.3"/>',
    gallery: '<rect x="3" y="3.5" width="18" height="17" rx="3.5"/><circle cx="8.6" cy="9" r="1.7"/><path d="M4 17l5-4.6 3.4 3 3-2.6L20 16.6"/>'
};
const CONTENT_OPTIONS = [
    { href: '#/videos', key: 'video', title: 'Video', text: 'Watch videos from streamers.' },
    { href: '#/shorts', key: 'short', title: 'Short', text: 'Vertical videos, one swipe at a time.' },
    { href: '#/gallery', key: 'gallery', title: 'Gallery', text: 'Pictures of streams you can collect.' }
];
const contentIcon = (key, size = 28) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CONTENT_ICONS[key]}</svg>`;

function pageContent(root) {
    document.title = 'Content | Yeli';
    root.innerHTML = `
    <section class="content-page" aria-label="Content">
        <h1 class="page-title">Content</h1>
        <div class="content-options">
            ${CONTENT_OPTIONS.map((o) => `
            <a class="content-card is-${o.key}" href="${o.href}">
                <span class="content-ico">${contentIcon(o.key)}</span>
                <span class="content-text"><strong>${o.title}</strong><span class="muted">${o.text}</span></span>
                <svg class="content-go" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
            </a>`).join('')}
        </div>
    </section>`;
}

/** People that match a Content search (the search inside Content never lists streams). Fills `box` and hides it when nobody matches. */
async function paintPeopleMatches(box, q, alive) {
    try {
        const { results } = await api(`/search?q=${encodeURIComponent(q)}&limit=12`);
        if (!alive()) return;
        box.hidden = !results.length;
        box.innerHTML = results.length ? `<h2 class="section-title">People</h2>${channelGrid(results)}` : '';
    } catch { box.hidden = true; }
}

/** Content > Video: the published regular videos of everyone, newest first. With `?q=` it searches people and videos. */
async function pageVideos(root, alive, params) {
    const q = ((params && params.get('q')) || '').trim();
    document.title = q ? `${q} | Video | Yeli` : 'Video | Yeli';
    const input = $('#searchInput');
    if (input) input.value = q;
    root.innerHTML = `
    <section class="content-page" aria-label="Video">
        <div class="content-back"><a class="btn btn-secondary" href="#/content">Content</a>${q ? '<a class="btn btn-secondary" href="#/videos">All videos</a>' : ''}</div>
        <h1 class="page-title">${q ? `Results for \u201c${esc(q)}\u201d` : 'Video'}</h1>
        ${q ? '<section class="section" id="videosPeople" hidden></section>' : ''}
        ${q ? '<h2 class="section-title">Videos</h2>' : ''}
        <div id="videosGrid" class="stream-grid"></div>
        <div class="row" id="videosMore" hidden><button type="button" class="btn btn-secondary" id="videosMoreBtn">Load more</button></div>
    </section>`;
    const grid = $('#videosGrid'), moreRow = $('#videosMore');
    let offset = 0, loading = false;

    const load = async () => {
        if (loading) return;
        loading = true;
        try {
            const r = await api(`/videos?offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
            if (!alive()) return;
            if (offset === 0 && !r.videos.length) {
                if (q) { grid.outerHTML = '<p class="muted content-empty">No videos matched your search.</p>'; moreRow.hidden = true; return; }
                $('.content-page').innerHTML = emptyState('No videos yet', 'Published videos will show up here.', '<a class="btn btn-primary" href="#/content">Back to Content</a>', 'broadcast');
                return;
            }
            grid.insertAdjacentHTML('beforeend', r.videos.map(videoCard).join(''));
            offset = r.next_offset;
            moreRow.hidden = !r.more;
        } catch (e) {
            if (alive()) grid.insertAdjacentHTML('beforebegin', `<p class="form-error" role="alert">${esc(e.message)}</p>`);
        } finally { loading = false; }
    };
    $('#videosMoreBtn').addEventListener('click', load);
    if (q) paintPeopleMatches($('#videosPeople'), q, alive);
    await load();
}

/** The Video / Short / Gallery tabs of a channel page. Shows what the channel has published; works while it is live or offline.
 *  Returns { reload(delayMs) }. */
function mountChannelContent(section, ch, alive) {
    const name = ch.username;
    const empty = { videos: [], shorts: [], items: [] };
    let data = { ...empty };
    let tab = '';
    let timer = null, dead = false;

    const tabs = () => [
        ['video', 'Video', data.videos.length],
        ['short', 'Short', data.shorts.length],
        ['gallery', 'Gallery', data.items.length]
    ];

    const emptyText = {
        video: ch.is_me ? 'Streams you finish are saved as private clips. Publish one from your clips and it shows up here.' : 'No videos yet.',
        short: ch.is_me ? 'Publish a vertical video and it shows up here as a Short.' : 'No Shorts yet',
        gallery: ch.is_me ? 'Publish a square or 4:5 picture of your stream and it shows up here.' : 'The gallery is empty'
    };

    function shortCard(v) {
        return `<a class="chan-short" href="#/shorts?channel=${encodeURIComponent(name)}&v=${encodeURIComponent(v.id)}" style="--hue:${Number(v.hue)}" aria-label="${esc(v.title)}">
            <span class="thumb-initial" aria-hidden="true">${esc(v.username.charAt(0).toUpperCase())}</span>
            ${v.cover ? `<img class="thumb-img" src="${vodCoverSrc(v)}" alt="" loading="lazy">` : ''}
            <span class="chan-short-info"><strong translate="no">${esc(v.title)}</strong><small>${IC(HEART_PATH, 'none', 12)} ${countText(v.likes)}</small></span>
        </a>`;
    }

    function paint() {
        const list = tabs();
        const any = list.some(([, , n]) => n > 0);
        section.hidden = !any && !ch.is_me;
        if (section.hidden) return;
        if (!tab || !list.some(([k]) => k === tab)) tab = (list.find(([, , n]) => n > 0) || list[0])[0];
        const body = tab === 'video'
            ? `<div class="stream-grid vod-grid">${data.videos.map(videoCard).join('')}</div>`
            : tab === 'short'
                ? `<div class="chan-shorts">${data.shorts.map(shortCard).join('')}</div>`
                : `<div class="gal-grid">${data.items.map((it) => galleryTile(it, 'all')).join('')}</div>`;
        const has = tab === 'video' ? data.videos.length : tab === 'short' ? data.shorts.length : data.items.length;
        section.innerHTML = `
            <div class="chip-row content-tabs" role="tablist" aria-label="Content">
                ${list.map(([k, label, n]) => `<button type="button" role="tab" class="chip" data-ctab="${k}" aria-current="${tab === k}" aria-selected="${tab === k}">${contentIcon(k, 16)}<span>${label}</span>${n ? `<em class="content-n">${countText(n)}</em>` : ''}</button>`).join('')}
            </div>
            ${has ? body : `<p class="muted content-empty">${emptyText[tab]}</p>`}
            ${has && tab === 'short' ? `<p class="content-all"><a href="#/shorts?channel=${encodeURIComponent(name)}">All Shorts</a></p>` : ''}
            ${has && tab === 'gallery' ? `<p class="content-all"><a href="#/gallery?channel=${encodeURIComponent(name)}">Browse the gallery</a></p>` : ''}`;
    }

    async function load() {
        const safe = (p, key) => p.then((r) => r[key] || []).catch(() => []);
        const q = encodeURIComponent(name);
        const [videos, shorts, items] = await Promise.all([
            safe(api(`/channel/${q}/videos`), 'videos'),
            safe(api(`/shorts?channel=${q}`), 'shorts'),
            safe(api(`/gallery?scope=all&channel=${q}`), 'items')
        ]);
        if (dead || !alive()) return;
        data = { videos, shorts, items };
        paint();
    }

    const onClick = (e) => {
        const t = e.target.closest('[data-ctab]');
        if (t) { tab = t.dataset.ctab; paint(); return; }
        const tile = e.target.closest('.gal-tile[data-item]');
        if (!tile) return;
        const it = data.items.find((x) => x.id === tile.dataset.item);
        if (it) openGalleryItem(it, { onChange: (next, removed) => { if (removed) data.items = data.items.filter((x) => x.id !== it.id); paint(); } });
    };
    section.addEventListener('click', onClick);
    load();
    onLeave(() => { dead = true; clearTimeout(timer); section.removeEventListener('click', onClick); });
    return { reload(delay = 0) { clearTimeout(timer); timer = setTimeout(load, delay); } };
}
