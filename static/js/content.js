'use strict';

/* =========================================================================
   Content: one entry in the menu with three options: Video, Short and Gallery.
   Routes: #/content (the three options)   #/videos (regular videos)   #/shorts   #/gallery
   ========================================================================= */
const CONTENT_OPTIONS = [
    { href: '#/videos', icon: 'static/svg/broadcast.svg', title: 'Video', text: 'Watch videos from streamers.' },
    { href: '#/shorts', icon: 'static/svg/shorts.svg', title: 'Short', text: 'Vertical videos, one swipe at a time.' },
    { href: '#/gallery', icon: 'static/svg/gallery.svg', title: 'Gallery', text: 'Pictures of streams you can collect.' }
];

function pageContent(root) {
    document.title = 'Content | Yeli';
    root.innerHTML = `
    <section class="content-page" aria-label="Content">
        <h1 class="page-title">Content</h1>
        <div class="content-options">
            ${CONTENT_OPTIONS.map((o) => `
            <a class="content-card" href="${o.href}">
                <span class="content-ico"><img src="${o.icon}" alt="" aria-hidden="true"></span>
                <strong>${o.title}</strong>
                <span class="muted">${o.text}</span>
            </a>`).join('')}
        </div>
    </section>`;
}

/** Content > Video: the published regular videos of everyone, newest first. */
async function pageVideos(root, alive) {
    document.title = 'Video | Yeli';
    root.innerHTML = `
    <section class="content-page" aria-label="Video">
        <div class="content-back"><a class="btn btn-secondary" href="#/content">Content</a></div>
        <h1 class="page-title">Video</h1>
        <div id="videosGrid" class="stream-grid"></div>
        <div class="row" id="videosMore" hidden><button type="button" class="btn btn-secondary" id="videosMoreBtn">Load more</button></div>
    </section>`;
    const grid = $('#videosGrid'), moreRow = $('#videosMore');
    let offset = 0, loading = false;

    const load = async () => {
        if (loading) return;
        loading = true;
        try {
            const r = await api(`/videos?offset=${offset}`);
            if (!alive()) return;
            if (offset === 0 && !r.videos.length) {
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
    await load();
}
