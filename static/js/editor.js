'use strict';

/* =========================================================================
   Video editor (#/editor, #/editor/<clip id> and #/editor/project/<project id>)

   Everything happens in the browser: the clips are played into a <canvas> (with the filters, adjustments and the texts
   and stickers drawn on top) and the sound goes through Web Audio. Exporting plays the timeline once, in real time, and
   records that canvas and that sound with MediaRecorder. The result is uploaded as a new private clip
   (POST /api/vod/new + /chunk + /finish, see yeli/vods.py). There is NO download: a stream and what is made from it can
   only be watched and published on Yeli.

   What it can do: bring your clips and streams (or a video from your device), cut, trim to the playhead, split, join in
   any order, speed (0.25x to 4x), volume, 12 filters, brightness / contrast / saturation / blur / opacity, rotate, flip,
   zoom and move, fade in and out, fit or crop to the frame, 16:9, 9:16, 1:1 and 4:5, a background (black, blurred, white
   or a colour), texts with fonts, outline, shadow and animation, stickers, a watermark with your name, a music track
   from your device, undo and redo.

   PROJECTS: the work is saved on the server as a project (yeli/projects.py), so it can be continued later and from
   another device. It autosaves. Videos from your device and music are not stored, they have to be added again.

   THE 70% RULE: an edited video must be at least EDIT_MIN_LIVE_PCT % footage from your live streams. The meter in the top
   bar shows it; the server measures it again from the saved project when the export starts.
   ========================================================================= */
const ED_FILTERS = [
    ['none', 'No filter', 'none'],
    ['bw', 'Black and white', 'grayscale(1)'],
    ['noir', 'Noir', 'grayscale(1) contrast(1.4) brightness(0.85)'],
    ['sepia', 'Sepia', 'sepia(0.9)'],
    ['retro', 'Retro', 'sepia(0.5) contrast(1.1) hue-rotate(-12deg) saturate(1.3)'],
    ['vivid', 'Vivid', 'saturate(1.7) contrast(1.1)'],
    ['warm', 'Warm', 'sepia(0.35) saturate(1.3) brightness(1.05)'],
    ['cool', 'Cool', 'hue-rotate(18deg) saturate(1.1) brightness(1.03)'],
    ['cinema', 'Cinema', 'contrast(1.2) brightness(0.9) saturate(0.85)'],
    ['fade', 'Faded', 'contrast(0.85) brightness(1.1) saturate(0.8)'],
    ['dream', 'Dream', 'brightness(1.1) saturate(1.25) blur(1px)'],
    ['blur', 'Blur', 'blur(4px)'],
];
const ED_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const ED_FADES = [0, 0.5, 1, 2];
const ED_ASPECTS = { '16:9': [16, 9, 'Wide (16:9)'], '9:16': [9, 16, 'Vertical (9:16)'], '1:1': [1, 1, 'Square (1:1)'], '4:5': [4, 5, 'Portrait (4:5)'] };
const ED_QUALITY = { 1080: 8000000, 720: 4000000, 480: 2000000, 360: 1000000 };
const ED_FONTS = [['Fredoka', 'Round'], ['Arial', 'Clean'], ['Georgia', 'Serif'], ['Impact', 'Bold'], ['Courier New', 'Typewriter']];
const ED_ANIMS = [['none', 'None'], ['fade', 'Fade'], ['pop', 'Pop'], ['slide', 'Slide up']];
const ED_BGS = [['black', 'Black'], ['blur', 'Blurred video'], ['white', 'White'], ['color', 'Colour']];
const ED_CORNERS = [['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']];
const ED_STICKERS = ['\u{1F602}', '\u{1F525}', '\u{1F60D}', '\u{1F62E}', '\u{1F44F}', '\u{1F64C}', '\u{1F4AF}', '\u{2764}\u{FE0F}', '\u{1F480}', '\u{1F60E}', '\u{1F92F}', '\u{1F631}',
    '\u{1F3C6}', '\u{1F451}', '\u{1F3AE}', '\u{1F3A7}', '\u{1F4A5}', '\u{2728}', '\u{1F389}', '\u{1F44D}', '\u{1F440}', '\u{1F4A1}', '\u{26A1}', '\u{1F680}',
    '\u{27A1}\u{FE0F}', '\u{2B05}\u{FE0F}', '\u{2B06}\u{FE0F}', '\u{2B07}\u{FE0F}', '\u{2705}', '\u{274C}', '\u{2757}', '\u{2753}', '\u{1F4AC}', '\u{1F534}', '\u{1F4F8}', '\u{1F3AC}'];
const ED_MIN = 0.1; // the shortest piece of video or text, in seconds
const ED_MIN_LIVE = 70; // replaced by what the server says (EDIT_MIN_LIVE_PCT)
const ED_FILTER_OK = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;

let edUidN = 0;
const edUid = () => `e${++edUidN}`;
const edClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const edFmt = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`; };
const edFmtShort = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const edNum = (v, fallback = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; };

const ED_ICON = {
    play: ['<path d="M7 4l13 8-13 8z"/>', 'currentColor'],
    pause: ['<path d="M7 4h3v16H7zM14 4h3v16h-3z"/>', 'currentColor'],
    start: ['<path d="M6 5v14M20 5L10 12l10 7z"/>'],
    end: ['<path d="M18 5v14M4 5l10 7-10 7z"/>'],
    cut: ['<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>'],
    copy: ['<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>'],
    trash: [TRASH_PATH],
    left: ['<path d="M15 5l-7 7 7 7"/>'],
    right: ['<path d="M9 5l7 7-7 7"/>'],
    text: ['<path d="M5 7V4h14v3M12 4v16M9 20h6"/>'],
    undo: ['<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'],
    redo: ['<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'],
    plus: ['<path d="M12 5v14M5 12h14"/>'],
    minus: ['<path d="M5 12h14"/>'],
    upload: ['<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>'],
    download: ['<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>'],
    film: [FILM_PATH],
    globe: [GLOBE_PATH],
    speed: ['<path d="M4.5 18a8.5 8.5 0 1 1 15 0"/><path d="M12 14l4-5"/><circle cx="12" cy="14" r="1.2"/>'],
    volume: ['<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'],
    mute: ['<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>'],
    filter: ['<circle cx="9" cy="10" r="5.5"/><circle cx="15.5" cy="10" r="5.5"/><circle cx="12.3" cy="15.5" r="5.5"/>'],
    fade: ['<path d="M3 20L21 4v16z"/>'],
    crop: ['<path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2"/>'],
    format: ['<rect x="3" y="6" width="18" height="12" rx="2"/>'],
    back: ['<path d="M15 5l-7 7 7 7"/>'],
    check: ['<path d="M5 12.5l4.5 4.5L19 7.5"/>'],
    close: ['<path d="M6 6l12 12M18 6L6 18"/>'],
    style: ['<path d="M5 19L12 5l7 14M8 14h8"/>'],
    align: ['<path d="M4 6h16M4 12h10M4 18h16"/>'],
    pen: [EDIT_PATH],
    save: ['<path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v6h7V3M8 21v-7h8v7"/>'],
    rotate: ['<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'],
    flip: ['<path d="M12 3v18"/><path d="M8 7L3 17h5zM16 7l5 10h-5z"/>'],
    zoomtool: ['<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>'],
    adjust: ['<path d="M5 4v16M12 4v16M19 4v16"/><circle cx="5" cy="14" r="2.2" fill="#17171a"/><circle cx="12" cy="8" r="2.2" fill="#17171a"/><circle cx="19" cy="16" r="2.2" fill="#17171a"/>'],
    sticker: ['<path d="M20 12a8 8 0 1 1-8-8h1a7 7 0 0 0 7 7z"/><path d="M9 10h.01M14 14c-1 1-3 1-4 0"/>'],
    music: ['<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'],
    bg: ['<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15l5-5 4 4 3-3 6 6"/>'],
    wm: ['<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M13 15h6M13 12h6"/>'],
    anim: ['<path d="M5 19l5-14 3 8 3-4 3 10"/>'],
    trimstart: ['<path d="M4 4v16M9 12h11M14 7l5 5-5 5"/>'],
    trimend: ['<path d="M20 4v16M15 12H4M10 7l-5 5 5 5"/>'],
    project: ['<path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>'],
    fitzoom: ['<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'],
    live: ['<circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4"/>'],
    cover: ['<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/>'],
};
const edIc = (name, size = 18) => IC(ED_ICON[name][0], ED_ICON[name][1] || 'none', size);

/** The project. It outlives the page so that you can look at a video and come back without losing the work. */
let EDP = null;

function edNewProject() {
    return {
        id: null,               // the saved project on the server, once it has been saved
        title: '',
        assets: new Map(),      // id -> { id, name, url, el, duration, thumb, node, gain, share }
        clips: [],              // the timeline, in order: { uid, asset, in, out, speed, volume, filter, fadeIn, fadeOut, fit, ...see edNewClip }
        texts: [],              // texts and stickers: { uid, kind, text, start, dur, size, color, bg, font, ... }, start and dur in timeline seconds
        aspect: '16:9',
        bg: 'black', bgColor: '#000000',
        watermark: { on: false, text: '', pos: 'br' },
        music: null,            // { asset, volume, start }: a song from the device
        sel: null,              // { type: 'clip' | 'text', uid }
        t: 0,                   // the playhead, in timeline seconds
        zoom: 60,               // pixels per second of the timeline
        playing: false,
        active: null,           // uid of the clip whose video element is playing
        prep: null,
        undo: [], redo: [], lastKey: '', lastAt: 0,
        dirty: false,
        saving: false, savePromise: null, savedAt: 0, saveErr: '', ver: 0,
        exporting: false,
        ac: null, speaker: null, dest: null,
        bin: [],                // my clips and videos, from the server
        minLive: ED_MIN_LIVE,   // the least share of live footage an edit can have (the server decides)
        mounted: null,          // the open editor page: { draw }
    };
}

window.addEventListener('beforeunload', (e) => {
    if (EDP && (EDP.exporting || (EDP.dirty && EDP.clips.length))) { e.preventDefault(); e.returnValue = ''; }
});

/* ---------- time math ---------- */
const edClipDur = (c) => (c.out - c.in) / c.speed;

function edLayout(P) {
    let at = 0;
    const items = P.clips.map((c) => { const start = at; at += edClipDur(c); return { c, start, end: at }; });
    return { items, total: at };
}
const edTotal = (P) => edLayout(P).total;

/** How much of the timeline is footage from live streams: a live clip counts in full, an earlier edit for its own share, a video
 *  from the device not at all. The server measures it again from the saved project (yeli/projects.py), so this is the same sum. */
function edLive(P) {
    let live = 0, total = 0;
    for (const c of P.clips) { const d = edClipDur(c); total += d; live += d * (c.asset.share || 0); }
    const pct = total > 0 ? Math.floor(live * 100 / total + 1e-9) : 0;
    // what it would take to reach the minimum: seconds of other footage to remove, or seconds of live footage to add
    const need = P.minLive / 100;
    const removeOther = need > 0 ? Math.max(0, (total - live) - live * (1 - need) / need) : 0;
    const addLive = need >= 1 ? 0 : Math.max(0, (need * total - live) / (1 - need));
    return { live, total, pct, ok: total > 0 && pct >= P.minLive, removeOther, addLive };
}

function edLocate(L, t) {
    if (!L.items.length) return null;
    for (let i = 0; i < L.items.length; i++) {
        const it = L.items[i];
        if (t < it.end || i === L.items.length - 1) return { idx: i, c: it.c, local: edClamp(t - it.start, 0, it.end - it.start), item: it };
    }
    return null;
}

/** 0 to 1: how visible the clip is at this moment (fade in at the start, fade out at the end). */
function edFade(c, local, dur) {
    let f = 1;
    if (c.fadeIn > 0 && local < c.fadeIn) f = Math.min(f, local / c.fadeIn);
    if (c.fadeOut > 0 && dur - local < c.fadeOut) f = Math.min(f, (dur - local) / c.fadeOut);
    return edClamp(f, 0, 1);
}

/* ---------- sound: every video goes through Web Audio, so the volume can go above 100% and the export hears it ---------- */
function edAudio(P) {
    if (P.ac) return P.ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
        P.ac = new AC();
        P.speaker = P.ac.createGain();
        P.speaker.connect(P.ac.destination);
        P.dest = P.ac.createMediaStreamDestination();
    } catch { P.ac = null; }
    return P.ac;
}

function edWire(P, a) {
    if (a.node || !P.ac) return;
    try {
        a.node = P.ac.createMediaElementSource(a.el);
        a.gain = P.ac.createGain();
        a.node.connect(a.gain);
        a.gain.connect(P.speaker);
        a.gain.connect(P.dest);
    } catch { a.node = null; a.gain = null; }
}

function edSetGain(a, v) {
    if (a.gain) a.gain.gain.value = v;
    else a.el.volume = edClamp(v, 0, 1);
}

/* ---------- videos ---------- */
const edOnce = (el, name, ms) => new Promise((resolve) => {
    const done = () => { el.removeEventListener(name, done); clearTimeout(to); resolve(); };
    const to = setTimeout(done, ms);
    el.addEventListener(name, done);
});

/** Recorded videos have no length until the end is asked for once (same trick as the video page). */
async function edFixDuration(el) {
    const wait = new Promise((resolve) => {
        const check = () => { if (Number.isFinite(el.duration)) { el.removeEventListener('timeupdate', check); resolve(); } };
        el.addEventListener('timeupdate', check);
        setTimeout(() => { el.removeEventListener('timeupdate', check); resolve(); }, 6000);
    });
    try { el.currentTime = 1e101; } catch { /* not seekable */ }
    await wait;
    try { el.currentTime = 0; } catch { /* nothing */ }
}

/** Phones don't decode a video before it plays, so the preview would stay black: play it for a moment, muted. */
async function edPrime(el) {
    if (el.readyState >= 2) return;
    const was = el.muted;
    el.muted = true;
    try { await Promise.race([el.play(), new Promise((r) => setTimeout(r, 1500))]); } catch { /* needs a tap: the first Play shows it */ }
    el.pause();
    el.muted = was;
    try { el.currentTime = 0; } catch { /* nothing */ }
}

async function edLoadAsset(P, info) {
    if (P.assets.has(info.key)) return P.assets.get(info.key);
    const el = document.createElement('video');
    el.playsInline = true;
    el.preload = 'auto';
    el.src = info.url;
    const a = { id: info.key, name: info.name, url: info.url, el, duration: info.duration || 0, thumb: info.thumb || '', node: null, gain: null, share: info.share || 0 };
    await new Promise((resolve, reject) => {
        el.addEventListener('loadedmetadata', resolve, { once: true });
        el.addEventListener('error', () => reject(new Error('This browser can\u2019t open that video.')), { once: true });
    });
    if (!Number.isFinite(el.duration)) await edFixDuration(el);
    if (Number.isFinite(el.duration) && el.duration > 0) a.duration = el.duration;
    if (!(a.duration > 0)) throw new Error('This video has no length, so it can\u2019t be edited.');
    await edPrime(el);
    if (!a.thumb) {                                  // a video from the device: a small picture for the timeline
        try {
            el.currentTime = Math.min(0.5, a.duration / 2);
            await edOnce(el, 'seeked', 2500);
            const c = document.createElement('canvas');
            c.width = 160; c.height = 90;
            c.getContext('2d').drawImage(el, 0, 0, 160, 90);
            a.thumb = c.toDataURL('image/jpeg', 0.6);
            el.currentTime = 0;
        } catch { /* no picture */ }
    }
    for (const ev of ['seeked', 'loadeddata', 'canplay']) el.addEventListener(ev, () => { if (P.mounted) P.mounted.draw(); });
    P.assets.set(a.id, a);
    edWire(P, a);
    return a;
}

const edNewClip = (asset) => ({
    uid: edUid(), asset, in: 0, out: asset.duration, speed: 1, volume: 1, filter: 'none', fadeIn: 0, fadeOut: 0, fit: 'fit',
    rot: 0, flipH: false, flipV: false, zoom: 1, px: 0, py: 0,           // turn quarter turns, mirror, zoom in and move
    bright: 0, contrast: 0, sat: 0, blur: 0, opacity: 1,                // adjustments, -100..100 (blur 0..20, opacity 0..1)
});

const edNewText = (kind, text, start, dur) => ({
    uid: edUid(), kind, text, start, dur, size: kind === 'sticker' ? 16 : 7, color: '#ffffff', bg: false, pos: 'bottom',
    font: 'Fredoka', bold: true, italic: false, outline: true, shadow: false, anim: 'none',
    x: 50, y: kind === 'sticker' ? 50 : 88, rot: 0, opacity: 1,
});

const ED_POS_Y = { top: 12, middle: 50, bottom: 88 };

/** What the server stores for a clip: the video is named, never included. Videos from the device can't be stored. */
const edClipOut = (c) => ({
    uid: c.uid, a: c.asset.id, name: c.asset.name, in: c.in, out: c.out, speed: c.speed, volume: c.volume, filter: c.filter, fadeIn: c.fadeIn,
    fadeOut: c.fadeOut, fit: c.fit, rot: c.rot, flipH: c.flipH, flipV: c.flipV, zoom: c.zoom, px: c.px, py: c.py,
    bright: c.bright, contrast: c.contrast, sat: c.sat, blur: c.blur, opacity: c.opacity,
});
const edProjectData = (P) => ({ aspect: P.aspect, bg: P.bg, bgColor: P.bgColor, watermark: P.watermark, clips: P.clips.map(edClipOut), texts: P.texts });

function edMissing() {
    if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return 'This browser can\u2019t record the edited video. Use a recent Chrome, Edge or Firefox on a computer.';
    return '';
}

const edDefaultTitle = (P) => `${(P.clips[0] && P.clips[0].asset.name) || 'Edited video'}`.slice(0, 66) + ' (edit)';

/** Saves the project on the server (creating it the first time). Several calls at once share the same request. */
function edSave(P) {
    if (P.savePromise) return P.savePromise;
    const ver = P.ver;
    P.saving = true;
    P.savePromise = (async () => {
        try {
            const r = await api('/projects', { method: 'POST', body: { id: P.id || undefined, title: P.title || edDefaultTitle(P), data: edProjectData(P) } });
            P.id = r.project.id;
            P.title = r.project.title;
            if (r.min_live) P.minLive = r.min_live;
            P.savedAt = Date.now();
            P.saveErr = '';
            if (P.ver === ver) P.dirty = false;
            return r.project;
        } catch (e) {
            P.saveErr = e.message || 'Couldn\u2019t save.';
            throw e;
        } finally {
            P.saving = false;
            P.savePromise = null;
        }
    })();
    return P.savePromise;
}
const edSaveQuiet = (P) => edSave(P).catch(() => {});

async function pageEditor(root, route, alive) {
    document.title = 'Video editor | Yeli';
    if (!state.me) {
        root.innerHTML = emptyState('Video editor', 'Log in to cut and join your clips and streams, add texts and publish the result.',
            '<button type="button" class="btn btn-primary" data-auth="login">Log In</button>', 'broadcast');
        return;
    }
    const missing = edMissing();
    if (missing) { root.innerHTML = emptyState('Video editor', esc(missing), '<a class="btn btn-secondary" href="#/clips">Back to Clips</a>', 'broadcast'); return; }

    // #/editor/project/<id> opens a saved project; #/editor/<id> adds that clip; #/editor continues what is open
    const projectId = route.startsWith('project/') ? route.slice(8) : '';
    const vodId = projectId ? '' : route;
    if (projectId && EDP && EDP.id !== projectId) {
        if (EDP.dirty && EDP.id && EDP.clips.length) edSaveQuiet(EDP);       // leaving another saved project: keep its latest changes
        EDP = null;
    }
    const P = EDP || (EDP = edNewProject());
    root.innerHTML = `
    <div class="ed">
        <header class="ed-bar">
            <a class="ed-ib" href="#/clips" id="edClose" aria-label="Close the editor" title="Close">${edIc('close', 22)}</a>
            <button type="button" class="ed-title" id="edTitle" data-act="project" title="Project"><span id="edTitleText">Untitled project</span><small id="edSaveState"></small></button>
            <button type="button" class="ed-live" id="edLive" data-act="project" title="Share of the video that is footage from your live streams"></button>
            <button type="button" class="ed-ib" id="edSave" data-act="save" aria-label="Save project" title="Save project (Ctrl+S)">${edIc('save', 20)}</button>
            <button type="button" class="ed-export-btn" id="edExport">Export</button>
        </header>
        <section class="ed-stage" id="edStage" aria-label="Preview">
            <div class="ed-screen" id="edScreen">
                <canvas id="edCanvas" width="1280" height="720"></canvas>
                <div class="ed-screen-empty" id="edEmpty"><strong>Start with a clip</strong><span>Tap the + on the timeline to add one.</span></div>
            </div>
        </section>
        <div class="ed-transport">
            <span class="ed-time" id="edTime" aria-live="off">0:00.0 / 0:00.0</span>
            <button type="button" class="ed-play" id="edPlay" aria-label="Play" title="Play (Space)">${edIc('play', 22)}</button>
            <div class="ed-tr-r">
                <button type="button" class="ed-ib ed-zoom" data-act="zoomfit" aria-label="Fit the timeline" title="Fit the timeline">${edIc('fitzoom', 18)}</button>
                <button type="button" class="ed-ib ed-zoom" data-act="zoomout" aria-label="Zoom out" title="Zoom out">${edIc('minus', 18)}</button>
                <button type="button" class="ed-ib ed-zoom" data-act="zoomin" aria-label="Zoom in" title="Zoom in">${edIc('plus', 18)}</button>
                <button type="button" class="ed-ib" id="edUndo" aria-label="Undo" title="Undo (Ctrl+Z)">${edIc('undo', 20)}</button>
                <button type="button" class="ed-ib" id="edRedo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)">${edIc('redo', 20)}</button>
            </div>
        </div>
        <section class="ed-tl" aria-label="Timeline">
            <div class="ed-tl-wrap">
                <div class="ed-tl-scroll" id="edScroll">
                    <div class="ed-tl-inner" id="edInner">
                        <div class="ed-ruler" id="edRuler"></div>
                        <div class="ed-track ed-track-t" id="edTrackT"></div>
                        <div class="ed-track ed-track-v" id="edTrackV"></div>
                        <div class="ed-track ed-track-m" id="edTrackM"></div>
                    </div>
                </div>
                <div class="ed-playhead" aria-hidden="true"></div>
            </div>
        </section>
        <section class="ed-bottom" id="edInsp" aria-label="Tools"></section>
        <div class="ed-sheet" id="edSheet" hidden>
            <div class="ed-sheet-card" role="dialog" aria-label="Add a clip">
                <div class="ed-sheet-head"><strong>Add a clip</strong><button type="button" class="ed-ib" data-sheet-close aria-label="Close">${edIc('close', 20)}</button></div>
                <label class="ed-device">${edIc('upload', 20)}<span>Add a video from this device</span><input type="file" id="edFile" accept="video/*" hidden></label>
                <p class="ed-sheet-note muted">Videos from your device don\u2019t count as live footage and aren\u2019t kept in a saved project.</p>
                <p class="ed-sheet-sub">Your live streams, clips and videos</p>
                <div class="ed-bin-grid" id="edBin"><p class="muted">Loading\u2026</p></div>
            </div>
        </div>
    </div>`;

    const canvas = $('#edCanvas'), ctx = canvas.getContext('2d');
    const binEl = $('#edBin'), insp = $('#edInsp'), scroll = $('#edScroll'), inner = $('#edInner');
    const rulerEl = $('#edRuler'), trackV = $('#edTrackV'), trackT = $('#edTrackT'), trackM = $('#edTrackM'), stage = $('#edStage');
    const timeEl = $('#edTime'), playBtn = $('#edPlay'), emptyEl = $('#edEmpty'), sheet = $('#edSheet');
    const liveEl = $('#edLive'), titleText = $('#edTitleText'), saveState = $('#edSaveState');
    let tool = null;      // the panel that is open above the toolbar (see renderInspector)
    let skipClick = -1e9; // a tap that really was the end of a drag must not select or deselect anything
    let lastSet = 0;
    let raf = 0, lastNow = 0, exportCtl = null;
    let saveTimer = 0;

    /* ---------- the picture ---------- */
    function sizeCanvas(shortSide = 0) {
        const [aw, ah] = ED_ASPECTS[P.aspect];
        const even = (n) => Math.max(2, Math.round(n / 2) * 2);
        let w, h;
        if (shortSide) { if (aw >= ah) { h = shortSide; w = even(shortSide * aw / ah); } else { w = shortSide; h = even(shortSide * ah / aw); } }
        else if (aw >= ah) { w = 1280; h = even(1280 * ah / aw); } else { h = 1280; w = even(1280 * aw / ah); }
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        fitScreen();
    }

    /** The preview takes as much of the free room as its shape allows. */
    function fitScreen() {
        const [aw, ah] = ED_ASPECTS[P.aspect];
        const W = stage.clientWidth, H = stage.clientHeight;
        if (!W || !H) return;
        const k = Math.min(W / aw, H / ah);
        const scr = $('#edScreen');
        scr.style.width = `${Math.floor(aw * k)}px`;
        scr.style.height = `${Math.floor(ah * k)}px`;
    }

    function wrapLines(text, maxW) {
        const out = [];
        for (const para of text.split('\n')) {
            let line = '';
            for (const word of para.split(/\s+/).filter(Boolean)) {
                const test = line ? `${line} ${word}` : word;
                if (line && ctx.measureText(test).width > maxW) { out.push(line); line = word; } else line = test;
            }
            out.push(line);
        }
        return out.length ? out : [''];
    }

    const easeOut = (k) => 1 - (1 - k) ** 3;
    const easeBack = (k) => 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2;
    const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

    /** A text or a sticker, with its font, outline, shadow, turn, see-through level and entrance. `local` is the time since it appeared. */
    function drawText(tx, local) {
        const H = canvas.height, W = canvas.width;
        const sticker = tx.kind === 'sticker';
        const px = Math.max(8, Math.round(tx.size / 100 * H));
        let alpha = tx.opacity, scale = 1, dy = 0;
        const k = edClamp(local / 0.4, 0, 1), out = edClamp((tx.dur - local) / 0.3, 0, 1);
        if (tx.anim === 'fade') alpha *= Math.min(k, out);
        else if (tx.anim === 'pop') { scale = Math.max(0.01, easeBack(edClamp(local / 0.35, 0, 1))); alpha *= out; }
        else if (tx.anim === 'slide') { dy = (1 - easeOut(k)) * H * 0.08; alpha *= Math.min(k, out); }
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(tx.x / 100 * W, tx.y / 100 * H + dy);
        ctx.rotate(tx.rot * Math.PI / 180);
        ctx.scale(scale, scale);
        ctx.font = sticker ? `${px}px ${EMOJI_FONT}` : `${tx.italic ? 'italic ' : ''}${tx.bold ? 700 : 400} ${px}px "${tx.font}", "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lines = sticker ? [tx.text] : wrapLines(tx.text, W * 0.88);
        const lh = px * 1.25, blockH = lines.length * lh;
        if (tx.bg && !sticker) {
            const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + px * 0.9;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
            ctx.fillRect(-w / 2, -blockH / 2 - px * 0.3, w, blockH + px * 0.6);
        }
        if (tx.shadow && !sticker) { ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'; ctx.shadowBlur = px * 0.3; ctx.shadowOffsetY = px * 0.07; }
        ctx.lineJoin = 'round';
        ctx.lineWidth = px * 0.14;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillStyle = tx.color;
        lines.forEach((l, i) => {
            const y = -blockH / 2 + lh * (i + 0.5);
            if (!sticker && !tx.bg && tx.outline) ctx.strokeText(l, 0, y);
            ctx.fillText(l, 0, y);
        });
        ctx.restore();
    }

    /** The preset filter plus the sliders of the Adjust panel, as one canvas filter. */
    function clipFilter(c, H) {
        if (!ED_FILTER_OK) return 'none';
        const parts = [];
        const preset = (ED_FILTERS.find((f) => f[0] === c.filter) || ED_FILTERS[0])[2];
        if (preset !== 'none') parts.push(preset);
        if (c.bright) parts.push(`brightness(${1 + c.bright / 100})`);
        if (c.contrast) parts.push(`contrast(${1 + c.contrast / 100})`);
        if (c.sat) parts.push(`saturate(${1 + c.sat / 100})`);
        if (c.blur) parts.push(`blur(${(c.blur * H / 720).toFixed(1)}px)`);
        return parts.length ? parts.join(' ') : 'none';
    }

    /** Draws the video turned, mirrored, zoomed and moved. `s` is the size of the picture in the frame. */
    function placeVideo(el, c, s, cx, cy) {
        const vw = el.videoWidth, vh = el.videoHeight;
        ctx.translate(cx, cy);
        ctx.scale(c.flipH ? -1 : 1, c.flipV ? -1 : 1);
        ctx.rotate(c.rot * Math.PI / 2);
        ctx.drawImage(el, -vw * s / 2, -vh * s / 2, vw * s, vh * s);
    }

    function drawClip(c, local) {
        const W = canvas.width, H = canvas.height, el = c.asset.el;
        if (!(el.readyState >= 2 && el.videoWidth)) return;
        const turned = c.rot % 2 === 1;
        const dw = turned ? el.videoHeight : el.videoWidth, dh = turned ? el.videoWidth : el.videoHeight;
        const s = (c.fit === 'fill' ? Math.max(W / dw, H / dh) : Math.min(W / dw, H / dh)) * c.zoom;
        if (P.bg === 'blur' && c.fit !== 'fill' && ED_FILTER_OK) {            // the same picture, big and blurred, behind it
            ctx.save();
            ctx.globalAlpha = edFade(c, local, edClipDur(c)) * c.opacity;
            ctx.filter = `blur(${Math.round(H / 36)}px) brightness(0.7)`;
            placeVideo(el, c, Math.max(W / dw, H / dh) * 1.2, W / 2, H / 2);
            ctx.restore();
        }
        ctx.save();
        ctx.globalAlpha = edFade(c, local, edClipDur(c)) * c.opacity;
        ctx.filter = clipFilter(c, H);
        placeVideo(el, c, s, W / 2 + c.px * W / 2, H / 2 + c.py * H / 2);
        ctx.restore();
    }

    function drawWatermark() {
        const wm = P.watermark;
        if (!wm.on || !wm.text) return;
        const W = canvas.width, H = canvas.height, px = Math.round(H * 0.035), m = px * 0.9;
        ctx.save();
        ctx.font = `700 ${px}px Fredoka, "Segoe UI", sans-serif`;
        ctx.globalAlpha = 0.78;
        ctx.textAlign = wm.pos[1] === 'l' ? 'left' : 'right';
        ctx.textBaseline = wm.pos[0] === 't' ? 'top' : 'bottom';
        const x = wm.pos[1] === 'l' ? m : W - m, y = wm.pos[0] === 't' ? m : H - m;
        ctx.lineJoin = 'round';
        ctx.lineWidth = px * 0.14;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.strokeText(wm.text, x, y);
        ctx.fillStyle = '#fff';
        ctx.fillText(wm.text, x, y);
        ctx.restore();
    }

    function draw() {
        const W = canvas.width, H = canvas.height;
        ctx.filter = 'none';
        ctx.globalAlpha = 1;
        ctx.fillStyle = P.bg === 'white' ? '#fff' : P.bg === 'color' ? P.bgColor : '#000';
        ctx.fillRect(0, 0, W, H);
        const L = edLayout(P);
        const loc = edLocate(L, P.t);
        if (loc) drawClip(loc.c, loc.local);
        const end = L.total;
        for (const tx of P.texts) {
            if (P.t >= tx.start && (P.t < tx.start + tx.dur || (P.t >= end && tx.start < end && tx.start + tx.dur >= end))) drawText(tx, Math.min(P.t - tx.start, tx.dur));
        }
        drawWatermark();
    }
    P.mounted = { draw };

    /* ---------- playing ---------- */
    function pauseAll(except, keepMusic) {
        const song = P.music && P.music.asset;
        for (const a of P.assets.values()) if (a !== except && !(keepMusic && a === song) && !a.el.paused) a.el.pause();
    }

    /** The song from the device plays along the timeline from its start point and fades out over the last two seconds. */
    function syncMusic() {
        const m = P.music;
        if (!m) return;
        const a = m.asset, el = a.el, local = P.t - m.start, total = edTotal(P);
        if (local < 0 || local >= a.duration || P.t >= total) { if (!el.paused) el.pause(); return; }
        edSetGain(a, m.volume * edClamp((total - P.t) / 2, 0, 1));
        if (Math.abs(el.currentTime - local) > 0.4) el.currentTime = local;
        if (el.playbackRate !== 1) el.playbackRate = 1;
        if (P.playing && el.paused) el.play().catch(() => {});
        else if (!P.playing && !el.paused) el.pause();
    }

    function syncMedia() {
        const L = edLayout(P);
        const loc = edLocate(L, P.t);
        if (!loc) return;
        const { c, local } = loc;
        const a = c.asset, el = a.el;
        const dur = edClipDur(c);
        const want = c.in + local * c.speed;
        edSetGain(a, c.volume * edFade(c, local, dur));
        if (P.active !== c.uid) {
            pauseAll(a, true);
            P.active = c.uid;
            el.playbackRate = c.speed;
            if (Math.abs(el.currentTime - want) > 0.05) el.currentTime = want;
            if (P.playing) el.play().catch(() => {});
        } else {
            if (Math.abs(el.currentTime - want) > 0.4) el.currentTime = want;
            if (el.playbackRate !== c.speed) el.playbackRate = c.speed;
            if (P.playing && el.paused && !el.ended) el.play().catch(() => {});
        }
        const next = L.items[loc.idx + 1];            // get the next video ready a moment before it starts
        if (next && next.c.asset !== a && dur - local < 1.2 && P.prep !== next.c.uid) {
            P.prep = next.c.uid;
            next.c.asset.el.currentTime = next.c.in;
        }
        syncMusic();
    }

    /** The playhead stays in the middle: the timeline slides under it, so the time is the scroll position. */
    function updateHead() {
        const x = P.t * P.zoom;
        if (Math.abs(scroll.scrollLeft - x) > 0.5) scroll.scrollLeft = x;
        lastSet = scroll.scrollLeft;
        timeEl.textContent = `${edFmt(P.t)} / ${edFmt(edTotal(P))}`;
    }

    /** The top bar: project name, whether it is saved, and the share of live footage the server will check at export. */
    function renderBar() {
        titleText.textContent = P.title || 'Untitled project';
        saveState.textContent = P.saving ? 'Saving\u2026' : P.saveErr ? 'Not saved' : P.dirty ? (P.id ? 'Saving soon\u2026' : 'Not saved yet') : P.id ? 'Saved' : '';
        const L = edLive(P);
        liveEl.hidden = !P.clips.length;
        liveEl.classList.toggle('is-ok', L.ok);
        liveEl.classList.toggle('is-low', !L.ok);
        liveEl.innerHTML = `${edIc('live', 15)}<span>${L.pct}% live</span>`;
        liveEl.title = L.ok ? `Live footage: ${L.pct}%. An edit needs at least ${P.minLive}%.` : `Live footage: ${L.pct}%. An edit needs at least ${P.minLive}% footage from your live streams.`;
        $('#edSave').disabled = !P.clips.length || P.exporting;
    }

    /** Once a project has been saved, later changes are saved by themselves a few seconds after you stop. */
    function scheduleSave() {
        clearTimeout(saveTimer);
        if (!P.id || P.exporting) return;
        saveTimer = setTimeout(async () => { await edSaveQuiet(P); renderBar(); }, 4000);
    }

    function renderTransport() {
        renderBar();
        playBtn.innerHTML = edIc(P.playing ? 'pause' : 'play', 20);
        playBtn.setAttribute('aria-label', P.playing ? 'Pause' : 'Play');
        $('#edUndo').disabled = !P.undo.length || P.exporting;
        $('#edRedo').disabled = !P.redo.length || P.exporting;
        $('#edExport').disabled = !P.clips.length || P.exporting;
        emptyEl.hidden = P.clips.length > 0;
        playBtn.disabled = !P.clips.length;
    }

    function play() {
        const total = edTotal(P);
        if (!total) return;
        const ac = edAudio(P);
        if (ac) { for (const a of P.assets.values()) edWire(P, a); if (ac.state !== 'running') ac.resume().catch(() => {}); }
        if (P.t >= total - 0.02) P.t = 0;
        P.playing = true;
        P.active = null;
        lastNow = performance.now();
        syncMedia();
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(tick);
        renderTransport();
    }

    function pause() {
        P.playing = false;
        cancelAnimationFrame(raf);
        pauseAll();
        renderTransport();
    }

    function tick(now) {
        if (!P.playing) return;
        const dt = Math.min(0.25, (now - lastNow) / 1000);
        lastNow = now;
        P.t += dt;
        const total = edTotal(P);
        if (P.t >= total) {
            P.t = total;
            draw();
            updateHead();
            pause();
            if (P.exporting && exportCtl) exportCtl.ended();
            return;
        }
        syncMedia();
        draw();
        updateHead();
        if (P.exporting && exportCtl) exportCtl.tick();
        raf = requestAnimationFrame(tick);
    }

    function scrub(t) {
        if (P.playing) pause();
        P.t = edClamp(t, 0, edTotal(P));
        P.active = null;
        syncMedia();
        draw();
        updateHead();
    }

    /* ---------- editing: every change goes through here so that undo works ---------- */
    const snap = () => JSON.stringify({ clips: P.clips.map((c) => ({ ...c, asset: c.asset.id })), texts: P.texts, aspect: P.aspect, bg: P.bg, bgColor: P.bgColor, watermark: P.watermark, music: P.music ? { ...P.music, asset: P.music.asset.id } : null });

    function pushHistory() {
        P.undo.push(snap());
        if (P.undo.length > 100) P.undo.shift();
        P.redo.length = 0;
        P.dirty = true;
    }

    function restore(json) {
        const d = JSON.parse(json);
        P.clips = d.clips.map((c) => ({ ...c, asset: P.assets.get(c.asset) })).filter((c) => c.asset);
        P.texts = d.texts;
        P.aspect = d.aspect;
        P.bg = d.bg; P.bgColor = d.bgColor; P.watermark = d.watermark;
        P.music = d.music && P.assets.get(d.music.asset) ? { ...d.music, asset: P.assets.get(d.music.asset) } : null;
        P.ver++;
        const gone = P.sel && !(P.sel.type === 'clip' ? P.clips : P.texts).some((x) => x.uid === P.sel.uid);
        if (gone) P.sel = null;
        P.dirty = true;
        sizeCanvas();
        renderAll();
    }

    function undo() { if (P.exporting || !P.undo.length) return; P.redo.push(snap()); restore(P.undo.pop()); }
    function redo() { if (P.exporting || !P.redo.length) return; P.undo.push(snap()); restore(P.redo.pop()); }

    /** `key` groups a stream of small changes (a slider being dragged) into one undo step. */
    function mutate(fn, key = '', structural = false) {
        if (P.exporting) return;
        const t = Date.now();
        if (!key || key !== P.lastKey || t - P.lastAt > 1000) pushHistory();
        P.lastKey = key;
        P.lastAt = t;
        fn();
        if (structural) renderInspector();
        afterEdit();
    }

    function afterEdit() {
        P.ver++;
        P.dirty = true;
        scheduleSave();
        P.t = edClamp(P.t, 0, edTotal(P));
        renderTimeline();
        fillInspector();
        renderTransport();
        if (!P.playing) { P.active = null; if (P.clips.length) syncMedia(); }
        draw();
        updateHead();
    }

    function renderAll() {
        renderBin();
        renderTimeline();
        renderInspector();
        renderTransport();
        if (!P.playing) { P.active = null; if (P.clips.length) syncMedia(); }
        draw();
        updateHead();
    }

    const selClip = () => (P.sel && P.sel.type === 'clip' ? P.clips.find((c) => c.uid === P.sel.uid) : null);
    const selText = () => (P.sel && P.sel.type === 'text' ? P.texts.find((x) => x.uid === P.sel.uid) : null);

    function select(sel) {
        P.sel = sel;
        tool = null;
        renderTimeline();
        renderInspector();
    }

    const actions = {
        split() {
            const L = edLayout(P);
            const target = selClip();
            const loc = edLocate(L, P.t);
            const item = target ? L.items.find((i) => i.c === target) : loc && L.items[loc.idx];
            if (!item) { toast('Add a clip first.'); return; }
            const local = P.t - item.start, dur = item.end - item.start;
            if (local < ED_MIN || dur - local < ED_MIN) { toast('Move the playhead inside the clip, away from its edges.'); return; }
            mutate(() => {
                const c = item.c;
                const cut = c.in + local * c.speed;
                const b = { ...c, uid: edUid(), in: cut, fadeIn: 0 };
                c.out = cut;
                c.fadeOut = 0;
                P.clips.splice(P.clips.indexOf(c) + 1, 0, b);
                P.sel = { type: 'clip', uid: b.uid };
            }, '', true);
        },
        dup() {
            const c = selClip(), tx = selText();
            if (c) mutate(() => { const b = { ...c, uid: edUid() }; P.clips.splice(P.clips.indexOf(c) + 1, 0, b); P.sel = { type: 'clip', uid: b.uid }; }, '', true);
            else if (tx) mutate(() => { const b = { ...tx, uid: edUid(), start: tx.start + tx.dur }; P.texts.push(b); P.sel = { type: 'text', uid: b.uid }; }, '', true);
            else toast('Select a clip or a text first.');
        },
        del() {
            const c = selClip(), tx = selText();
            if (c) mutate(() => { P.clips.splice(P.clips.indexOf(c), 1); P.sel = null; }, '', true);
            else if (tx) mutate(() => { P.texts.splice(P.texts.indexOf(tx), 1); P.sel = null; }, '', true);
            else toast('Select a clip or a text first.');
        },
        left() { move(-1); },
        right() { move(1); },
        text() {
            const total = edTotal(P);
            if (!total) { toast('Add a clip first.'); return; }
            mutate(() => {
                const tx = edNewText('text', 'Your text', Math.min(P.t, Math.max(0, total - 1)), Math.min(3, total));
                P.texts.push(tx);
                P.sel = { type: 'text', uid: tx.uid };
                tool = 'ttext';
            }, '', true);
        },
        trimstart() { trim('start'); },
        trimend() { trim('end'); },
        zoomfit() {
            const total = edTotal(P);
            if (total > 0) { P.zoom = edClamp((scroll.clientWidth * 0.8) / total, 8, 300); renderTimeline(); updateHead(); }
        },
        project() { P.sel = null; tool = 'project'; renderTimeline(); renderInspector(); },
        save() { saveNow(); },
        add() { openSheet(); },
        back() { select(null); },
        closetool() { tool = null; renderInspector(); },
        zoomin() { zoomBy(1.4); },
        zoomout() { zoomBy(1 / 1.4); },
    };

    function move(dir) {
        const c = selClip();
        if (!c) { toast('Select a clip to move it.'); return; }
        const i = P.clips.indexOf(c), j = i + dir;
        if (j < 0 || j >= P.clips.length) return;
        mutate(() => { [P.clips[i], P.clips[j]] = [P.clips[j], P.clips[i]]; }, '');
    }

    /** Cuts away everything of the selected clip before (or after) the playhead. */
    function trim(side) {
        const L = edLayout(P);
        const target = selClip();
        const item = target ? L.items.find((i) => i.c === target) : null;
        if (!item) { toast('Select a clip first.'); return; }
        const local = P.t - item.start, dur = item.end - item.start;
        if (local < ED_MIN || dur - local < ED_MIN) { toast('Move the playhead inside the selected clip, away from its edges.'); return; }
        mutate(() => {
            const c = item.c, cut = c.in + local * c.speed;
            if (side === 'start') { c.in = cut; c.fadeIn = 0; P.t = item.start; } else { c.out = cut; c.fadeOut = 0; }
        }, '', true);
    }

    async function saveNow() {
        if (!P.clips.length) { toast('Add a clip first.'); return; }
        clearTimeout(saveTimer);
        try {
            const had = !!P.id;
            await edSave(P);
            if (!had && /^#\/editor/.test(location.hash)) history.replaceState(null, '', `#/editor/project/${P.id}`);
            const away = P.clips.filter((c) => !c.asset.id.startsWith('vod:')).length;
            toast(away ? `Project saved. ${away} video${away === 1 ? '' : 's'} from your device ${away === 1 ? 'isn\u2019t' : 'aren\u2019t'} stored: add ${away === 1 ? 'it' : 'them'} again when you continue.` : 'Project saved.');
        } catch (e) {
            toast(e.message);
        }
        renderBar();
        if (tool === 'project') renderInspector();
    }

    function zoomBy(f) {
        P.zoom = edClamp(P.zoom * f, 8, 300);
        renderTimeline();
        updateHead();
    }

    /* ---------- add a clip: the sheet that slides up ---------- */
    const openSheet = () => { sheet.hidden = false; };
    const closeSheet = () => { sheet.hidden = true; };
    sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('[data-sheet-close]')) closeSheet(); });

    /* ---------- the list of your clips ---------- */
    function renderBin() {
        if (!P.bin.length) {
            binEl.innerHTML = '<p class="muted">You have no saved clips yet. Finish a live stream, or add a video from this device.</p>';
            return;
        }
        binEl.innerHTML = P.bin.map((v) => `
            <button type="button" class="ed-tile" data-add="${esc(v.id)}">
                <span class="ed-tile-thumb" ${v.cover ? `style="background-image:url('${esc(vodCoverSrc(v))}')"` : ''}><em>${esc(fmtDuration(v.duration * 1000))}</em></span>
                <strong data-no-i18n>${esc(v.title)}</strong>
                <small>${v.source === 'live' ? 'Live stream' : v.source === 'edit' ? `Edit \u00b7 ${v.live_pct >= 0 ? v.live_pct : 0}% live` : 'Video'} \u00b7 ${v.is_clip ? 'private' : 'published'}</small>
            </button>`).join('');
    }

    async function addAsset(info, button) {
        if (button) button.classList.add('is-loading');
        try {
            const asset = await edLoadAsset(P, info);
            if (!alive()) return;
            if (P.ac) edWire(P, asset);
            mutate(() => { const c = edNewClip(asset); P.clips.push(c); P.sel = { type: 'clip', uid: c.uid }; }, '', true);
            if (P.clips.length === 1) scrub(0);
        } catch (e) {
            toast(e.message);
        } finally {
            if (button) button.classList.remove('is-loading');
        }
    }

    // how much of a video counts as live footage: a live recording in full, an earlier edit for its own share, anything else not at all
    const vodShare = (v) => (v.source === 'live' ? 1 : v.source === 'edit' && v.live_pct >= 0 ? v.live_pct / 100 : 0);
    const vodInfo = (v) => ({ key: `vod:${v.id}`, name: v.title, url: `/api/vod/${encodeURIComponent(v.id)}/video`, duration: v.duration, thumb: v.cover ? vodCoverSrc(v) : '', share: vodShare(v) });

    /** Opens a saved project: the clips come back from the server, the videos of the device and the music have to be added again. */
    async function loadProject() {
        let r;
        try { r = await api(`/projects/${encodeURIComponent(projectId)}`); } catch (e) { if (alive()) { toast(e.message); location.hash = '#/clips'; } return; }
        if (!alive()) return;
        if (r.min_live) P.minLive = r.min_live;
        const d = r.data, byId = new Map(P.bin.map((v) => [`vod:${v.id}`, v]));
        const clips = [];
        let device = 0, gone = 0;
        for (const c of d.clips) {
            if (!c.a.startsWith('vod:')) { device++; continue; }
            const v = byId.get(c.a);
            let asset = null;
            if (v) { try { asset = await edLoadAsset(P, vodInfo(v)); } catch { /* counted below */ } }
            if (!asset) { gone++; continue; }
            if (!alive()) return;
            const { a, name, ...rest } = c;
            clips.push({ ...edNewClip(asset), ...rest, uid: edUid(), asset });
        }
        for (const a of P.assets.values()) edWire(P, a);
        P.clips = clips;
        P.texts = d.texts.map((t) => ({ ...edNewText(t.kind, t.text, t.start, t.dur), ...t, uid: edUid() }));
        P.aspect = d.aspect; P.bg = d.bg; P.bgColor = d.bgColor; P.watermark = d.watermark;
        P.music = null; P.sel = null; P.t = 0; P.active = null;
        P.id = r.project.id; P.title = r.project.title;
        P.undo = []; P.redo = []; P.dirty = false; P.saveErr = '';
        sizeCanvas();
        renderAll();
        scrub(0);
        const lost = [];
        if (device) lost.push(`${device} video${device === 1 ? '' : 's'} from your device`);
        if (gone) lost.push(`${gone} clip${gone === 1 ? '' : 's'} you deleted`);
        if (lost.length) toast(`Project opened. ${lost.join(' and ')} could not be restored.`);
    }

    async function loadBin() {
        try {
            const r = await api('/me/videos');
            if (!alive()) return;
            P.bin = r.videos;
            if (r.min_live) P.minLive = r.min_live;
            renderBin();
            if (projectId && P.id !== projectId) { await loadProject(); return; }
            if (vodId && !P.clips.some((c) => c.asset.id === `vod:${vodId}`)) {
                const v = P.bin.find((x) => x.id === vodId);
                if (v) await addAsset(vodInfo(v));
                else toast('That clip was not found.');
            }
            if (!P.clips.length && !vodId && !projectId && alive()) openSheet();
        } catch (e) {
            if (alive()) binEl.innerHTML = `<p class="form-error">${esc(e.message)}</p>`;
        }
    }

    /* ---------- timeline ---------- */
    const padW = () => Math.round(scroll.clientWidth / 2);

    function renderTimeline() {
        const L = edLayout(P);
        const pad = padW();
        inner.style.width = `${Math.round(L.total * P.zoom + pad * 2)}px`;
        const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
        const step = steps.find((s) => s * P.zoom >= 64) || 600;
        let ticks = '';
        for (let t = 0; t <= L.total + step; t += step) ticks += `<span class="ed-tick" style="left:${pad + t * P.zoom}px">${edFmtShort(t)}</span>`;
        rulerEl.innerHTML = ticks;
        trackV.innerHTML = L.items.map(({ c, start, end }) => {
            const a = c.asset, sel = P.sel && P.sel.type === 'clip' && P.sel.uid === c.uid;
            const adj = c.bright || c.contrast || c.sat || c.blur || c.rot || c.flipH || c.flipV || c.zoom !== 1 || c.opacity !== 1;
            const tags = [c.speed !== 1 ? `${c.speed}\u00d7` : '', c.filter !== 'none' || adj ? 'fx' : '', c.volume === 0 ? 'mute' : '', a.share === 0 ? 'device' : ''].filter(Boolean).join(' \u00b7 ');
            return `<div class="ed-clip${sel ? ' is-sel' : ''}${a.share === 0 ? ' is-ext' : ''}" data-clip="${c.uid}" style="left:${pad + start * P.zoom}px;width:${Math.max(6, (end - start) * P.zoom)}px;${a.thumb ? `background-image:url('${esc(a.thumb)}')` : ''}">
                <span class="ed-h ed-h-l" data-h="l"></span><span class="ed-clip-label" data-no-i18n>${esc(edFmtShort(end - start))}${tags ? ` <em>${esc(tags)}</em>` : ''}</span><span class="ed-h ed-h-r" data-h="r"></span></div>`;
        }).join('') + `<button type="button" class="ed-addclip" data-act="add" aria-label="Add a clip" title="Add a clip" style="left:${pad + L.total * P.zoom + 10}px">${edIc('plus', 24)}</button>`;
        trackT.innerHTML = P.texts.map((tx) => {
            const sel = P.sel && P.sel.type === 'text' && P.sel.uid === tx.uid;
            return `<div class="ed-text${sel ? ' is-sel' : ''}${tx.kind === 'sticker' ? ' is-sticker' : ''}" data-text="${tx.uid}" style="left:${pad + tx.start * P.zoom}px;width:${Math.max(6, tx.dur * P.zoom)}px">
                <span class="ed-h ed-h-l" data-h="l"></span><span class="ed-clip-label" data-no-i18n>${esc(tx.text)}</span><span class="ed-h ed-h-r" data-h="r"></span></div>`;
        }).join('');
        const m = P.music;
        trackM.innerHTML = m ? `<div class="ed-music" data-music style="left:${pad + m.start * P.zoom}px;width:${Math.max(8, Math.min(m.asset.duration, Math.max(0, L.total - m.start)) * P.zoom)}px"><span data-no-i18n>${edIc('music', 12)} ${esc(m.asset.name)}</span></div>` : '';
    }

    function drag(e, onMove, onEnd) {
        e.preventDefault();
        inner.setPointerCapture(e.pointerId);
        const x0 = e.clientX;
        const move = (ev) => onMove((ev.clientX - x0) / P.zoom, ev);
        const up = () => {
            inner.removeEventListener('pointermove', move);
            inner.removeEventListener('pointerup', up);
            inner.removeEventListener('pointercancel', up);
            skipClick = performance.now();
            if (onEnd) onEnd();
        };
        inner.addEventListener('pointermove', move);
        inner.addEventListener('pointerup', up);
        inner.addEventListener('pointercancel', up);
    }

    /** With a mouse the timeline can't be pushed by a finger, so dragging the background scrolls it. */
    function mouseScroll(e) {
        const x0 = e.clientX, s0 = scroll.scrollLeft;
        let moved = false;
        const move = (ev) => { if (Math.abs(ev.clientX - x0) > 3) moved = true; scroll.scrollLeft = s0 - (ev.clientX - x0); };
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            if (moved) skipClick = performance.now();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    }

    inner.addEventListener('pointerdown', (e) => {
        if (P.exporting) return;
        const h = e.target.closest('[data-h]');
        const clipEl = e.target.closest('[data-clip]');
        const textEl = e.target.closest('[data-text]');
        if (h && clipEl) {
            e.stopPropagation();
            const c = P.clips.find((x) => x.uid === clipEl.dataset.clip);
            if (!c) return;
            P.sel = { type: 'clip', uid: c.uid };
            pushHistory();
            const in0 = c.in, out0 = c.out, side = h.dataset.h, min = ED_MIN * c.speed;
            drag(e, (dt) => {
                const d = dt * c.speed;
                if (side === 'r') c.out = edClamp(out0 + d, c.in + min, c.asset.duration);
                else c.in = edClamp(in0 + d, 0, c.out - min);
                afterEdit();
            }, renderInspector);
        } else if (h && textEl) {
            e.stopPropagation();
            const tx = P.texts.find((x) => x.uid === textEl.dataset.text);
            if (!tx) return;
            P.sel = { type: 'text', uid: tx.uid };
            pushHistory();
            const s0 = tx.start, d0 = tx.dur, side = h.dataset.h;
            drag(e, (dt) => {
                if (side === 'r') tx.dur = Math.max(ED_MIN, d0 + dt);
                else { const ns = edClamp(s0 + dt, 0, s0 + d0 - ED_MIN); tx.start = ns; tx.dur = d0 - (ns - s0); }
                afterEdit();
            }, renderInspector);
        } else if (textEl && P.sel && P.sel.type === 'text' && P.sel.uid === textEl.dataset.text) {
            const tx = P.texts.find((x) => x.uid === textEl.dataset.text);   // a selected text slides along the timeline
            if (!tx) return;
            pushHistory();
            const s0 = tx.start;
            drag(e, (dt) => { tx.start = Math.max(0, s0 + dt); afterEdit(); }, renderInspector);
        } else if (e.pointerType === 'mouse' && !e.target.closest('button')) {
            mouseScroll(e);
        }
    });

    inner.addEventListener('click', (e) => {
        if (P.exporting || performance.now() - skipClick < 400) return;
        if (e.target.closest('[data-act]')) return;
        const clipEl = e.target.closest('[data-clip]');
        const textEl = e.target.closest('[data-text]');
        if (e.target.closest('[data-music]')) { select(null); tool = 'music'; renderInspector(); return; }
        if (textEl) select({ type: 'text', uid: textEl.dataset.text });
        else if (clipEl) select({ type: 'clip', uid: clipEl.dataset.clip });
        else if (P.sel) select(null);
    });

    /* moving the timeline moves the playhead */
    scroll.addEventListener('scroll', () => {
        if (Math.abs(scroll.scrollLeft - lastSet) < 2) return;     // that was us moving it while playing
        if (P.exporting) { updateHead(); return; }
        scrub(scroll.scrollLeft / P.zoom);
    });
    scroll.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15); }
        else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); scroll.scrollLeft += e.deltaY; }
    }, { passive: false });
    let pinch = null;
    const fingers = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) || 1;
    scroll.addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinch = { d: fingers(e), z: P.zoom }; }, { passive: true });
    scroll.addEventListener('touchmove', (e) => {
        if (!pinch || e.touches.length !== 2) return;
        e.preventDefault();
        const z = edClamp(pinch.z * fingers(e) / pinch.d, 8, 300);
        if (Math.abs(z - P.zoom) > 0.4) { P.zoom = z; renderTimeline(); updateHead(); }
    }, { passive: false });
    scroll.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = null; }, { passive: true });

    /* ---------- the toolbar and its panels ---------- */
    const CLIP_TOOLS = ['speed', 'volume', 'filter', 'adjust', 'transform', 'fade', 'fit'];
    const TEXT_TOOLS = ['ttext', 'tstyle', 'tfont', 'tanim', 'tpos'];
    const GLOBAL_TOOLS = ['format', 'bg', 'wm', 'music', 'stickers', 'project'];
    const SWATCHES = ['#ffffff', '#ffd43b', '#ffa94d', '#ff6b6b', '#f783ac', '#9775fa', '#4dabf7', '#38d9a9', '#000000'];
    const chips = (list, on, attr, label) => `<div class="ed-chips">${list.map((v) => `<button type="button" class="ed-chip${Number(v) === Number(on) || v === on ? ' is-on' : ''}" ${attr}="${v}">${label(v)}</button>`).join('')}</div>`;
    const toggle = (key, on, label) => `<button type="button" class="ed-chip${on ? ' is-on' : ''}" data-set="${key}" aria-pressed="${!!on}">${label}</button>`;
    const slider = (id, label, min, max, step = 1) => `<label class="ed-f">${label} <output id="${id}O"></output><input id="${id}" type="range" min="${min}" max="${max}" step="${step}"></label>`;
    const fontCss = (f) => (f === 'Fredoka' ? 'Fredoka, sans-serif' : `"${f}"`);

    function renderInspector() {
        const c = selClip(), tx = selText();
        if ((CLIP_TOOLS.includes(tool) && !c) || (TEXT_TOOLS.includes(tool) && !tx) || (GLOBAL_TOOLS.includes(tool) && (c || tx))) tool = null;
        $('#edScreen').classList.toggle('is-drag', !!tx);          // a selected text or sticker can be moved by dragging it on the picture
        const T = (k, icon, label) => `<button type="button" class="ed-tool" data-tool="${k}">${edIc(icon, 24)}<span>${label}</span></button>`;
        const A = (k, icon, label) => `<button type="button" class="ed-tool" data-act="${k}">${edIc(icon, 24)}<span>${label}</span></button>`;
        const head = (title) => `<div class="ed-panel-head"><strong>${title}</strong><button type="button" class="ed-ok" data-act="closetool" aria-label="Done" title="Done">${edIc('check', 20)}</button></div>`;
        if (!tool) {
            const back = `<button type="button" class="ed-tool ed-tool-back" data-act="back" aria-label="Back">${edIc('back', 24)}<span>Back</span></button><span class="ed-sep"></span>`;
            const items = c
                ? back + A('split', 'cut', 'Split') + A('trimstart', 'trimstart', 'Cut start') + A('trimend', 'trimend', 'Cut end') + T('speed', 'speed', 'Speed')
                    + T('volume', c.volume === 0 ? 'mute' : 'volume', 'Volume') + T('filter', 'filter', 'Filters') + T('adjust', 'adjust', 'Adjust') + T('transform', 'rotate', 'Transform')
                    + T('fade', 'fade', 'Fade') + T('fit', 'crop', 'Framing') + A('left', 'left', 'Earlier') + A('right', 'right', 'Later') + A('dup', 'copy', 'Duplicate') + A('del', 'trash', 'Delete')
                : tx
                    ? back + (tx.kind === 'text' ? T('ttext', 'pen', 'Edit') + T('tfont', 'text', 'Font') : '') + T('tstyle', 'style', 'Style') + T('tanim', 'anim', 'Animation') + T('tpos', 'align', 'Position')
                        + A('dup', 'copy', 'Duplicate') + A('del', 'trash', 'Delete')
                    : A('add', 'plus', 'Add') + A('text', 'text', 'Text') + T('stickers', 'sticker', 'Stickers') + T('music', 'music', 'Music') + T('format', 'format', 'Format')
                        + T('bg', 'bg', 'Background') + T('wm', 'wm', 'Watermark') + T('project', 'project', 'Project');
            insp.innerHTML = `<div class="ed-tools" role="toolbar">${items}</div>`;
        } else if (tool === 'speed') {
            insp.innerHTML = `<div class="ed-panel">${head('Speed')}${chips(ED_SPEEDS, c.speed, 'data-speed', (v) => `${v}×`)}</div>`;
        } else if (tool === 'volume') {
            insp.innerHTML = `<div class="ed-panel">${head('Volume')}<div class="ed-vol"><button type="button" class="ed-chip" id="inMute" data-set="mute" aria-label="Mute">${edIc('mute', 18)}</button><input id="inVol" type="range" min="0" max="200" step="5" aria-label="Volume"><output id="inVolO"></output></div></div>`;
        } else if (tool === 'filter') {
            const tiles = ED_FILTERS.map(([k, name, css]) => `<button type="button" class="ed-filter${c.filter === k ? ' is-on' : ''}" data-filter="${k}" ${ED_FILTER_OK ? '' : 'disabled'}>
                <span class="ed-ft"><i style="${c.asset.thumb ? `background-image:url('${esc(c.asset.thumb)}');` : ''}${ED_FILTER_OK ? `filter:${css}` : ''}"></i></span><em>${name}</em></button>`).join('');
            insp.innerHTML = `<div class="ed-panel">${head('Filters')}<div class="ed-chips ed-filters">${tiles}</div>
                ${P.clips.length > 1 ? '<div class="ed-chips ed-after"><button type="button" class="ed-chip" data-all="filter">Use this filter on every clip</button></div>' : ''}
                ${ED_FILTER_OK ? '' : '<p class="muted ed-note">Filters need Chrome, Edge or Firefox.</p>'}</div>`;
        } else if (tool === 'adjust') {
            insp.innerHTML = `<div class="ed-panel">${head('Adjust')}<div class="ed-grid2">${slider('adjBright', 'Brightness', -100, 100)}${slider('adjContrast', 'Contrast', -100, 100)}${slider('adjSat', 'Saturation', -100, 100)}${slider('adjBlur', 'Blur', 0, 20)}${slider('adjOpacity', 'Opacity', 0, 100)}</div>
                <div class="ed-chips ed-after"><button type="button" class="ed-chip" data-reset="adjust">Reset</button></div>${ED_FILTER_OK ? '' : '<p class="muted ed-note">Adjustments need Chrome, Edge or Firefox.</p>'}</div>`;
        } else if (tool === 'transform') {
            insp.innerHTML = `<div class="ed-panel">${head('Transform')}
                <div class="ed-chips"><button type="button" class="ed-chip" data-xf="rot">${edIc('rotate', 16)}&nbsp;Rotate 90°</button><button type="button" class="ed-chip" data-xf="flipH">${edIc('flip', 16)}&nbsp;Mirror</button><button type="button" class="ed-chip" data-xf="flipV">Flip upside down</button><button type="button" class="ed-chip" data-xf="reset">Reset</button></div>
                <div class="ed-grid2 ed-after">${slider('xfZoom', 'Zoom', 100, 400, 5)}${slider('xfX', 'Move left / right', -100, 100)}${slider('xfY', 'Move up / down', -100, 100)}</div></div>`;
        } else if (tool === 'fade') {
            const lab = (v) => (v ? `${v} s` : 'None');
            insp.innerHTML = `<div class="ed-panel">${head('Fade')}<p class="ed-lab">Fade in</p>${chips(ED_FADES, c.fadeIn, 'data-fi', lab)}<p class="ed-lab">Fade out</p>${chips(ED_FADES, c.fadeOut, 'data-fo', lab)}</div>`;
        } else if (tool === 'fit') {
            insp.innerHTML = `<div class="ed-panel">${head('Framing')}<div class="ed-chips">
                <button type="button" class="ed-chip${c.fit === 'fit' ? ' is-on' : ''}" data-fit="fit">Fit: show everything</button>
                <button type="button" class="ed-chip${c.fit === 'fill' ? ' is-on' : ''}" data-fit="fill">Fill: crop the edges</button></div></div>`;
        } else if (tool === 'format') {
            insp.innerHTML = `<div class="ed-panel">${head('Format')}${chips(Object.keys(ED_ASPECTS), P.aspect, 'data-aspect', (k) => ED_ASPECTS[k][2])}<p class="muted ed-note" id="pjLen"></p>
                <p class="muted ed-note" id="pjFmt">${P.aspect === '9:16' ? 'Vertical videos are published as Shorts: up to 3 minutes.'
        : P.aspect === '1:1' || P.aspect === '4:5' ? 'Square and 4:5 are published as pictures of your stream in the Gallery, with an optional price.' : 'Wide videos are published as normal videos.'}</p></div>`;
        } else if (tool === 'bg') {
            insp.innerHTML = `<div class="ed-panel">${head('Background')}<p class="ed-lab">What shows around the video when it doesn’t fill the frame</p>
                <div class="ed-chips">${ED_BGS.map(([k, label]) => `<button type="button" class="ed-chip${P.bg === k ? ' is-on' : ''}" data-bg="${k}">${label}</button>`).join('')}${P.bg === 'color' ? '<input id="bgColor" type="color" aria-label="Background colour" class="ed-colorpick">' : ''}</div></div>`;
        } else if (tool === 'wm') {
            insp.innerHTML = `<div class="ed-panel">${head('Watermark')}<div class="ed-chips">${toggle('wm', P.watermark.on, 'Show my name on the video')}</div>
                <div class="ed-field-row"><input id="wmText" maxlength="40" placeholder="Your name or channel" aria-label="Watermark text"></div>
                <p class="ed-lab">Corner</p><div class="ed-chips">${ED_CORNERS.map(([k, label]) => `<button type="button" class="ed-chip${P.watermark.pos === k ? ' is-on' : ''}" data-corner="${k}">${label}</button>`).join('')}</div></div>`;
        } else if (tool === 'music') {
            const m = P.music;
            insp.innerHTML = `<div class="ed-panel">${head('Music')}${m
                ? `<p class="ed-lab" data-no-i18n>${esc(m.asset.name)}</p><div class="ed-grid2">${slider('muVol', 'Volume', 0, 200, 5)}${slider('muStart', 'Starts at', 0, Math.max(1, Math.floor(edTotal(P))), 0.5)}</div>
                    <div class="ed-chips ed-after"><button type="button" class="ed-chip" data-set="rmmusic">Remove the music</button></div>`
                : `<label class="ed-device ed-device-sm">${edIc('upload', 18)}<span>Add a song from this device</span><input type="file" id="edMusic" accept="audio/*" hidden></label>`}
                <p class="muted ed-note">Only use music you have the right to use. It fades out at the end and isn’t stored in a saved project.</p></div>`;
        } else if (tool === 'stickers') {
            insp.innerHTML = `<div class="ed-panel">${head('Stickers')}<div class="ed-stickers">${ED_STICKERS.map((e2) => `<button type="button" class="ed-sticker" data-sticker="${e2}" aria-label="Add ${e2}">${e2}</button>`).join('')}</div></div>`;
        } else if (tool === 'project') {
            insp.innerHTML = `<div class="ed-panel">${head('Project')}
                <div class="ed-field-row"><input id="pjTitle" maxlength="80" placeholder="Untitled project" aria-label="Project name"></div>
                <div class="ed-chips"><button type="button" class="ed-chip is-on" data-act="save">${edIc('save', 16)}&nbsp;Save</button><button type="button" class="ed-chip" data-act="newproject">New project</button><a class="ed-chip" href="#/clips" data-leave>My projects</a></div>
                <p class="ed-note" id="pjLen"></p><p class="ed-note" id="pjLive"></p></div>`;
        } else if (tool === 'ttext') {
            insp.innerHTML = `<div class="ed-panel">${head('Text')}<textarea id="txText" rows="2" maxlength="120" placeholder="Type your text" aria-label="Text"></textarea></div>`;
        } else if (tool === 'tstyle') {
            const sticker = tx.kind === 'sticker';
            insp.innerHTML = `<div class="ed-panel">${head('Style')}
                <div class="ed-grid2">${slider('txSize', 'Size', sticker ? 5 : 3, sticker ? 60 : 30)}${slider('txOpacity', 'Opacity', 10, 100)}</div>
                ${sticker ? '' : `<div class="ed-chips ed-swatches">${SWATCHES.map((col) => `<button type="button" class="ed-sw${tx.color.toLowerCase() === col ? ' is-on' : ''}" data-color="${col}" style="background:${col}" aria-label="Color ${col}"></button>`).join('')}<input id="txColor" type="color" aria-label="Any color"></div>
                <div class="ed-chips">${toggle('bg', tx.bg, 'Dark box')}${toggle('outline', tx.outline, 'Outline')}${toggle('shadow', tx.shadow, 'Shadow')}</div>`}</div>`;
        } else if (tool === 'tfont') {
            insp.innerHTML = `<div class="ed-panel">${head('Font')}<div class="ed-chips">${ED_FONTS.map(([f, label]) => `<button type="button" class="ed-chip${tx.font === f ? ' is-on' : ''}" data-font="${f}" style="font-family:${fontCss(f)}">${label}</button>`).join('')}</div>
                <div class="ed-chips ed-after">${toggle('bold', tx.bold, '<b>B</b>&nbsp;Bold')}${toggle('italic', tx.italic, '<i>I</i>&nbsp;Italic')}</div></div>`;
        } else if (tool === 'tanim') {
            insp.innerHTML = `<div class="ed-panel">${head('Animation')}${chips(ED_ANIMS.map((a) => a[0]), tx.anim, 'data-anim', (k) => ED_ANIMS.find((a) => a[0] === k)[1])}<p class="muted ed-note">Plays when it appears and fades when it leaves.</p></div>`;
        } else if (tool === 'tpos') {
            const near = (k) => Math.abs(tx.y - ED_POS_Y[k]) < 0.5 && Math.abs(tx.x - 50) < 0.5;
            insp.innerHTML = `<div class="ed-panel">${head('Position')}<div class="ed-chips">${['top', 'middle', 'bottom'].map((k) => `<button type="button" class="ed-chip${near(k) ? ' is-on' : ''}" data-pos="${k}">${k.charAt(0).toUpperCase() + k.slice(1)}</button>`).join('')}</div>
                <div class="ed-grid2 ed-after">${slider('txX', 'Left / right', 0, 100)}${slider('txY', 'Up / down', 0, 100)}${slider('txRot', 'Turn', -180, 180)}</div>
                <p class="muted ed-note">You can also drag it on the picture.</p></div>`;
        }
        fillInspector();
        if (tool === 'ttext') { const ta = $('#txText', insp); if (ta) { ta.focus(); ta.select(); } }
    }

    /** Puts the numbers of the selected item into the fields, without rebuilding them (so typing is not interrupted). */
    function fillInspector() {
        const set = (id, v, text) => {
            const el = $(`#${id}`, insp);
            if (el && document.activeElement !== el) el.value = v;
            const o = $(`#${id}O`, insp);
            if (o) o.textContent = text === undefined ? String(v) : text;
        };
        const c = selClip(), tx = selText();
        if (c) {
            set('inVol', Math.round(c.volume * 100), c.volume === 0 ? 'Muted' : `${Math.round(c.volume * 100)}%`);
            const m = $('#inMute', insp);
            if (m) m.classList.toggle('is-on', c.volume === 0);
            set('adjBright', c.bright); set('adjContrast', c.contrast); set('adjSat', c.sat); set('adjBlur', c.blur);
            set('adjOpacity', Math.round(c.opacity * 100), `${Math.round(c.opacity * 100)}%`);
            set('xfZoom', Math.round(c.zoom * 100), `${Math.round(c.zoom * 100)}%`);
            set('xfX', Math.round(c.px * 100)); set('xfY', Math.round(c.py * 100));
        } else if (tx) {
            set('txText', tx.text, undefined);
            set('txSize', tx.size, `${tx.size}%`);
            set('txOpacity', Math.round(tx.opacity * 100), `${Math.round(tx.opacity * 100)}%`);
            set('txColor', tx.color);
            set('txX', Math.round(tx.x)); set('txY', Math.round(tx.y)); set('txRot', Math.round(tx.rot), `${Math.round(tx.rot)}°`);
        } else {
            const len = $('#pjLen', insp);
            if (len) len.textContent = P.clips.length ? `${P.clips.length} clip${P.clips.length === 1 ? '' : 's'} · ${edFmt(edTotal(P))} long` : 'The timeline is empty.';
            const lv = $('#pjLive', insp);
            if (lv) {
                const L = edLive(P);
                lv.textContent = !L.total ? '' : L.ok ? `${L.pct}% of this video is footage from your live streams. That is enough to publish it.`
                    : `${L.pct}% of this video is footage from your live streams, and it needs ${P.minLive}%. Add about ${edFmt(L.addLive)} more live footage, or remove about ${edFmt(L.removeOther)} of the rest.`;
            }
            set('pjTitle', P.title);
            set('bgColor', P.bgColor);
            set('wmText', P.watermark.text);
            if (P.music) { set('muVol', Math.round(P.music.volume * 100), `${Math.round(P.music.volume * 100)}%`); set('muStart', P.music.start, `${edFmt(P.music.start)}`); }
        }
    }

    insp.addEventListener('input', (e) => {
        const id = e.target.id, c = selClip(), tx = selText(), v = edNum(e.target.value, 0);
        if (c) {
            const k = `${id}${c.uid}`;
            if (id === 'inVol') mutate(() => { c.volume = edNum(e.target.value, 100) / 100; }, k);
            else if (id === 'adjBright') mutate(() => { c.bright = v; }, k);
            else if (id === 'adjContrast') mutate(() => { c.contrast = v; }, k);
            else if (id === 'adjSat') mutate(() => { c.sat = v; }, k);
            else if (id === 'adjBlur') mutate(() => { c.blur = v; }, k);
            else if (id === 'adjOpacity') mutate(() => { c.opacity = v / 100; }, k);
            else if (id === 'xfZoom') mutate(() => { c.zoom = edClamp(v / 100, 1, 4); }, k);
            else if (id === 'xfX') mutate(() => { c.px = v / 100; }, k);
            else if (id === 'xfY') mutate(() => { c.py = v / 100; }, k);
        } else if (tx) {
            const k = `${id}${tx.uid}`;
            if (id === 'txText') mutate(() => { tx.text = e.target.value || ' '; }, k);
            else if (id === 'txSize') mutate(() => { tx.size = v; }, k);
            else if (id === 'txOpacity') mutate(() => { tx.opacity = v / 100; }, k);
            else if (id === 'txColor') mutate(() => { tx.color = e.target.value; }, k);
            else if (id === 'txX') mutate(() => { tx.x = v; }, k);
            else if (id === 'txY') mutate(() => { tx.y = v; }, k);
            else if (id === 'txRot') mutate(() => { tx.rot = v; }, k);
        } else if (id === 'pjTitle') {
            P.title = e.target.value.slice(0, 80);
            P.dirty = true; P.ver++;
            scheduleSave();
            renderBar();
        } else if (id === 'bgColor') mutate(() => { P.bgColor = e.target.value; }, 'bgc');
        else if (id === 'wmText') mutate(() => { P.watermark.text = e.target.value; }, 'wmt');
        else if (id === 'muVol' && P.music) mutate(() => { P.music.volume = v / 100; }, 'muv');
        else if (id === 'muStart' && P.music) mutate(() => { P.music.start = v; }, 'mus', false);
    });

    insp.addEventListener('change', async (e) => {
        if (e.target.id !== 'edMusic') return;
        const f = e.target.files[0];
        e.target.value = '';
        if (!f) return;
        if (!f.type.startsWith('audio/')) { toast('Choose an audio file.'); return; }
        try {
            const key = `music:${f.name}:${f.size}:${f.lastModified}`;
            const asset = P.assets.get(key) || await edLoadAsset(P, { key, name: f.name, url: URL.createObjectURL(f), duration: 0, thumb: '', share: 0 });
            if (!alive()) return;
            if (P.ac) edWire(P, asset);
            mutate(() => { P.music = { asset, volume: 1, start: 0 }; }, '', true);
        } catch (e2) { toast(e2.message); }
    });

    const clipFx = (c, fn, structural = true) => mutate(fn, '', structural);

    insp.addEventListener('click', (e) => {
        const t = e.target.closest('[data-tool]');
        if (t) { tool = t.dataset.tool; renderInspector(); return; }
        if (e.target.closest('[data-leave]')) return;
        const c = selClip(), tx = selText();
        const q = (attr) => e.target.closest(`[${attr}]`);
        let b;
        if (c) {
            if ((b = q('data-speed'))) clipFx(c, () => { c.speed = Number(b.dataset.speed); });
            else if ((b = q('data-filter'))) clipFx(c, () => { c.filter = b.dataset.filter; });
            else if (q('data-all')) clipFx(c, () => { for (const x of P.clips) x.filter = c.filter; });
            else if ((b = q('data-fi'))) clipFx(c, () => { c.fadeIn = Number(b.dataset.fi); });
            else if ((b = q('data-fo'))) clipFx(c, () => { c.fadeOut = Number(b.dataset.fo); });
            else if ((b = q('data-fit'))) clipFx(c, () => { c.fit = b.dataset.fit; });
            else if ((b = q('data-set')) && b.dataset.set === 'mute') clipFx(c, () => { c.volume = c.volume === 0 ? 1 : 0; });
            else if (q('data-reset')) clipFx(c, () => { c.bright = 0; c.contrast = 0; c.sat = 0; c.blur = 0; c.opacity = 1; });
            else if ((b = q('data-xf'))) {
                const k = b.dataset.xf;
                clipFx(c, () => {
                    if (k === 'rot') c.rot = (c.rot + 1) % 4;
                    else if (k === 'flipH') c.flipH = !c.flipH;
                    else if (k === 'flipV') c.flipV = !c.flipV;
                    else { c.rot = 0; c.flipH = false; c.flipV = false; c.zoom = 1; c.px = 0; c.py = 0; }
                });
            }
        } else if (tx) {
            if ((b = q('data-pos'))) clipFx(tx, () => { tx.pos = b.dataset.pos; tx.y = ED_POS_Y[tx.pos]; tx.x = 50; });
            else if ((b = q('data-color'))) clipFx(tx, () => { tx.color = b.dataset.color; });
            else if ((b = q('data-font'))) clipFx(tx, () => { tx.font = b.dataset.font; });
            else if ((b = q('data-anim'))) clipFx(tx, () => { tx.anim = b.dataset.anim; });
            else if ((b = q('data-set')) && ['bg', 'outline', 'shadow', 'bold', 'italic'].includes(b.dataset.set)) clipFx(tx, () => { tx[b.dataset.set] = !tx[b.dataset.set]; });
        } else {
            if ((b = q('data-aspect'))) mutate(() => { P.aspect = b.dataset.aspect; sizeCanvas(); }, '', true);
            else if ((b = q('data-bg'))) mutate(() => { P.bg = b.dataset.bg; }, '', true);
            else if ((b = q('data-corner'))) mutate(() => { P.watermark.pos = b.dataset.corner; }, '', true);
            else if ((b = q('data-set')) && b.dataset.set === 'wm') mutate(() => { P.watermark.on = !P.watermark.on; if (P.watermark.on && !P.watermark.text) P.watermark.text = `@${state.me.username}`; }, '', true);
            else if ((b = q('data-set')) && b.dataset.set === 'rmmusic') mutate(() => { if (P.music) P.music.asset.el.pause(); P.music = null; }, '', true);
            else if ((b = q('data-sticker'))) {
                const total = edTotal(P);
                if (!total) { toast('Add a clip first.'); return; }
                mutate(() => {
                    const st = edNewText('sticker', b.dataset.sticker, Math.min(P.t, Math.max(0, total - 1)), Math.min(3, total));
                    P.texts.push(st);
                    P.sel = { type: 'text', uid: st.uid };
                    tool = null;
                }, '', true);
            }
        }
    });

    /* dragging a selected text or sticker on the picture */
    canvas.addEventListener('pointerdown', (e) => {
        const tx = selText();
        if (!tx || P.exporting) return;
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        const r = canvas.getBoundingClientRect();
        const at = (ev) => [(ev.clientX - r.left) / r.width * 100, (ev.clientY - r.top) / r.height * 100];
        const [x0, y0] = at(e), sx = tx.x, sy = tx.y;
        let started = false;
        const move = (ev) => {
            const [x, y] = at(ev);
            if (!started) { if (Math.abs(x - x0) + Math.abs(y - y0) < 1) return; started = true; pushHistory(); }
            tx.x = edClamp(sx + x - x0, 0, 100);
            tx.y = edClamp(sy + y - y0, 0, 100);
            afterEdit();
        };
        const up = () => {
            canvas.removeEventListener('pointermove', move);
            canvas.removeEventListener('pointerup', up);
            canvas.removeEventListener('pointercancel', up);
            if (started) renderInspector();
        };
        canvas.addEventListener('pointermove', move);
        canvas.addEventListener('pointerup', up);
        canvas.addEventListener('pointercancel', up);
    });

    /* ---------- buttons and keys ---------- */
    const onTop = (e) => {
        const b = e.target.closest('[data-act]');
        if (b && actions[b.dataset.act]) actions[b.dataset.act]();
    };
    root.addEventListener('click', onTop);
    binEl.addEventListener('click', (e) => {
        const b = e.target.closest('[data-add]');
        if (!b || b.classList.contains('is-loading')) return;
        const v = P.bin.find((x) => x.id === b.dataset.add);
        if (v) addAsset(vodInfo(v), b).then(closeSheet);
    });
    $('#edFile').addEventListener('change', async (e) => {
        const f = e.target.files[0];
        e.target.value = '';
        if (!f) return;
        if (!f.type.startsWith('video/')) { toast('Choose a video file.'); return; }
        const key = `file:${f.name}:${f.size}:${f.lastModified}`;
        const known = P.assets.get(key);
        await addAsset(known ? { key } : { key, name: f.name, url: URL.createObjectURL(f), duration: 0, thumb: '', share: 0 });
        closeSheet();
    });
    playBtn.addEventListener('click', () => (P.playing ? pause() : play()));
    $('#edUndo').addEventListener('click', undo);
    $('#edRedo').addEventListener('click', redo);
    $('#edExport').addEventListener('click', () => openExport());

    /* closing with work that isn't saved asks first */
    $('#edClose').addEventListener('click', (e) => {
        if (P.exporting || !P.clips.length || !P.dirty) return;
        e.preventDefault();
        const dlg = dialogShell('Save your project?', `
            <p>${P.id ? 'Your latest changes haven’t been saved yet.' : 'This project isn’t saved. If you leave now you will lose it.'} Saved projects are in <strong>Clips → Projects</strong>, ready to continue.</p>
            <p class="form-error" id="svErr" role="alert" hidden></p>
            <div class="row ed-done-row"><button type="button" class="btn btn-secondary" id="svNo">Leave without saving</button><button type="button" class="btn btn-primary" id="svYes">Save and leave</button></div>`);
        $('#svNo', dlg).addEventListener('click', () => { P.dirty = false; dlg.close(); location.hash = '#/clips'; });
        $('#svYes', dlg).addEventListener('click', async (ev) => {
            ev.currentTarget.disabled = true;
            try { await edSave(P); dlg.close(); location.hash = '#/clips'; } catch (e2) {
                const er = $('#svErr', dlg);
                er.textContent = e2.message;
                er.hidden = false;
                ev.currentTarget.disabled = false;
            }
        });
    });

    actions.newproject = () => {
        const go = () => { EDP = null; if (location.hash === '#/editor') route(); else location.hash = '#/editor'; };
        if (!P.clips.length || !P.dirty) { go(); return; }
        const dlg = dialogShell('Start a new project?', `<p>${P.id ? 'Your latest changes haven’t been saved yet.' : 'This project isn’t saved.'}</p>
            <div class="row ed-done-row"><button type="button" class="btn btn-secondary" id="npNo">Discard changes</button><button type="button" class="btn btn-primary" id="npYes">Save first</button></div>`);
        $('#npNo', dlg).addEventListener('click', () => { dlg.close(); go(); });
        $('#npYes', dlg).addEventListener('click', async () => { try { await edSave(P); dlg.close(); go(); } catch (e2) { toast(e2.message); } });
    };

    const onKey = (e) => {
        const tag = (e.target.tagName || '').toLowerCase();
        const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
        if (document.querySelector('dialog[open]')) return;
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); return; }
        if (mod && e.key.toLowerCase() === 'z') { if (typing && tag !== 'select') return; e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
        if (mod && e.key.toLowerCase() === 'y') { if (typing) return; e.preventDefault(); redo(); return; }
        if (e.key === 'Escape' && !sheet.hidden) { closeSheet(); return; }
        if (typing || mod || e.altKey) return;
        const k = e.key.toLowerCase();
        if (e.key === ' ') { e.preventDefault(); if (P.clips.length) (P.playing ? pause() : play()); }
        else if (k === 's') actions.split();
        else if (k === 'q') trim('start');
        else if (k === 'w') trim('end');
        else if (k === 't') actions.text();
        else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); actions.del(); }
        else if (e.key === '[') actions.left();
        else if (e.key === ']') actions.right();
        else if (e.key === '+' || e.key === '=') zoomBy(1.25);
        else if (e.key === '-') zoomBy(1 / 1.25);
        else if (e.key === 'Home') { e.preventDefault(); scrub(0); }
        else if (e.key === 'End') { e.preventDefault(); scrub(edTotal(P)); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); scrub(P.t - (e.shiftKey ? 1 : 1 / 30)); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); scrub(P.t + (e.shiftKey ? 1 : 1 / 30)); }
    };
    document.addEventListener('keydown', onKey);
    const onResize = () => { fitScreen(); renderTimeline(); updateHead(); };
    window.addEventListener('resize', onResize);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => fitScreen()) : null;
    if (ro) ro.observe(stage);

    /* ---------- export ---------- */
    function openExport() {
        if (!P.clips.length) { toast('Add a clip to the timeline first.'); return; }
        pause();
        const total = edTotal(P);
        const dlg = document.createElement('dialog');
        dlg.className = 'dialog ed-export';
        document.body.appendChild(dlg);
        dlg.addEventListener('close', () => dlg.remove());
        dlg.addEventListener('cancel', (e) => { if (P.exporting) e.preventDefault(); });
        const close = () => { if (!P.exporting) dlg.close(); };
        const shell = (title, inside) => {
            dlg.innerHTML = `<div class="dialog-body"><button type="button" class="dialog-close" aria-label="Close" ${P.exporting ? 'hidden' : ''}>&times;</button><h2>${esc(title)}</h2>${inside}</div>`;
            const x = $('.dialog-close', dlg);
            if (x) x.addEventListener('click', close);
        };

        function setup() {
            const L = edLive(P);
            const defaultTitle = P.title || edDefaultTitle(P);
            const liveNote = L.ok
                ? `<div class="notice ed-live-note is-ok" role="note">${edIc('live', 15)}&nbsp;<span><strong>${L.pct}% live footage.</strong> That meets the ${P.minLive}% an edit needs, so you will be able to publish it.</span></div>`
                : `<div class="notice notice-test ed-live-note is-low" role="alert">${edIc('live', 15)}&nbsp;<span><strong>${L.pct}% live footage: it needs ${P.minLive}%.</strong> Add about ${esc(edFmt(L.addLive))} more footage from your live streams, or remove about ${esc(edFmt(L.removeOther))} of the rest.</span></div>`;
            shell('Export video', `
                <form class="props-form" id="exForm" novalidate>
                    <div class="field"><label for="exTitle">Title</label><input id="exTitle" maxlength="80" autocomplete="off" required></div>
                    <div class="field"><label for="exQ">Quality</label><select id="exQ"><option value="1080">1080p</option><option value="720" selected>720p</option><option value="480">480p</option><option value="360">360p (smaller file)</option></select></div>
                    ${liveNote}
                    <div class="notice" role="note">It is recorded in real time: this video is ${esc(edFmt(total))} long, so it takes about that long. Keep this tab open and visible until it ends. It is saved to your clips, where you add a cover and publish it. Videos can only be watched on Yeli, they can’t be downloaded.</div>
                    <p class="form-error" id="exErr" role="alert" hidden></p>
                    <button type="submit" class="btn btn-primary btn-block" id="exClip" ${L.ok ? '' : 'disabled'}>Export to my clips</button>
                </form>`);
            $('#exTitle', dlg).value = defaultTitle.slice(0, 80);
            $('#exForm', dlg).addEventListener('submit', (e) => {
                e.preventDefault();
                const title = $('#exTitle', dlg).value.trim();
                if (!title) { const er = $('#exErr', dlg); er.textContent = 'Give your video a title.'; er.hidden = false; return; }
                run({ title, short: Number($('#exQ', dlg).value) });
            });
        }

        function fail(message) {
            shell('Couldn’t export', `<p class="form-error" role="alert">${esc(message)}</p><div class="row"><button type="button" class="btn btn-secondary" id="exClose">Close</button><button type="button" class="btn btn-primary" id="exAgain">Try again</button></div>`);
            $('#exClose', dlg).addEventListener('click', close);
            $('#exAgain', dlg).addEventListener('click', setup);
        }

        async function run(o) {
            const ac = edAudio(P);
            if (ac) { for (const a of P.assets.values()) edWire(P, a); await ac.resume().catch(() => {}); }
            const mime = (typeof VOD_MIMES !== 'undefined' ? VOD_MIMES : ['video/webm;codecs=vp8,opus', 'video/webm']).find((m) => MediaRecorder.isTypeSupported(m));
            if (!mime) { fail('This browser can’t record video in a format Yeli accepts.'); return; }

            // The project is saved first: the server measures the share of live footage from it, and you can come back to it.
            P.title = o.title;
            shell('Saving your project…', '<div class="ed-prog"><span style="width:30%"></span></div>');
            try { await edSave(P); } catch (e) { fail(e.message); return; }
            renderBar();
            let upload = null;
            try {
                const info = await api('/vod/new', { method: 'POST', body: { mime, title: o.title, project_id: P.id } });
                upload = { id: info.id, seq: 0, queue: Promise.resolve(), pending: 0, failed: false, message: '', fail(msg) { this.failed = true; this.message = msg || this.message; ctl.abort(this.message); } };
            } catch (e) { fail(e.message); return; }

            P.exporting = true;
            P.sel = null;
            renderTimeline();
            renderInspector();
            renderTransport();
            sizeCanvas(o.short);
            if (P.speaker) P.speaker.gain.value = 0;     // you don't hear it while it is recorded
            const stream = canvas.captureStream(30);
            if (P.dest) P.dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
            let recorder;
            try {
                recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: ED_QUALITY[o.short] || 2000000, audioBitsPerSecond: 128000 });
            } catch (e) {
                P.exporting = false;
                sizeCanvas();
                if (P.speaker) P.speaker.gain.value = 1;
                renderTransport();
                api(`/vod/${upload.id}/delete`, { method: 'POST' }).catch(() => {});
                fail('This browser couldn’t start recording.');
                return;
            }
            let cover = null, finished = false;
            recorder.ondataavailable = (ev) => {
                if (!ev.data || !ev.data.size || finished === 'aborted') return;
                const seq = upload.seq++;
                upload.pending += ev.data.size;
                upload.queue = upload.queue.then(() => uploadVodPiece(upload, seq, ev.data)).catch(() => {});
            };

            const bar = () => $('.ed-prog > span', dlg);
            shell('Exporting…', `
                <div class="ed-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>
                <p class="muted" id="exInfo">0:00.0 / ${esc(edFmt(total))}</p>
                <p class="muted">Keep this tab open and visible.</p>
                <button type="button" class="btn btn-secondary btn-block" id="exCancel">Cancel</button>`);

            const makeCover = () => {
                const c = document.createElement('canvas');
                c.width = 640; c.height = 360;
                const cx = c.getContext('2d');
                cx.fillStyle = '#111';
                cx.fillRect(0, 0, 640, 360);
                const s = Math.max(640 / canvas.width, 360 / canvas.height);
                cx.drawImage(canvas, (640 - canvas.width * s) / 2, (360 - canvas.height * s) / 2, canvas.width * s, canvas.height * s);
                for (const q of [0.8, 0.7, 0.6, 0.5, 0.4, 0.3]) {
                    const url = c.toDataURL('image/jpeg', q);
                    if (url.length * 0.75 < 58000) return url;
                }
                return null;
            };

            const restore2 = () => {
                P.exporting = false;
                exportCtl = null;
                if (P.speaker) P.speaker.gain.value = 1;
                sizeCanvas();
                P.t = 0;
                P.active = null;
                renderAll();
            };

            const ctl = exportCtl = {
                tick() {
                    const pct = Math.min(100, Math.round(P.t / total * 100));
                    if (bar()) bar().style.width = `${pct}%`;
                    const p = $('.ed-prog', dlg);
                    if (p) p.setAttribute('aria-valuenow', String(pct));
                    const info = $('#exInfo', dlg);
                    if (info) info.textContent = `${edFmt(P.t)} / ${edFmt(total)}`;
                    if (!cover && P.t >= Math.min(1, total * 0.1)) cover = makeCover();
                    if (upload.failed) ctl.abort(upload.message);
                },
                async ended() {
                    if (finished) return;
                    finished = true;
                    if (!cover) cover = makeCover();
                    const stopped = new Promise((r) => { recorder.addEventListener('stop', r, { once: true }); });
                    try { recorder.stop(); } catch { /* already stopped */ }
                    await stopped;
                    shell('Saving…', '<div class="ed-prog"><span style="width:100%"></span></div><p class="muted">Finishing the upload. Keep this tab open.</p>');
                    try {
                        await Promise.race([upload.queue, new Promise((r) => setTimeout(r, 120000))]);
                        if (upload.failed) throw new Error(upload.message || 'The upload failed.');
                        const r = await api(`/vod/${upload.id}/finish`, { method: 'POST', body: { duration: total, cover } });
                        if (!r.saved) throw new Error('Nothing was recorded.');
                        restore2();
                        done(r.video);
                    } catch (e) {
                        restore2();
                        api(`/vod/${upload.id}/delete`, { method: 'POST' }).catch(() => {});
                        fail(e.message);
                    }
                },
                abort(message) {
                    if (finished) return;
                    finished = 'aborted';
                    pause();
                    try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* already stopped */ }
                    api(`/vod/${upload.id}/delete`, { method: 'POST' }).catch(() => {});
                    restore2();
                    if (message) fail(message); else dlg.close();
                },
            };
            $('#exCancel', dlg).addEventListener('click', () => ctl.abort(''));
            P.t = 0;                                   // the first picture must be on the canvas before recording starts,
            P.active = null;                           // or the video begins with a black frame
            syncMedia();
            await new Promise((r) => setTimeout(r, 450));
            if (finished) return;
            draw();
            recorder.start(2000);
            play();
        }

        function done(video) {
            shell('Saved in your clips', `
                <p>Your edited video is in your clips and your project is saved. Only you can see it until you publish it: you will choose its cover and who can watch.</p>
                <div class="row ed-done-row">
                    <button type="button" class="btn btn-primary btn-ico" id="exPub">${edIc('globe', 16)}<span>Publish</span></button>
                    <a class="btn btn-secondary" href="${videoHref(video.id)}" id="exOpen">Open clip</a>
                    <button type="button" class="btn btn-secondary" id="exKeep">Keep editing</button>
                </div>`);
            $('#exKeep', dlg).addEventListener('click', close);
            $('#exOpen', dlg).addEventListener('click', () => dlg.close());
            $('#exPub', dlg).addEventListener('click', () => { dlg.close(); P.dirty = false; openPublishDialog(video, (next) => { location.hash = videoHref(next.id); }); });
            loadBin();
        }

        setup();
        dlg.showModal();
    }

    onLeave(() => {
        clearTimeout(saveTimer);
        if (exportCtl) exportCtl.abort('');
        else if (P.dirty && P.id && P.clips.length) edSaveQuiet(P);     // a saved project keeps its latest changes
        pause();
        P.mounted = null;
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('resize', onResize);
        if (ro) ro.disconnect();
        root.removeEventListener('click', onTop);
    });

    sizeCanvas();
    renderAll();
    loadBin();
}
