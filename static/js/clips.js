'use strict';

/* =========================================================================
   Clips: everything you saved. A stream you finish is kept here as a PRIVATE clip; nothing goes on your
   channel until you publish it. From here you can open the video editor, publish, take a video back to
   private, or delete. The PROJECTS tab lists the editor work you saved, to continue it later. The server side is yeli/vods.py (GET /api/me/videos).
   ========================================================================= */
async function pageClips(root, alive) {
    document.title = 'Clips | Yeli';
    if (!state.me) {
        root.innerHTML = emptyState('Clips', 'Log in to see the streams you saved, cut them in the editor and publish them.',
            '<button type="button" class="btn btn-primary" data-auth="login">Log In</button>', 'broadcast');
        return;
    }
    root.innerHTML = `
    <div class="page-head clips-head">
        <div><h1 class="page-title">Clips</h1>
        <p class="page-sub" id="clipsSub">Streams you finish are saved here as private clips. Only you can see them until you publish.</p></div>
        <a class="btn btn-primary btn-ico" href="${editorHref()}">${IC(FILM_PATH)}<span>Open video editor</span></a>
    </div>
    <div class="chip-row clips-filter" role="group" aria-label="Show" id="clipsFilter"></div>
    <div id="clipsBody">${skeletonGrid(4)}</div>`;

    let videos = [];
    let projects = [];
    let limit = 0;
    let minLive = 70;
    let filter = 'all';
    const filters = [['all', 'All'], ['clip', 'Private clips'], ['public', 'Published'], ['projects', 'Projects']];
    const body = $('#clipsBody');

    function paint() {
        if (filter === 'projects') { paintProjects(); return; }
        const shown = videos.filter((v) => filter === 'all' || (filter === 'clip' ? v.is_clip : !v.is_clip));
        const clips = videos.filter((v) => v.is_clip).length;
        $('#clipsFilter').innerHTML = filters.map(([k, label]) => {
            const n = k === 'all' ? videos.length : k === 'clip' ? clips : k === 'projects' ? projects.length : videos.length - clips;
            return `<button type="button" class="chip" data-filter="${k}" aria-current="${filter === k}"><span>${label}</span><span class="chip-count">${n}</span></button>`;
        }).join('');
        if (!videos.length) {
            body.innerHTML = emptyState('No clips yet', 'When you finish a live stream it is saved here as a private clip. You can also open the editor and bring a video from your device.',
                `<a class="btn btn-primary" href="${editorHref()}">Open video editor</a><a class="btn btn-secondary" href="#/studio">Go to the stream manager</a>`, 'broadcast');
            return;
        }
        if (!shown.length) {
            body.innerHTML = `<p class="muted">${filter === 'clip' ? 'You have no private clips.' : 'You have nothing published yet.'}</p>`;
            return;
        }
        body.innerHTML = `<div class="stream-grid vod-grid clip-grid">${shown.map((v) => `
            <div class="clip-item" data-id="${esc(v.id)}">
                ${videoCard(v)}
                <div class="clip-actions">
                    ${v.is_clip
        ? `<button type="button" class="btn btn-primary btn-ico" data-clip="publish">${IC(GLOBE_PATH, 'none', 15)}<span>Publish</span></button>`
        : `<button type="button" class="btn btn-secondary btn-ico" data-clip="unpublish">${IC(LOCK_PATH, 'none', 15)}<span>Make private</span></button>`}
                    <a class="btn btn-secondary btn-ico" href="${editorHref(v.id)}">${IC(FILM_PATH, 'none', 15)}<span>Edit</span></a>
                    <button type="button" class="btn btn-secondary btn-icon btn-trash" data-clip="delete" aria-label="Delete" title="Delete">${IC(TRASH_PATH, 'none', 15)}</button>
                </div>
            </div>`).join('')}</div>`;
    }

    /** The saved work of the editor: open one to continue where you left off. */
    function paintProjects() {
        if (!projects.length) {
            body.innerHTML = emptyState('No saved projects', 'Open the video editor and press Save: your project is kept here so you can continue later, even from another device.',
                `<a class="btn btn-primary" href="${editorHref()}">Open video editor</a>`, 'broadcast');
            return;
        }
        const covers = new Map(videos.map((v) => [v.id, v]));
        body.innerHTML = `<div class="stream-grid vod-grid clip-grid">${projects.map((p) => {
            const src = covers.get(p.cover_vod);
            const ok = p.live_pct >= minLive;
            return `<div class="clip-item" data-project="${esc(p.id)}">
                <a class="stream-card vod-card project-card" href="#/editor/project/${esc(p.id)}">
                    <div class="stream-thumb" style="--hue:${(p.id.charCodeAt(0) * 37) % 360}">
                        <span class="thumb-initial" aria-hidden="true">${IC(FILM_PATH, 'none', 34)}</span>
                        ${src && src.cover ? `<img class="thumb-img" src="${vodCoverSrc(src)}" alt="" loading="lazy">` : ''}
                        <span class="badge-viewers badge-duration">${fmtDuration(p.duration * 1000)}</span>
                    </div>
                    <div class="stream-meta"><div class="stream-text">
                        <h3 class="stream-title" data-no-i18n>${esc(p.title)}</h3>
                        <p class="stream-channel">${p.clips} clip${p.clips === 1 ? '' : 's'} \u00b7 ${esc(vodAgo(p.updated_at))}</p>
                        <p class="stream-cat"><span class="chip-static ${ok ? 'chip-live-ok' : 'chip-live-low'}">${p.live_pct}% live footage</span></p>
                    </div></div>
                </a>
                <div class="clip-actions">
                    <a class="btn btn-primary btn-ico" href="#/editor/project/${esc(p.id)}">${IC(FILM_PATH, 'none', 15)}<span>Continue</span></a>
                    <button type="button" class="btn btn-secondary btn-icon btn-trash" data-project-delete aria-label="Delete project" title="Delete project">${IC(TRASH_PATH, 'none', 15)}</button>
                </div>
            </div>`;
        }).join('')}</div>`;
    }

    async function load() {
        try {
            const [r, pr] = await Promise.all([api('/me/videos'), api('/me/projects')]);
            if (!alive()) return;
            videos = r.videos;
            limit = r.limit;
            projects = pr.projects;
            minLive = pr.min_live || minLive;
            $('#clipsSub').textContent = `Streams you finish are saved here as private clips. Only you can see them until you publish. ${videos.length} of ${limit} saved.`;
            paint();
        } catch (e) {
            if (alive()) body.innerHTML = `<p class="form-error">${esc(e.message)}</p>`;
        }
    }

    const onClick = async (e) => {
        const f = e.target.closest('[data-filter]');
        if (f) { filter = f.dataset.filter; paint(); return; }
        const pd = e.target.closest('[data-project-delete]');
        if (pd) {
            const p = projects.find((x) => x.id === pd.closest('.clip-item').dataset.project);
            if (p) openProjectDelete(p, () => { projects = projects.filter((x) => x.id !== p.id); if (typeof EDP !== 'undefined' && EDP && EDP.id === p.id) EDP = null; paint(); });
            return;
        }
        const b = e.target.closest('[data-clip]');
        if (!b) return;
        const item = b.closest('.clip-item');
        const v = videos.find((x) => x.id === item.dataset.id);
        if (!v) return;
        if (b.dataset.clip === 'publish') {
            openPublishDialog(v, (next) => { videos = videos.map((x) => (x.id === next.id ? next : x)); paint(); });
        } else if (b.dataset.clip === 'unpublish') {
            b.disabled = true;
            try {
                const r = await api(`/vod/${encodeURIComponent(v.id)}/unpublish`, { method: 'POST' });
                videos = videos.map((x) => (x.id === v.id ? r.video : x));
                toast('Moved back to your clips. Only you can see it now.');
                paint();
            } catch (e2) { toast(e2.message); b.disabled = false; }
        } else if (b.dataset.clip === 'delete') {
            openClipDelete(v, () => { videos = videos.filter((x) => x.id !== v.id); paint(); });
        }
    };
    root.addEventListener('click', onClick);
    onLeave(() => root.removeEventListener('click', onClick));

    load();
    // a stream that ends while you are on this page shows up without reloading
    const onSaved = () => setTimeout(load, 500);
    window.addEventListener('yeli:vod-saved', onSaved);
    onLeave(() => window.removeEventListener('yeli:vod-saved', onSaved));
}

function openClipDelete(v, done) {
    const dlg = dialogShell(v.is_clip ? 'Delete this clip?' : 'Delete this video?', `
        <p>${v.is_clip ? 'This removes the clip for good.' : 'This removes the video from your channel for good, with its likes and comments.'}</p>
        <p class="form-error" id="cdErr" role="alert" hidden></p>
        <div class="row"><button type="button" class="btn btn-secondary" id="cdNo">Cancel</button><button type="button" class="btn btn-primary" id="cdYes">Delete</button></div>`);
    $('#cdNo', dlg).addEventListener('click', () => dlg.close());
    $('#cdYes', dlg).addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        try {
            await api(`/vod/${encodeURIComponent(v.id)}/delete`, { method: 'POST' });
            dlg.close();
            toast(v.is_clip ? 'Clip deleted.' : 'Video deleted.');
            done();
        } catch (e2) {
            const err = $('#cdErr', dlg);
            err.textContent = e2.message;
            err.hidden = false;
            e.currentTarget.disabled = false;
        }
    });
}

function openProjectDelete(p, done) {
    const dlg = dialogShell('Delete this project?', `
        <p>The project \u201c<span data-no-i18n>${esc(p.title)}</span>\u201d will be removed. Your clips and the videos you already exported are not touched.</p>
        <p class="form-error" id="pdErr" role="alert" hidden></p>
        <div class="row"><button type="button" class="btn btn-secondary" id="pdNo">Cancel</button><button type="button" class="btn btn-primary" id="pdYes">Delete project</button></div>`);
    $('#pdNo', dlg).addEventListener('click', () => dlg.close());
    $('#pdYes', dlg).addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        try {
            await api(`/projects/${encodeURIComponent(p.id)}/delete`, { method: 'POST' });
            dlg.close();
            toast('Project deleted.');
            done();
        } catch (e2) {
            const er = $('#pdErr', dlg);
            er.textContent = e2.message;
            er.hidden = false;
            e.currentTarget.disabled = false;
        }
    });
}
