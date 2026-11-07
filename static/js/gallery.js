'use strict';

/* =========================================================================
   Gallery: pictures of streams. A streamer makes one by publishing a clip in the square (1:1) or 4:5 format
   (publish dialog, vods.js) and can give it a price in Yelis. Buying one saves it as a GIF in "My GIFs": from there it is
   sent in the chat of any channel, like a sticker (chat.js). The server side is yeli/gallery.py.
   Route: #/gallery   #/gallery?tab=owned|mine   #/gallery?channel=name
   ========================================================================= */
const galleryImg = (id) => `/api/gallery/${encodeURIComponent(id)}/image`;
const galleryGif = (id) => `/api/gallery/${encodeURIComponent(id)}/gif`;
const priceTag = (n) => (n > 0 ? `${coinImg(14)}<span>${num(n)}</span>` : '<span>Free</span>');

function galleryTile(it, tab) {
    const gifMode = tab === 'owned';
    return `
    <button type="button" class="gal-tile" data-item="${esc(it.id)}" aria-label="${esc(it.title)}, ${it.price > 0 ? `${it.price} Yelis` : 'free'}">
        <span class="gal-pic r-${it.aspect.replace(':', '-')}">
            <img src="${gifMode ? galleryGif(it.id) : galleryImg(it.id)}" alt="" loading="lazy" decoding="async">
            <span class="gal-price${it.price > 0 ? '' : ' is-free'}">${priceTag(it.price)}</span>
            ${it.owned && tab === 'all' ? `<span class="gal-owned" title="You have it">${IC(CHECK_PATH, 'none', 14)}</span>` : ''}
        </span>
        <span class="gal-meta"><strong translate="no">${esc(it.title)}</strong>
            <small translate="no">${esc(it.username)}${tab === 'mine' ? ` \u00b7 ${plural(it.sales, 'sale', 'sales')}` : ''}</small></span>
    </button>`;
}

/** The dialog of one picture: look at it, buy it (or see it in your GIFs), remove it if it is yours. */
function openGalleryItem(it, { onChange }) {
    const gif = it.owned || it.is_mine;
    const dlg = dialogShell(it.title, `
        <div class="gal-view">
            <div class="gal-view-pic r-${it.aspect.replace(':', '-')}"><img id="glPic" src="${gif ? galleryGif(it.id) : galleryImg(it.id)}" alt=""></div>
            <p class="gal-view-by"><a href="${channelHref(it.username)}" translate="no">${avatar(it, 'avatar-sm')}<span>${esc(it.username)}</span></a></p>
            <p class="gal-view-price" id="glPrice">${it.price > 0 ? `${coinImg(18)} <strong>${num(it.price)}</strong> Yelis` : '<strong>Free</strong>'}</p>
            <div id="glInfo"></div>
            <p class="form-error" id="glErr" role="alert" hidden></p>
            <div class="row" id="glActions"></div>
        </div>`);
    const info = $('#glInfo', dlg), actions = $('#glActions', dlg), err = $('#glErr', dlg);

    const paint = () => {
        const owned = it.owned || it.is_mine;
        $('#glPic', dlg).src = owned ? galleryGif(it.id) : galleryImg(it.id);
        if (it.is_mine) {
            info.innerHTML = `<p class="muted">This is your picture. Its GIF is in <strong>My GIFs</strong>; send it from the sticker button in any chat. ${plural(it.sales, 'person has', 'people have')} bought it.</p>`;
            actions.innerHTML = '<button type="button" class="btn btn-secondary btn-ico" id="glRemove">Remove from gallery</button>';
        } else if (it.owned) {
            info.innerHTML = '<p class="muted">You have this one as a GIF. Send it from the sticker button in any chat, in the <strong>GIFs</strong> tab.</p>';
            actions.innerHTML = '';
        } else {
            info.innerHTML = `<p class="muted">${it.price > 0 ? 'When you buy it you keep it as a GIF' : 'Take it and keep it as a GIF'} that you can send in the chat of any channel.${state.me ? ` You have <strong>${num(state.me.balance)}</strong> Yelis.` : ''}</p>`;
            actions.innerHTML = `<button type="button" class="btn btn-primary btn-block" id="glBuy">${it.price > 0 ? `Buy for ${num(it.price)} Yelis` : 'Get it for free'}</button>`;
        }
    };
    paint();

    dlg.addEventListener('click', async (e) => {
        const buy = e.target.closest('#glBuy');
        const rm = e.target.closest('#glRemove');
        if (buy) {
            if (!state.me) { dlg.close(); openAuth('login', 'Log in to get gallery pictures.'); return; }
            err.hidden = true;
            buy.disabled = true;
            try {
                const r = await api(`/gallery/${encodeURIComponent(it.id)}/buy`, { method: 'POST' });
                if (typeof r.balance === 'number') setBalance(r.balance);
                Object.assign(it, r.item);
                toast('Saved in your GIFs. Send it from the sticker button in any chat.');
                paint();
                onChange(it);
            } catch (e2) {
                if (e2.status === 402) { dlg.close(); toast('You need more Yelis for that.'); location.hash = '#/wallet?tab=buy'; return; }
                err.textContent = e2.message;
                err.hidden = false;
                buy.disabled = false;
            }
        } else if (rm) {
            if (!rm.dataset.sure) { rm.dataset.sure = '1'; rm.textContent = 'Tap again to remove it'; return; }
            rm.disabled = true;
            try {
                await api(`/gallery/${encodeURIComponent(it.id)}/delete`, { method: 'POST' });
                dlg.close();
                toast('Removed from the gallery. People who bought it keep their GIF.');
                onChange(it, true);
            } catch (e2) { err.textContent = e2.message; err.hidden = false; rm.disabled = false; }
        }
    });
}

async function pageGallery(root, params, alive) {
    document.title = 'Gallery | Yeli';
    const channel = params.get('channel') || '';
    let tab = ['owned', 'mine'].includes(params.get('tab')) && state.me ? params.get('tab') : 'all';
    const tabs = [['all', 'All'], ['owned', 'My GIFs'], ['mine', 'Mine']];
    root.innerHTML = `
    <div class="page-head">
        <div><h1 class="page-title">Gallery</h1>
        <p class="page-sub">Pictures from streams. Buy one and keep it as a GIF to send in chat.${channel ? ` Showing ${esc(channel)}.` : ''}</p></div>
        ${state.me ? '<a class="btn btn-secondary btn-ico" href="#/clips">' + IC(FILM_PATH, 'none', 15) + '<span>Make one from a clip</span></a>' : ''}
    </div>
    <div class="chip-row" role="group" aria-label="Show" id="galTabs"></div>
    <div id="galBody">${skeletonGrid(6)}</div>`;

    let items = [];
    let offset = 0;
    let more = false;
    let seq = 0;
    const body = $('#galBody');

    const paintTabs = () => {
        $('#galTabs').innerHTML = tabs.filter(([k]) => k === 'all' || state.me).map(([k, label]) =>
            `<button type="button" class="chip" data-tab="${k}" aria-current="${tab === k}"><span>${label}</span></button>`).join('');
    };

    function paint() {
        if (!items.length) {
            const text = tab === 'owned' ? 'Buy a picture in the gallery and it is saved here as a GIF for the chat.'
                : tab === 'mine' ? 'Open a clip, choose Publish and pick the square (1:1) or 4:5 format to put a picture of your stream here, with a price if you want.'
                    : 'When a streamer publishes a stream in the square or 4:5 format, the picture shows up here.';
            body.innerHTML = emptyState(tab === 'owned' ? 'No GIFs yet' : tab === 'mine' ? 'You haven\u2019t published pictures' : 'The gallery is empty', text,
                tab === 'mine' && state.me ? '<a class="btn btn-primary" href="#/clips">Go to my clips</a>' : tab === 'owned' ? '<button type="button" class="btn btn-primary" data-tab="all">Browse the gallery</button>' : '', 'explore');
            return;
        }
        body.innerHTML = `<div class="gal-grid">${items.map((it) => galleryTile(it, tab)).join('')}</div>${more ? '<div class="gal-more"><button type="button" class="btn btn-secondary" id="galMore">Show more</button></div>' : ''}`;
    }

    async function load(reset) {
        const my = ++seq;
        if (reset) { items = []; offset = 0; body.innerHTML = skeletonGrid(6); }
        try {
            const r = await api(`/gallery?scope=${tab}&offset=${offset}${channel && tab === 'all' ? `&channel=${encodeURIComponent(channel)}` : ''}`);
            if (!alive() || my !== seq) return;
            items = items.concat(r.items);
            offset = r.next_offset;
            more = r.more;
            paint();
        } catch (e) {
            if (alive() && my === seq) body.innerHTML = `<p class="form-error">${esc(e.message)}</p>`;
        }
    }

    const onClick = (e) => {
        const t = e.target.closest('[data-tab]');
        if (t) { tab = t.dataset.tab; paintTabs(); load(true); return; }
        if (e.target.closest('#galMore')) { e.target.closest('#galMore').disabled = true; load(false); return; }
        const tile = e.target.closest('[data-item]');
        if (!tile) return;
        const it = items.find((x) => x.id === tile.dataset.item);
        if (it) openGalleryItem(it, { onChange: (next, removed) => { if (removed) items = items.filter((x) => x.id !== it.id); paint(); } });
    };
    root.addEventListener('click', onClick);
    onLeave(() => root.removeEventListener('click', onClick));

    paintTabs();
    load(true);
}
