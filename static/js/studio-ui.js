'use strict';

/* =========================================================================
   Stream manager UI, laid out like OBS Studio:
   preview, docks (Scenes / Sources / Audio Mixer / Controls), status bar, chat dock.
   ========================================================================= */
let studioRoot = null;   // element showing the studio page (null on other pages)
let studioChat = null;
let meterRaf = 0;
let statusTimer = 0;
let stageObserver = null;
let meterEls = [];
let outsideClick = null;

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const OI = {
    eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff: svg('<path d="M3 3l18 18M10.6 6.2A9.7 9.7 0 0 1 12 6c6.400 0 10 6 10 6a17 17 0 0 1-3.200 3.800M6.600 7.600A16.500 16.500 0 0 0 2 12s3.600 7 10 7a9.600 9.600 0 0 0 4.200-1"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    minus: svg('<path d="M5 12h14"/>'),
    up: svg('<path d="M6 15l6-6 6 6"/>'),
    down: svg('<path d="M6 9l6 6 6-6"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.400 15a1.700 1.700 0 0 0 .3 1.800l.1.1a2 2 0 1 1-2.800 2.800l-.1-.1a1.700 1.700 0 0 0-1.800-.3 1.700 1.700 0 0 0-1 1.500V21a2 2 0 1 1-4 0v-.1a1.700 1.700 0 0 0-1.100-1.500 1.700 1.700 0 0 0-1.800.3l-.1.1a2 2 0 1 1-2.800-2.800l.1-.1a1.700 1.700 0 0 0 .3-1.800 1.700 1.700 0 0 0-1.500-1H3a2 2 0 1 1 0-4h.1a1.700 1.700 0 0 0 1.500-1.100 1.700 1.700 0 0 0-.3-1.800l-.1-.1a2 2 0 1 1 2.800-2.800l.1.100a1.700 1.700 0 0 0 1.800.3h.1a1.700 1.700 0 0 0 1-1.500V3a2 2 0 1 1 4 0v.1a1.700 1.700 0 0 0 1 1.500 1.700 1.700 0 0 0 1.800-.3l.1-.1a2 2 0 1 1 2.800 2.800l-.1.100a1.700 1.700 0 0 0-.3 1.800v.1a1.700 1.700 0 0 0 1.500 1H21a2 2 0 1 1 0 4h-.1a1.700 1.700 0 0 0-1.500 1z"/>'),
    mic: svg('<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5.500 11.500a6.500 6.500 0 0 0 13 0M12 18v3"/>'),
    micOff: svg('<rect x="9" y="3" width="6" height="12" rx="3" opacity=".5"/><path d="M5.500 11.500a6.500 6.500 0 0 0 13 0M12 18v3" opacity=".5"/><path d="M4 4l16 16"/>'),
    camera: svg('<rect x="3" y="6.500" width="13" height="11" rx="2.500"/><path d="M16 11l5-3v8l-5-3z"/>'),
    screen: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
    image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.500"/><path d="M21 16l-5-5-9 9"/>'),
    text: svg('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
    chat: svg('<path d="M4 5h16v11H9l-5 4z"/>'),
    bell: svg('<path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4z"/><path d="M10 21a2 2 0 0 0 4 0"/>'),
    speaker: svg('<path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500z"/><path d="M15.500 9a4.200 4.200 0 0 1 0 6"/>'),
};
const TYPE_ICON = { camera: OI.camera, screen: OI.screen, image: OI.image, text: OI.text, chat: OI.chat, alerts: OI.bell };
const TYPE_LABEL = { camera: 'Video Capture Device', screen: 'Display Capture', image: 'Image', text: 'Text', chat: 'Chat', alerts: 'Alerts' };

const tbtn = (act, icon, label) => `<button type="button" class="tbtn" data-act="${act}" aria-label="${label}" title="${label}">${icon}</button>`;
const dock = (id, title, body, foot = '') => `
    <section class="dock" id="${id}" aria-label="${title}">
        <header class="dock-head"><span class="dock-title">${title}</span></header>
        <div class="dock-body">${body}</div>
        ${foot ? `<footer class="dock-foot">${foot}</footer>` : ''}
    </section>`;

const optionList = (items, selected) => items.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(selected) ? ' selected' : ''}>${esc(l)}</option>`).join('');

/* ---------- Page ---------- */
function pageStudio(root) {
    document.title = 'Stream manager | Yeli';
    if (!state.me) {
        root.innerHTML = emptyState(
            'Log in to go live',
            'You need an account to stream. It only takes a minute.',
            '<button type="button" class="btn btn-primary" data-auth="signup">Sign Up</button><button type="button" class="btn btn-secondary" data-auth="login">Log In</button>'
        );
        return;
    }
    root.classList.add('is-studio');
    studioRoot = root;
    openSession();
    buildWorkspace(root);
    S.onChange = refreshAll;
    refreshAll();
    onLeave(teardownUI);
}

function teardownUI() {
    cancelAnimationFrame(meterRaf);
    clearInterval(statusTimer);
    if (stageObserver) { stageObserver.disconnect(); stageObserver = null; }
    if (outsideClick) { document.removeEventListener('click', outsideClick); outsideClick = null; }
    if (studioChat) { studioChat.destroy(); studioChat = null; }
    if (S) S.onChange = null;
    const root = studioRoot;
    studioRoot = null;
    if (root) root.classList.remove('is-studio');
    meterEls = [];
    if (!broadcast) closeSession(); // turns the camera light off when leaving without going live
}

function buildWorkspace(root) {
    const cfg = S.cfg;
    root.innerHTML = `
    <div class="obs" id="obs" data-tab="sources">
        <section class="obs-preview" aria-label="Preview">
            <div class="dock-head"><span class="dock-title">Preview</span><span class="dock-meta" id="obsRes"></span></div>
            <div class="preview-stage" id="stage">
                <div class="preview-wrap" id="previewWrap" tabindex="0" aria-label="Scene preview. Drag items to move them, use the corners to resize.">
                    <div class="sel-box" id="selBox" hidden><i data-h="tl"></i><i data-h="tr"></i><i data-h="bl"></i><i data-h="br"></i></div>
                    <div class="preview-empty" id="previewEmpty" hidden>
                        <div>
                            <p class="overlay-title">This scene is empty</p>
                            <p>Add a source to start building your stream.</p>
                            <div class="row">
                                <button type="button" class="btn btn-primary" data-add="camera">Add camera</button>
                                <button type="button" class="btn btn-secondary" data-add="screen">Share screen</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <nav class="obs-tabs" role="tablist" aria-label="Studio panels">
            ${[['scenes', 'Scenes'], ['sources', 'Sources'], ['mixer', 'Audio'], ['controls', 'Go live'], ['chat', 'Chat']].map(([k, l]) =>
                `<button type="button" role="tab" data-tab-btn="${k}" aria-selected="${k === 'sources'}">${l}</button>`).join('')}
        </nav>

        <section class="obs-docks" aria-label="Docks">
            ${dock('dockScenes', 'Scenes', `<ul class="list" id="sceneList" role="listbox" aria-label="Scenes"></ul>
                <div class="trans-row"><label for="transType">Transition</label>
                    <select id="transType" class="obs-input">${TRANSITIONS.map(([k, l]) => `<option value="${k}"${k === cfg.transition ? ' selected' : ''}>${l}</option>`).join('')}</select>
                    <label class="sr-only" for="transMs">Duration in milliseconds</label>
                    <input id="transMs" class="obs-input" type="number" min="100" max="3000" step="100" value="${esc(cfg.transitionMs)}" title="Duration (ms)"></div>`,
                tbtn('add-scene', OI.plus, 'Add scene') + tbtn('rm-scene', OI.minus, 'Remove scene'))}
            ${dock('dockSources', 'Sources', '<ul class="list" id="sourceList" role="listbox" aria-label="Sources in this scene"></ul><div class="menu" id="addMenu" role="menu" hidden></div>',
                tbtn('add-source', OI.plus, 'Add source') + tbtn('rm-source', OI.minus, 'Remove source') + tbtn('src-up', OI.up, 'Move up') + tbtn('src-down', OI.down, 'Move down') + tbtn('props', OI.gear, 'Source properties'))}
            ${dock('dockMixer', 'Audio Mixer', '<div id="mixer"></div>')}
            ${dock('dockControls', 'Controls', `
                <div class="controls">
                    <label class="sr-only" for="obsTitle">Stream title</label>
                    <input id="obsTitle" class="obs-input" maxlength="80" placeholder="Stream title" autocomplete="off" value="${esc(cfg.title)}">
                    <label class="sr-only" for="obsCat">Category</label>
                    <select id="obsCat" class="obs-input">${optionList(state.config.categories.map((c) => [c, c]), cfg.category)}</select>
                    <button type="button" class="btn-start" id="obsStart" data-act="toggle-stream">Start Streaming</button>
                    <button type="button" class="obs-btn" id="obsFromObs" data-act="go-obs" ${state.config.media.enabled ? '' : 'hidden'}>Go live from OBS</button>
                    <div class="row">
                        <button type="button" class="obs-btn" data-act="settings">Settings</button>
                        <a class="obs-btn" href="${channelHref(state.me.username)}">My channel</a>
                    </div>
                </div>`)}
        </section>

        <aside class="obs-chat" id="obsChat" aria-label="Chat"></aside>
        <footer class="obs-status" id="obsStatus" aria-live="off"></footer>

        <dialog class="dialog obs-dialog" id="propsDialog" aria-label="Source properties"></dialog>
        <dialog class="dialog obs-dialog" id="settingsDialog" aria-label="Settings"></dialog>
        <input type="file" id="imgInput" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
    </div>`;

    $('#previewWrap').insertBefore(S.canvas, $('#previewWrap').firstChild);
    studioChat = createChat($('#obsChat'), state.me.username, { isOwner: true });

    wireDocks();
    wirePreview();
    wireDialogs();

    stageObserver = new ResizeObserver(fitStage);
    stageObserver.observe($('#stage'));
    statusTimer = setInterval(updateStatus, 1000);
    startMeters();

    outsideClick = (e) => { if (!e.target.closest('#addMenu') && !e.target.closest('[data-act="add-source"]')) closeMenu(); };
    document.addEventListener('click', outsideClick);
}

/* ---------- Refresh ---------- */
function refreshAll() {
    if (!S || !studioRoot) return;
    renderScenes();
    renderSources();
    renderMixer();
    renderControls();
    $('#previewEmpty').hidden = activeScene().items.length > 0;
    $('#obsRes').textContent = `${S.canvas.width}\u00d7${S.canvas.height}, ${S.cfg.fps} fps`;
    fitStage();
    updateSelBox();
    updateStatus();
}

function fitStage() {
    const stage = $('#stage');
    const wrap = $('#previewWrap');
    if (!stage || !wrap || !S) return;
    const pad = 16;
    const w = stage.clientWidth - pad * 2;
    const h = stage.clientHeight - pad * 2;
    if (w <= 0 || h <= 0) return;
    const ar = S.canvas.width / S.canvas.height;
    const W = w / h > ar ? h * ar : w;
    wrap.style.width = `${Math.floor(W)}px`;
    wrap.style.height = `${Math.floor(W / ar)}px`;
}

function renderScenes() {
    const list = $('#sceneList');
    list.innerHTML = S.scenes.map((sc) => `
        <li class="row-item${sc.id === S.sceneId ? ' selected' : ''}" role="option" aria-selected="${sc.id === S.sceneId}" data-scene="${sc.id}" tabindex="0">
            <span class="row-name">${esc(sc.name)}</span>
        </li>`).join('');
}

function renderSources() {
    const list = $('#sourceList');
    const items = [...activeScene().items].reverse(); // top of the list = top layer, like OBS
    list.innerHTML = items.length ? items.map((it) => {
        const src = S.sources.get(it.src);
        return `<li class="row-item${it.id === S.selected ? ' selected' : ''}" role="option" aria-selected="${it.id === S.selected}" data-item="${it.id}" tabindex="0">
            <button type="button" class="eye" data-eye="${it.id}" aria-pressed="${!it.visible}" aria-label="${it.visible ? 'Hide' : 'Show'} ${esc(src.name)}">${it.visible ? OI.eye : OI.eyeOff}</button>
            <span class="type-ico" title="${TYPE_LABEL[src.type]}">${TYPE_ICON[src.type]}</span>
            <span class="row-name${it.visible ? '' : ' dim'}">${esc(src.name)}</span>
        </li>`;
    }).join('') : '<li class="list-empty">No sources. Use + to add one.</li>';
}

function mixRow(ch) {
    const db = ch.volume <= 0 ? '-inf' : `${(20 * Math.log10(ch.volume)).toFixed(1)}`;
    return `<div class="mix-row" data-ch="${esc(ch.id)}">
        <div class="mix-top"><span class="mix-name">${esc(ch.label)}</span><span class="mix-db" id="db-${esc(ch.id.replace(/\W/g, '_'))}">${db} dB</span></div>
        <div class="mix-meter" role="img" aria-label="${esc(ch.label)} level"><i></i></div>
        <div class="mix-ctl">
            <button type="button" class="tbtn mix-mute" data-mute="${esc(ch.id)}" aria-pressed="${ch.muted}" aria-label="${ch.muted ? 'Unmute' : 'Mute'} ${esc(ch.label)}">${ch.muted ? OI.micOff : OI.speaker}</button>
            <input type="range" class="mix-vol" min="0" max="2" step="0.01" value="${ch.volume}" data-vol="${esc(ch.id)}" aria-label="${esc(ch.label)} volume">
        </div>
    </div>`;
}

function renderMixer() {
    const mixer = $('#mixer');
    const channels = S.audio ? [...S.audio.channels.values()] : [];
    const mic = channels.find((c) => c.id === 'mic');
    const rest = channels.filter((c) => c.id !== 'mic');
    mixer.innerHTML = (mic
        ? mixRow(mic)
        : `<div class="mix-row"><div class="mix-top"><span class="mix-name">Mic/Aux</span></div>
           <button type="button" class="obs-btn" data-act="enable-mic">Enable microphone</button></div>`)
        + rest.map(mixRow).join('');
    meterEls = [...mixer.querySelectorAll('.mix-row[data-ch]')].map((row) => ({ id: row.dataset.ch, fill: row.querySelector('.mix-meter i') }));
}

function renderControls() {
    const live = !!broadcast;
    const btn = $('#obsStart');
    btn.textContent = live ? 'Stop Streaming' : 'Start Streaming';
    btn.classList.toggle('is-live', live);
    const fromObs = $('#obsFromObs');
    if (fromObs) fromObs.hidden = live || !state.config.media.enabled;
    $('#obsTitle').disabled = live;
    $('#obsCat').disabled = live;
}

function updateStatus() {
    const el = $('#obsStatus');
    if (!el || !S) return;
    const b = broadcast;
    el.innerHTML = `
        <span class="st ${b ? 'st-live' : 'st-off'}"><i aria-hidden="true"></i>${b ? `LIVE ${fmtDuration(Date.now() - b.startedAt)}` : 'OFFLINE'}</span>
        <span class="st">${S.fps} fps</span>${b && b.freeEta != null ? `<span class="st st-free" title="A viewer with an account who stays this long earns you a free upgrade point">Free point in ${fmtDuration(b.freeEta * 1000)}</span>` : ''}
        <span class="st">${b ? b.upKbps : 0} kb/s</span>
        <span class="st">${b ? plural(b.viewers, 'viewer', 'viewers') : '0 viewers'}</span>
        <span class="st">${b ? (b.mode === 'sfu' ? (b.external ? 'OBS via media server' : 'Media server') : 'Peer-to-peer') : (state.config.media.enabled ? 'Media server ready' : 'Peer-to-peer')}</span>
        <span class="st st-end">${S.canvas.width}\u00d7${S.canvas.height}</span>`;
}

/* ---------- Audio meters ---------- */
function startMeters() {
    const buf = new Uint8Array(256);
    const frame = () => {
        for (const m of meterEls) {
            const ch = S && S.audio && S.audio.channels.get(m.id);
            if (!ch) continue;
            ch.analyser.getByteTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
            m.fill.style.transform = `scaleX(${Math.min(1, Math.sqrt(sum / buf.length) * 3.4)})`;
        }
        meterRaf = requestAnimationFrame(frame);
    };
    frame();
}

/* ---------- Docks ---------- */
async function guarded(fn) {
    try { await fn(); } catch (e) { toast(mediaError(e)); }
}

function closeMenu() {
    const m = $('#addMenu');
    if (m) m.hidden = true;
}

function openAddMenu() {
    const menu = $('#addMenu');
    const here = new Set(activeScene().items.map((it) => it.src));
    const existing = [...S.sources.values()].filter((s) => !here.has(s.id));
    menu.innerHTML = ['camera', 'screen', 'image', 'text', 'chat', 'alerts'].map((k) =>
        `<button type="button" role="menuitem" data-add="${k}">${TYPE_ICON[k]}<span>${TYPE_LABEL[k]}</span></button>`).join('')
        + (existing.length ? '<div class="menu-sep" role="separator"></div>' + existing.map((s) =>
            `<button type="button" role="menuitem" data-add="existing:${s.id}">${TYPE_ICON[s.type]}<span>${esc(s.name)}</span></button>`).join('') : '');
    menu.hidden = false;
}

async function addSourceOf(kind) {
    closeMenu();
    if (kind === 'camera') addItem(await addCameraSource());
    else if (kind === 'screen') addItem(await addScreenSource());
    else if (kind === 'text') { const it = addItem(addTextSource()); openProps(it.id); }
    else if (kind === 'image') $('#imgInput').click();
    else if (kind === 'chat') addItem(addChatSource());
    else if (kind === 'alerts') { const fresh = ![...S.sources.values()].some((x) => x.type === 'alerts'); addItem(addAlertsSource()); if (fresh) openAlertsEditor(); }
    else if (kind.startsWith('existing:')) { const src = S.sources.get(kind.slice(9)); if (src) addItem(src); }
}

function selectedItem() {
    return activeScene().items.find((it) => it.id === S.selected) || null;
}

function startRename(li) {
    const id = li.dataset.scene;
    const sc = S.scenes.find((s) => s.id === id);
    const nameEl = li.querySelector('.row-name');
    const input = document.createElement('input');
    input.className = 'obs-input rename';
    input.value = sc.name;
    input.maxLength = 30;
    input.setAttribute('aria-label', 'Scene name');
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const commit = (save) => {
        if (done) return;
        done = true;
        if (save && input.value.trim()) sc.name = input.value.trim();
        renderScenes();
    };
    input.addEventListener('blur', () => commit(true));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commit(true);
        else if (e.key === 'Escape') commit(false);
        e.stopPropagation();
    });
}

function wireDocks() {
    const obs = $('#obs');

    obs.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-tab-btn]');
        if (tab) {
            obs.dataset.tab = tab.dataset.tabBtn;
            obs.querySelectorAll('[data-tab-btn]').forEach((b) => b.setAttribute('aria-selected', String(b === tab)));
            if (tab.dataset.tabBtn === 'sources' || tab.dataset.tabBtn === 'scenes') fitStage();
            return;
        }
        const add = e.target.closest('[data-add]');
        if (add) { guarded(() => addSourceOf(add.dataset.add)); return; }

        const eye = e.target.closest('[data-eye]');
        if (eye) {
            const it = activeScene().items.find((i) => i.id === eye.dataset.eye);
            if (it) { it.visible = !it.visible; refreshAll(); }
            return;
        }
        const mute = e.target.closest('[data-mute]');
        if (mute) {
            const ch = S.audio.channels.get(mute.dataset.mute);
            ch.muted = !ch.muted;
            applyGain(ch);
            renderMixer();
            return;
        }
        const item = e.target.closest('[data-item]');
        if (item && !e.target.closest('button')) { S.selected = item.dataset.item; refreshAll(); return; }
        const scene = e.target.closest('[data-scene]');
        if (scene && !e.target.closest('input')) { selectScene(scene.dataset.scene); return; }

        const act = e.target.closest('[data-act]');
        if (!act) return;
        switch (act.dataset.act) {
            case 'add-scene': addScene(); break;
            case 'rm-scene': if (!removeScene(S.sceneId)) toast('You need at least one scene.'); break;
            case 'add-source': if ($('#addMenu').hidden) openAddMenu(); else closeMenu(); break;
            case 'rm-source': if (S.selected) removeItem(S.selected); break;
            case 'src-up': if (S.selected) moveItem(S.selected, 1); break;
            case 'src-down': if (S.selected) moveItem(S.selected, -1); break;
            case 'props': if (S.selected) openProps(S.selected); else toast('Select a source first.'); break;
            case 'enable-mic': guarded(enableMic); break;
            case 'settings': openSettings(); break;
            case 'toggle-stream': guarded(() => toggleStreaming(false)); break;
            case 'go-obs': guarded(() => toggleStreaming(true)); break;
            default: break;
        }
    });

    obs.addEventListener('dblclick', (e) => {
        const scene = e.target.closest('[data-scene]');
        if (scene) { startRename(scene); return; }
        const item = e.target.closest('[data-item]');
        if (item && !e.target.closest('button')) openProps(item.dataset.item);
    });

    obs.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const row = e.target.closest('.row-item');
        if (!row || e.target.closest('input,button')) return;
        e.preventDefault();
        if (row.dataset.scene) selectScene(row.dataset.scene);
        else if (row.dataset.item) { S.selected = row.dataset.item; refreshAll(); }
    });

    obs.addEventListener('input', (e) => {
        const vol = e.target.closest('[data-vol]');
        if (!vol) return;
        const ch = S.audio.channels.get(vol.dataset.vol);
        ch.volume = Number(vol.value);
        applyGain(ch);
        if (ch.id === 'mic') { S.cfg.micVolume = ch.volume; saveCfg(); }
        const db = $(`#db-${ch.id.replace(/\W/g, '_')}`);
        if (db) db.textContent = `${ch.volume <= 0 ? '-inf' : (20 * Math.log10(ch.volume)).toFixed(1)} dB`;
    });

    $('#transType').addEventListener('change', (e) => { S.cfg.transition = e.target.value; saveCfg(); });
    $('#transMs').addEventListener('change', (e) => { S.cfg.transitionMs = String(Math.min(3000, Math.max(100, Number(e.target.value) || 500))); e.target.value = S.cfg.transitionMs; saveCfg(); });
    $('#obsTitle').addEventListener('input', (e) => { S.cfg.title = e.target.value; saveCfg(); });
    $('#obsCat').addEventListener('change', (e) => { S.cfg.category = e.target.value; saveCfg(); });

    $('#imgInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (file) guarded(async () => addItem(await addImageSource(file)));
    });
}

async function toggleStreaming(external) {
    const btn = $('#obsStart');
    if (broadcast) { await stopBroadcast(); return; }
    btn.disabled = true;
    try {
        await startStreaming({ external });
        if (external) toast('You\u2019re live. Start streaming in OBS and the video will appear on your channel.');
        else if (!activeScene().items.length) toast('Heads up: your scene is empty, so viewers will see a black screen.');
    } finally {
        btn.disabled = false;
    }
}

/* ---------- Preview: select, move, resize ---------- */
function itemGeom(it) {
    const src = S.sources.get(it.src);
    const aspect = srcAspect(src);
    const CW = S.canvas.width, CH = S.canvas.height;
    return { x: it.x, y: it.y, w: it.scale, h: (it.scale * CW) / aspect / CH, aspect };
}

function updateSelBox() {
    const box = $('#selBox');
    if (!box) return;
    const it = selectedItem();
    if (!it) { box.hidden = true; return; }
    const g = itemGeom(it);
    box.hidden = false;
    box.style.left = `${g.x * 100}%`;
    box.style.top = `${g.y * 100}%`;
    box.style.width = `${g.w * 100}%`;
    box.style.height = `${g.h * 100}%`;
}

function wirePreview() {
    const wrap = $('#previewWrap');
    let drag = null;
    const norm = (e) => {
        const r = S.canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    };
    const hit = (p) => {
        const items = activeScene().items;
        for (let i = items.length - 1; i >= 0; i--) {
            const it = items[i];
            if (!it.visible) continue;
            const g = itemGeom(it);
            if (p.x >= g.x && p.x <= g.x + g.w && p.y >= g.y && p.y <= g.y + g.h) return it;
        }
        return null;
    };

    wrap.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.preview-empty')) return;
        const p = norm(e);
        const handle = e.target.closest('[data-h]');
        const sel = selectedItem();
        if (handle && sel) {
            const g = itemGeom(sel);
            const c = handle.dataset.h;
            drag = { mode: 'resize', it: sel, c, aspect: g.aspect, ax: c.includes('l') ? g.x + g.w : g.x, ay: c.includes('t') ? g.y + g.h : g.y };
        } else {
            const it = hit(p);
            S.selected = it ? it.id : null;
            if (it) drag = { mode: 'move', it, dx: p.x - it.x, dy: p.y - it.y };
            renderSources();
            updateSelBox();
        }
        wrap.focus({ preventScroll: true });
        wrap.setPointerCapture(e.pointerId);
    });

    wrap.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const p = norm(e);
        const CW = S.canvas.width, CH = S.canvas.height;
        if (drag.mode === 'move') {
            drag.it.x = p.x - drag.dx;
            drag.it.y = p.y - drag.dy;
        } else {
            const w = Math.min(2, Math.max(0.04, Math.abs(p.x - drag.ax)));
            const h = (w * CW) / drag.aspect / CH;
            drag.it.scale = w;
            drag.it.x = drag.c.includes('l') ? drag.ax - w : drag.ax;
            drag.it.y = drag.c.includes('t') ? drag.ay - h : drag.ay;
        }
        updateSelBox();
    });

    const end = () => { drag = null; };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);

    wrap.addEventListener('keydown', (e) => {
        const it = selectedItem();
        if (!it) return;
        const step = e.shiftKey ? 0.02 : 0.004;
        const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (moves[e.key]) { e.preventDefault(); it.x += moves[e.key][0]; it.y += moves[e.key][1]; updateSelBox(); }
        else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeItem(it.id); }
    });
}

/* ---------- Dialogs ---------- */
function wireDialogs() {
    [$('#propsDialog'), $('#settingsDialog')].forEach((dlg) => {
        dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
    });
}

const PRESETS = [['fit', 'Fit'], ['fill', 'Fill'], ['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right'], ['left', 'Left half'], ['right', 'Right half']];

async function openProps(itemId) {
    const it = activeScene().items.find((i) => i.id === itemId);
    if (!it) return;
    const src = S.sources.get(it.src);
    const dlg = $('#propsDialog');
    const devs = src.type === 'camera' ? await listDevices() : null;

    let typeFields = '';
    if (src.type === 'camera') {
        typeFields = `<div class="field"><label for="pCam">Device</label>
            <select id="pCam" name="cam">${optionList([['', 'Default camera'], ...devs.cams.filter((d) => d.deviceId).map((d, i) => [d.deviceId, d.label || `Camera ${i + 1}`])], src.deviceId)}</select>
            ${devs.cams.some((d) => /obs/i.test(d.label)) ? '<small class="ok-note">OBS Virtual Camera detected.</small>' : ''}</div>`;
    } else if (src.type === 'text') {
        typeFields = `
            <div class="field"><label for="pText">Text</label><textarea id="pText" name="text" rows="3" maxlength="200">${esc(src.props.text)}</textarea></div>
            <div class="field-row">
                <div class="field"><label for="pSize">Font size</label><input id="pSize" name="size" type="range" min="24" max="160" value="${src.props.size}"></div>
                <div class="field"><label for="pColor">Color</label><input id="pColor" name="color" type="color" value="${esc(src.props.color)}"></div>
            </div>
            <label class="check"><input type="checkbox" name="bg"${src.props.bg ? ' checked' : ''}><span><strong>Background</strong></span></label>`;
    } else if (src.type === 'chat') {
        typeFields = `
            <div class="field-row">
                <div class="field"><label for="pcW">Width</label><input id="pcW" name="width" type="range" min="300" max="800" value="${src.props.width}"></div>
                <div class="field"><label for="pcL">Lines</label><input id="pcL" name="lines" type="range" min="3" max="20" value="${src.props.lines}"></div>
            </div>
            <div class="field"><label for="pcS">Text size</label><input id="pcS" name="size" type="range" min="14" max="40" value="${src.props.size}"></div>
            <label class="check"><input type="checkbox" name="bg"${src.props.bg ? ' checked' : ''}><span><strong>Dark background</strong></span></label>
            <p class="hint">Your channel\u2019s chat, drawn into the stream so viewers see it in the video.</p>`;
    } else if (src.type === 'alerts') {
        typeFields = '<div class="field"><button type="button" class="btn btn-primary" data-act-props="edit-alerts">Edit alerts (text, image, sound)</button><small>Alerts for donations and follows show up here, on top of your scene.</small></div>';
    } else if (src.type === 'image') {
        typeFields = '<div class="field"><button type="button" class="obs-btn" data-act-props="replace-image">Replace image</button></div>';
    } else {
        typeFields = '<p class="hint">To share something else, remove this source and add a new Display Capture.</p>';
    }

    dlg.innerHTML = `
        <div class="dialog-body">
            <button type="button" class="dialog-close" data-close aria-label="Close">&times;</button>
            <h2>Properties</h2>
            <form id="propsForm" class="props-form" novalidate>
                <div class="field"><label for="pName">Name</label><input id="pName" name="name" maxlength="40" value="${esc(src.name)}"></div>
                ${typeFields}
                <div class="field"><span class="label">Layout</span>
                    <div class="preset-grid">${PRESETS.map(([k, l]) => `<button type="button" class="obs-btn" data-preset="${k}">${l}</button>`).join('')}</div></div>
                <div class="field"><label for="pScale">Size <output id="pScaleOut">${Math.round(it.scale * 100)}%</output></label>
                    <input id="pScale" name="scale" type="range" min="5" max="150" value="${Math.round(it.scale * 100)}"></div>
                <button type="button" class="btn btn-primary btn-block" data-close>Done</button>
            </form>
        </div>`;

    const form = $('#propsForm');
    form.addEventListener('input', (e) => {
        const n = e.target.name;
        if (n === 'name') { src.name = e.target.value.trim() || src.name; renderSources(); }
        else if (n === 'scale') { it.scale = Number(e.target.value) / 100; $('#pScaleOut').textContent = `${e.target.value}%`; updateSelBox(); }
        else if (src.type === 'chat' && ['width', 'lines', 'size'].includes(n)) { src.props[n] = Number(e.target.value); renderChatSource(src); updateSelBox(); }
        else if (src.type === 'text' && ['text', 'size', 'color'].includes(n)) { src.props[n] = n === 'size' ? Number(e.target.value) : e.target.value; renderText(src); updateSelBox(); }
    });
    form.addEventListener('change', (e) => {
        const n = e.target.name;
        if (n === 'bg') { src.props.bg = e.target.checked; if (src.type === 'chat') renderChatSource(src); else renderText(src); updateSelBox(); }
        else if (n === 'cam') guarded(async () => { await replaceCamera(src, e.target.value); refreshAll(); });
    });
    form.addEventListener('click', (e) => {
        const p = e.target.closest('[data-preset]');
        if (p) { applyPreset(it, srcAspect(src), p.dataset.preset); $('#pScale').value = Math.round(it.scale * 100); $('#pScaleOut').textContent = `${$('#pScale').value}%`; updateSelBox(); }
        if (e.target.closest('[data-act-props="edit-alerts"]')) { guarded(openAlertsEditor); return; }
        if (e.target.closest('[data-act-props="replace-image"]')) {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/png,image/jpeg,image/webp,image/gif';
            input.onchange = () => input.files[0] && guarded(async () => {
                const fresh = await addImageSource(input.files[0]);
                src.img = fresh.img;
                S.sources.delete(fresh.id);
                refreshAll();
            });
            input.click();
        }
    });
    form.addEventListener('submit', (e) => e.preventDefault());
    dlg.addEventListener('close', refreshAll, { once: true });
    dlg.showModal();
}

async function openSettings() {
    const dlg = $('#settingsDialog');
    const c = S.cfg;
    const live = !!broadcast;
    const devs = await listDevices();
    const devOpts = (list, label) => [['', `Default ${label}`], ...list.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => [d.deviceId, d.label || `${label[0].toUpperCase() + label.slice(1)} ${i + 1}`])];
    const chk = (name, label, on, hint = '') => `<label class="check"><input type="checkbox" name="${name}"${on ? ' checked' : ''}><span><strong>${label}</strong>${hint ? `<small>${hint}</small>` : ''}</span></label>`;

    dlg.innerHTML = `
        <div class="dialog-body">
            <button type="button" class="dialog-close" data-close aria-label="Close">&times;</button>
            <h2>Settings</h2>
            <form id="settingsForm" class="props-form" novalidate>
                <fieldset class="panel-section"><legend>Video</legend>
                    <div class="field-row">
                        <div class="field"><label for="sRes">Output resolution</label>
                            <select id="sRes" name="res"${live ? ' disabled' : ''}>${optionList([['480', '854\u00d7480'], ['720', '1280\u00d7720'], ['1080', '1920\u00d71080']], c.res)}</select></div>
                        <div class="field"><label for="sFps">Frame rate</label>
                            <select id="sFps" name="fps"${live ? ' disabled' : ''}>${optionList([['24', '24 fps'], ['30', '30 fps'], ['60', '60 fps']], c.fps)}</select></div>
                    </div>
                    ${live ? '<small class="hint">Resolution and frame rate can\u2019t change while you\u2019re live.</small>' : ''}
                    <div class="field"><label for="sBit">Maximum bitrate</label>
                        <select id="sBit" name="bitrate">${optionList([['1000', '1 Mbps (low)'], ['2500', '2.5 Mbps (recommended)'], ['4000', '4 Mbps (high)'], ['6000', '6 Mbps (max)']], c.bitrate)}</select>
                        <small>Viewers can also pick a lower quality themselves. Each one uses up to this much of your upload.</small></div>
                    <div class="field"><label for="sHint">Optimize for</label>
                        <select id="sHint" name="hint">${optionList([['auto', 'Automatic'], ['motion', 'Motion (games, sports)'], ['detail', 'Detail (text, code, slides)']], c.hint)}</select></div>
                    <div class="field"><label for="sCam">Default camera</label>
                        <select id="sCam" name="cam">${optionList(devOpts(devs.cams, 'camera'), c.videoDeviceId)}</select>
                        ${devs.cams.some((d) => /obs/i.test(d.label)) ? '<small class="ok-note">OBS Virtual Camera detected.</small>' : ''}</div>
                </fieldset>
                <fieldset class="panel-section"><legend>Audio</legend>
                    <div class="field"><label for="sMic">Microphone</label>
                        <select id="sMic" name="mic">${optionList(devOpts(devs.mics, 'microphone'), c.audioDeviceId)}</select></div>
                    <div class="stack">
                        ${chk('ns', 'Noise suppression', c.ns)}
                        ${chk('ec', 'Echo cancellation', c.ec, 'Turn off for music or if you use a studio mic')}
                        ${chk('agc', 'Automatic gain', c.agc)}
                    </div>
                </fieldset>
                <details class="obs-help" id="obsHelp" open>
                    <summary>Connect OBS</summary>
                    <div id="obsConn" class="obs-conn"><p class="muted">Loading\u2026</p></div>
                </details>
                <button type="button" class="btn btn-primary btn-block" data-close>Done</button>
            </form>
        </div>`;

    const form = $('#settingsForm');
    form.addEventListener('change', (e) => {
        const n = e.target.name;
        const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        if (n === 'res') setOutputSize(v);
        else if (n === 'fps') setFps(v);
        else if (n === 'bitrate') { c.bitrate = v; saveCfg(); applyLiveSettings(); }
        else if (n === 'hint') { c.hint = v; saveCfg(); applyLiveSettings(); }
        else if (n === 'cam') { c.videoDeviceId = v; saveCfg(); }
        else if (['mic', 'ns', 'ec', 'agc'].includes(n)) {
            if (n === 'mic') c.audioDeviceId = v; else c[n] = v;
            saveCfg();
            if (micChannel()) guarded(enableMic).then(refreshAll); // restart the mic with the new settings
        }
    });
    form.addEventListener('submit', (e) => e.preventDefault());
    dlg.showModal();
    loadObsConnection(dlg);
}

const FALLBACK_OBS_HELP = `
    <ol>
        <li>In OBS, click <strong>Start Virtual Camera</strong>.</li>
        <li>Here, add a <strong>Video Capture Device</strong> source and pick <strong>OBS Virtual Camera</strong>.</li>
        <li>The virtual camera carries no sound. Choose your microphone, or a virtual audio cable (like VB-Cable) that OBS sends its audio to.</li>
    </ol>`;

async function loadObsConnection(dlg) {
    const box = $('#obsConn', dlg);
    if (!state.config.media.enabled) {
        box.innerHTML = `${FALLBACK_OBS_HELP}<p class="hint">With a media server (MediaMTX) OBS can connect directly and many more people can watch. See the README.</p>`;
        return;
    }
    const render = (info) => {
        box.innerHTML = `
            <p>In <strong>OBS 30 or newer</strong>: Settings \u2192 Stream \u2192 Service <strong>WHIP</strong>, and paste:</p>
            <div class="field"><label for="obsSrv">Server</label>
                <div class="copy-row"><input id="obsSrv" readonly value="${esc(info.whip)}"><button type="button" class="obs-btn" data-copy="obsSrv">Copy</button></div></div>
            <div class="field"><label for="obsKey">Bearer Token (your private stream key)</label>
                <div class="copy-row"><input id="obsKey" type="password" readonly value="${esc(info.key)}">
                    <button type="button" class="obs-btn" data-show="obsKey">Show</button><button type="button" class="obs-btn" data-copy="obsKey">Copy</button></div>
                <small>Never share it: anyone with it can stream as you.</small></div>
            <p>Then press <strong>Go live from OBS</strong> in the controls, and click <em>Start Streaming</em> in OBS. Keep this page open while you stream.</p>
            <button type="button" class="obs-btn" data-reset-key>Make a new key</button>
            <details class="obs-sub"><summary>No WHIP in your OBS?</summary>${FALLBACK_OBS_HELP}</details>`;
    };
    try { render(await api('/stream/key')); } catch (e) { box.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; return; }
    box.addEventListener('click', async (e) => {
        const copy = e.target.closest('[data-copy]');
        const show = e.target.closest('[data-show]');
        if (copy) {
            try { await navigator.clipboard.writeText($('#' + copy.dataset.copy, box).value); toast('Copied.'); } catch { toast('Select the text and copy it.'); }
        } else if (show) {
            const f = $('#' + show.dataset.show, box);
            f.type = f.type === 'password' ? 'text' : 'password';
            show.textContent = f.type === 'password' ? 'Show' : 'Hide';
        } else if (e.target.closest('[data-reset-key]')) {
            try { render((await api('/stream/key/reset', { method: 'POST' }))); toast('New key created. Update it in OBS.'); } catch (err) { toast(err.message); }
        }
    });
}
