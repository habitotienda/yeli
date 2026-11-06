'use strict';

/* =========================================================================
   Video editor (#/editor and #/editor/<clip id>)

   Everything happens in the browser: the clips are played into a <canvas> (with the filters and the texts drawn on
   top) and the sound goes through Web Audio. Exporting plays the timeline once, in real time, and records that canvas
   and that sound with MediaRecorder. The result is uploaded as a new private clip (POST /api/vod/new + /chunk +
   /finish, see yeli/vods.py) or saved as a file on the device.

   What it can do: bring your clips and streams (or a video from your device), cut and trim, split, join in any
   order, speed (0.25x to 4x), volume and mute, filters, fade in and out, fit or crop to the frame, 16:9, 9:16 and 1:1,
   texts with a start and a length, undo and redo.

   The project is kept while you move around the site (module variable EDP); it is lost when the page is reloaded.
   ========================================================================= */
const ED_FILTERS = [
    ['none', 'No filter', 'none'],
    ['bw', 'Black and white', 'grayscale(1)'],
    ['sepia', 'Sepia', 'sepia(0.9)'],
    ['vivid', 'Vivid', 'saturate(1.7) contrast(1.1)'],
    ['warm', 'Warm', 'sepia(0.35) saturate(1.3) brightness(1.05)'],
    ['cool', 'Cool', 'hue-rotate(18deg) saturate(1.1) brightness(1.03)'],
    ['cinema', 'Cinema', 'contrast(1.2) brightness(0.9) saturate(0.85)'],
    ['blur', 'Blur', 'blur(4px)'],
];
const ED_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const ED_FADES = [0, 0.5, 1, 2];
const ED_ASPECTS = { '16:9': [16, 9, 'Wide (16:9)'], '9:16': [9, 16, 'Vertical (9:16)'], '1:1': [1, 1, 'Square (1:1)'] };
const ED_QUALITY = { 720: 4000000, 480: 2000000, 360: 1000000 };
const ED_MIN = 0.1; // the shortest piece of video or text, in seconds
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
};
const edIc = (name, size = 18) => IC(ED_ICON[name][0], ED_ICON[name][1] || 'none', size);

/** The project. It outlives the page so that you can look at a video and come back without losing the work. */
let EDP = null;

function edNewProject() {
    return {
        assets: new Map(),      // id -> { id, name, url, el, duration, thumb, node, gain }
        clips: [],              // the timeline, in order: { uid, asset, in, out, speed, volume, filter, fadeIn, fadeOut, fit }
        texts: [],              // { uid, text, start, dur, size, color, bg, pos }, start and dur in timeline seconds
        aspect: '16:9',
        sel: null,              // { type: 'clip' | 'text', uid }
        t: 0,                   // the playhead, in timeline seconds
        zoom: 60,               // pixels per second of the timeline
        playing: false,
        active: null,           // uid of the clip whose video element is playing
        prep: null,
        undo: [], redo: [], lastKey: '', lastAt: 0,
        dirty: false,
        exporting: false,
        ac: null, speaker: null, dest: null,
        bin: [],                // my clips and videos, from the server
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
    const a = { id: info.key, name: info.name, url: info.url, el, duration: info.duration || 0, thumb: info.thumb || '', node: null, gain: null };
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

const edNewClip = (asset) => ({ uid: edUid(), asset, in: 0, out: asset.duration, speed: 1, volume: 1, filter: 'none', fadeIn: 0, fadeOut: 0, fit: 'fit' });

function edMissing() {
    if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return 'This browser can\u2019t record the edited video. Use a recent Chrome, Edge or Firefox on a computer.';
    return '';
}

async function pageEditor(root, vodId, alive) {
    document.title = 'Video editor | Yeli';
    if (!state.me) {
        root.innerHTML = emptyState('Video editor', 'Log in to cut and join your clips and streams, add texts and publish the result.',
            '<button type="button" class="btn btn-primary" data-auth="login">Log In</button>', 'broadcast');
        return;
    }
    const missing = edMissing();
    if (missing) { root.innerHTML = emptyState('Video editor', esc(missing), '<a class="btn btn-secondary" href="#/clips">Back to Clips</a>', 'broadcast'); return; }

    const P = EDP || (EDP = edNewProject());
    root.innerHTML = `
    <div class="ed">
        <div class="ed-top">
            <div><h1 class="page-title">Video editor</h1></div>
            <div class="ed-top-actions">
                <button type="button" class="btn btn-secondary btn-icon" id="edUndo" aria-label="Undo" title="Undo (Ctrl+Z)">${edIc('undo')}</button>
                <button type="button" class="btn btn-secondary btn-icon" id="edRedo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)">${edIc('redo')}</button>
                <a class="btn btn-secondary" href="#/clips">Clips</a>
                <button type="button" class="btn btn-primary btn-ico" id="edExport">${edIc('download', 17)}<span>Export</span></button>
            </div>
        </div>
        <div class="ed-main">
            <aside class="ed-bin" aria-label="Your clips and videos">
                <h2 class="ed-h2">Your clips and streams</h2>
                <div class="ed-bin-list" id="edBin"><p class="muted">Loading\u2026</p></div>
                <label class="btn btn-secondary btn-ico ed-upload">${edIc('upload', 16)}<span>Add a video from this device</span><input type="file" id="edFile" accept="video/*" hidden></label>
            </aside>
            <section class="ed-stage" aria-label="Preview">
                <div class="ed-screen" id="edScreen">
                    <canvas id="edCanvas" width="1280" height="720"></canvas>
                    <div class="ed-screen-empty" id="edEmpty"><strong>Start with a clip</strong><span>Pick one from the list to put it on the timeline.</span></div>
                </div>
                <div class="ed-transport">
                    <button type="button" class="btn btn-secondary btn-icon" id="edToStart" aria-label="Go to the start" title="Go to the start">${edIc('start')}</button>
                    <button type="button" class="btn btn-primary btn-icon ed-play" id="edPlay" aria-label="Play" title="Play (Space)">${edIc('play', 20)}</button>
                    <button type="button" class="btn btn-secondary btn-icon" id="edToEnd" aria-label="Go to the end" title="Go to the end">${edIc('end')}</button>
                    <span class="ed-time" id="edTime" aria-live="off">0:00.0 / 0:00.0</span>
                </div>
            </section>
            <aside class="ed-insp" id="edInsp" aria-label="Settings"></aside>
        </div>
        <section class="ed-tl" aria-label="Timeline">
            <div class="ed-tl-bar" role="toolbar" aria-label="Timeline tools">
                <button type="button" class="btn btn-secondary btn-ico" data-act="split" title="Split at the playhead (S)">${edIc('cut', 16)}<span>Split</span></button>
                <button type="button" class="btn btn-secondary btn-ico" data-act="dup" title="Duplicate">${edIc('copy', 16)}<span>Duplicate</span></button>
                <button type="button" class="btn btn-secondary btn-ico" data-act="del" title="Delete (Del)">${edIc('trash', 16)}<span>Delete</span></button>
                <button type="button" class="btn btn-secondary btn-icon" data-act="left" aria-label="Move earlier" title="Move earlier ([)">${edIc('left', 16)}</button>
                <button type="button" class="btn btn-secondary btn-icon" data-act="right" aria-label="Move later" title="Move later (])">${edIc('right', 16)}</button>
                <button type="button" class="btn btn-secondary btn-ico" data-act="text" title="Add a text at the playhead">${edIc('text', 16)}<span>Text</span></button>
                <span class="ed-spacer"></span>
                <button type="button" class="btn btn-secondary btn-icon" data-act="zoomout" aria-label="Zoom out" title="Zoom out">${edIc('minus', 16)}</button>
                <button type="button" class="btn btn-secondary btn-icon" data-act="zoomin" aria-label="Zoom in" title="Zoom in">${edIc('plus', 16)}</button>
            </div>
            <div class="ed-tl-scroll" id="edScroll">
                <div class="ed-tl-inner" id="edInner">
                    <div class="ed-ruler" id="edRuler"></div>
                    <div class="ed-track ed-track-v" id="edTrackV"></div>
                    <div class="ed-track ed-track-t" id="edTrackT"></div>
                    <div class="ed-playhead" id="edHead"><span></span></div>
                </div>
            </div>
        </section>
        <p class="ed-tip muted">Tip: click the timeline to place the playhead, then split. Drag the edges of a block to trim it. Space plays and pauses. Exporting runs in real time: keep this tab open and visible until it ends.</p>
    </div>`;

    const canvas = $('#edCanvas'), ctx = canvas.getContext('2d');
    const binEl = $('#edBin'), insp = $('#edInsp'), scroll = $('#edScroll'), inner = $('#edInner');
    const rulerEl = $('#edRuler'), trackV = $('#edTrackV'), trackT = $('#edTrackT'), head = $('#edHead');
    const timeEl = $('#edTime'), playBtn = $('#edPlay'), emptyEl = $('#edEmpty');
    let raf = 0, lastNow = 0, exportCtl = null;

    /* ---------- the picture ---------- */
    function sizeCanvas(shortSide = 0) {
        const [aw, ah] = ED_ASPECTS[P.aspect];
        const even = (n) => Math.max(2, Math.round(n / 2) * 2);
        let w, h;
        if (shortSide) { if (aw >= ah) { h = shortSide; w = even(shortSide * aw / ah); } else { w = shortSide; h = even(shortSide * ah / aw); } }
        else if (aw >= ah) { w = 1280; h = even(1280 * ah / aw); } else { h = 1280; w = even(1280 * aw / ah); }
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        $('#edScreen').style.aspectRatio = `${aw} / ${ah}`;
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

    function drawText(tx) {
        const H = canvas.height, W = canvas.width;
        const px = Math.max(8, Math.round(tx.size / 100 * H));
        ctx.font = `700 ${px}px Fredoka, "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lines = wrapLines(tx.text, W * 0.88);
        const lh = px * 1.25, blockH = lines.length * lh;
        const cy = tx.pos === 'top' ? H * 0.08 + blockH / 2 : tx.pos === 'middle' ? H / 2 : H * 0.92 - blockH / 2;
        if (tx.bg) {
            const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + px * 0.9;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
            ctx.fillRect(W / 2 - w / 2, cy - blockH / 2 - px * 0.3, w, blockH + px * 0.6);
        }
        ctx.lineJoin = 'round';
        ctx.lineWidth = px * 0.14;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillStyle = tx.color;
        lines.forEach((l, i) => {
            const y = cy - blockH / 2 + lh * (i + 0.5);
            if (!tx.bg) ctx.strokeText(l, W / 2, y);
            ctx.fillText(l, W / 2, y);
        });
    }

    function draw() {
        const W = canvas.width, H = canvas.height;
        ctx.filter = 'none';
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        const L = edLayout(P);
        const loc = edLocate(L, P.t);
        if (loc) {
            const { c, local } = loc;
            const el = c.asset.el;
            if (el.readyState >= 2 && el.videoWidth) {
                const vw = el.videoWidth, vh = el.videoHeight;
                const s = c.fit === 'fill' ? Math.max(W / vw, H / vh) : Math.min(W / vw, H / vh);
                ctx.save();
                ctx.globalAlpha = edFade(c, local, edClipDur(c));
                if (ED_FILTER_OK) ctx.filter = (ED_FILTERS.find((f) => f[0] === c.filter) || ED_FILTERS[0])[2];
                ctx.drawImage(el, (W - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s);
                ctx.restore();
            }
        }
        const end = L.total;
        for (const tx of P.texts) {
            if (P.t >= tx.start && (P.t < tx.start + tx.dur || (P.t >= end && tx.start < end && tx.start + tx.dur >= end))) drawText(tx);
        }
    }
    P.mounted = { draw };

    /* ---------- playing ---------- */
    function pauseAll(except) {
        for (const a of P.assets.values()) if (a !== except && !a.el.paused) a.el.pause();
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
            pauseAll(a);
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
    }

    function updateHead() {
        const x = P.t * P.zoom;
        head.style.transform = `translateX(${x}px)`;
        timeEl.textContent = `${edFmt(P.t)} / ${edFmt(edTotal(P))}`;
        if (P.playing) {
            if (x > scroll.scrollLeft + scroll.clientWidth - 40) scroll.scrollLeft = x - 40;
            else if (x < scroll.scrollLeft) scroll.scrollLeft = Math.max(0, x - 40);
        }
    }

    function renderTransport() {
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
    const snap = () => JSON.stringify({ clips: P.clips.map((c) => ({ ...c, asset: c.asset.id })), texts: P.texts, aspect: P.aspect });

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
                const tx = { uid: edUid(), text: 'Your text', start: Math.min(P.t, Math.max(0, total - 1)), dur: Math.min(3, total), size: 7, color: '#ffffff', bg: false, pos: 'bottom' };
                P.texts.push(tx);
                P.sel = { type: 'text', uid: tx.uid };
            }, '', true);
        },
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

    function zoomBy(f) {
        const center = (scroll.scrollLeft + scroll.clientWidth / 2) / P.zoom;
        P.zoom = edClamp(P.zoom * f, 8, 300);
        renderTimeline();
        updateHead();
        scroll.scrollLeft = Math.max(0, center * P.zoom - scroll.clientWidth / 2);
    }

    /* ---------- the list of your clips ---------- */
    function renderBin() {
        if (!P.bin.length) {
            binEl.innerHTML = '<p class="muted">You have no saved clips yet. Finish a live stream, or add a video from this device.</p>';
            return;
        }
        binEl.innerHTML = P.bin.map((v) => `
            <button type="button" class="ed-bin-item" data-add="${esc(v.id)}">
                <span class="ed-bin-thumb" ${v.cover ? `style="background-image:url('${esc(vodCoverSrc(v))}')"` : ''}></span>
                <span class="ed-bin-meta"><strong data-no-i18n>${esc(v.title)}</strong><em>${esc(fmtDuration(v.duration * 1000))} \u00b7 ${v.is_clip ? 'Private clip' : 'Published'}</em></span>
                <span class="ed-bin-add" aria-hidden="true">+</span>
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

    const vodInfo = (v) => ({ key: `vod:${v.id}`, name: v.title, url: `/api/vod/${encodeURIComponent(v.id)}/video`, duration: v.duration, thumb: v.cover ? vodCoverSrc(v) : '' });

    async function loadBin() {
        try {
            const r = await api('/me/videos');
            if (!alive()) return;
            P.bin = r.videos;
            renderBin();
            if (vodId && !P.clips.some((c) => c.asset.id === `vod:${vodId}`)) {
                const v = P.bin.find((x) => x.id === vodId);
                if (v) await addAsset(vodInfo(v));
                else toast('That clip was not found.');
            }
        } catch (e) {
            if (alive()) binEl.innerHTML = `<p class="form-error">${esc(e.message)}</p>`;
        }
    }

    /* ---------- timeline ---------- */
    function renderTimeline() {
        const L = edLayout(P);
        const w = Math.max(L.total * P.zoom + 240, scroll.clientWidth);
        inner.style.width = `${w}px`;
        const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
        const step = steps.find((s) => s * P.zoom >= 70) || 600;
        let ticks = '';
        for (let t = 0; t * P.zoom < w; t += step) ticks += `<span class="ed-tick" style="left:${t * P.zoom}px">${edFmtShort(t)}</span>`;
        rulerEl.innerHTML = ticks;
        trackV.innerHTML = L.items.length ? L.items.map(({ c, start, end }) => {
            const a = c.asset, sel = P.sel && P.sel.type === 'clip' && P.sel.uid === c.uid;
            const tags = [c.speed !== 1 ? `${c.speed}\u00d7` : '', c.filter !== 'none' ? 'fx' : '', c.volume === 0 ? 'mute' : ''].filter(Boolean).join(' \u00b7 ');
            return `<div class="ed-clip${sel ? ' is-sel' : ''}" data-clip="${c.uid}" style="left:${start * P.zoom}px;width:${Math.max(6, (end - start) * P.zoom)}px;${a.thumb ? `background-image:url('${esc(a.thumb)}')` : ''}">
                <span class="ed-h ed-h-l" data-h="l"></span><span class="ed-clip-label" data-no-i18n>${esc(a.name)}${tags ? ` <em>${esc(tags)}</em>` : ''}</span><span class="ed-h ed-h-r" data-h="r"></span></div>`;
        }).join('') : '<p class="ed-hint">The timeline is empty.</p>';
        trackT.innerHTML = P.texts.map((tx) => {
            const sel = P.sel && P.sel.type === 'text' && P.sel.uid === tx.uid;
            return `<div class="ed-text${sel ? ' is-sel' : ''}" data-text="${tx.uid}" style="left:${tx.start * P.zoom}px;width:${Math.max(6, tx.dur * P.zoom)}px">
                <span class="ed-h ed-h-l" data-h="l"></span><span class="ed-clip-label" data-no-i18n>${esc(tx.text)}</span><span class="ed-h ed-h-r" data-h="r"></span></div>`;
        }).join('');
    }

    const timeAtX = (x) => edClamp((x - inner.getBoundingClientRect().left) / P.zoom, 0, edTotal(P));

    function drag(e, onMove, onEnd) {
        e.preventDefault();
        inner.setPointerCapture(e.pointerId);
        const x0 = e.clientX;
        const move = (ev) => onMove((ev.clientX - x0) / P.zoom, ev);
        const up = () => {
            inner.removeEventListener('pointermove', move);
            inner.removeEventListener('pointerup', up);
            inner.removeEventListener('pointercancel', up);
            if (onEnd) onEnd();
        };
        inner.addEventListener('pointermove', move);
        inner.addEventListener('pointerup', up);
        inner.addEventListener('pointercancel', up);
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
        } else if (textEl) {
            const tx = P.texts.find((x) => x.uid === textEl.dataset.text);
            if (!tx) return;
            P.sel = { type: 'text', uid: tx.uid };
            pushHistory();
            const s0 = tx.start;
            drag(e, (dt) => { tx.start = Math.max(0, s0 + dt); afterEdit(); }, renderInspector);
        } else {
            if (clipEl) select({ type: 'clip', uid: clipEl.dataset.clip });
            drag(e, (dt, ev) => scrub(timeAtX(ev.clientX)));
            scrub(timeAtX(e.clientX));
        }
    });

    /* ---------- the settings panel ---------- */
    const opts = (list, current, label) => list.map((v) => `<option value="${v}"${Number(v) === Number(current) || v === current ? ' selected' : ''}>${label(v)}</option>`).join('');

    function renderInspector() {
        const c = selClip(), tx = selText();
        if (c) {
            insp.innerHTML = `
                <h2 class="ed-h2">Clip</h2>
                <p class="muted ed-name" data-no-i18n>${esc(c.asset.name)}</p>
                <div class="ed-grid2">
                    <label class="ed-f">Start (s)<input id="inIn" type="number" step="0.1" min="0"></label>
                    <label class="ed-f">End (s)<input id="inOut" type="number" step="0.1" min="0"></label>
                </div>
                <div class="ed-row">
                    <button type="button" class="btn btn-secondary" data-act2="in-here">Start at playhead</button>
                    <button type="button" class="btn btn-secondary" data-act2="out-here">End at playhead</button>
                </div>
                <label class="ed-f">Speed<select id="inSpeed">${opts(ED_SPEEDS, c.speed, (v) => `${v}\u00d7`)}</select></label>
                <label class="ed-f">Volume <output id="inVolO"></output><input id="inVol" type="range" min="0" max="200" step="5"></label>
                <label class="ed-f">Filter<select id="inFilter" ${ED_FILTER_OK ? '' : 'disabled'}>${ED_FILTERS.map(([k, name]) => `<option value="${k}"${c.filter === k ? ' selected' : ''}>${name}</option>`).join('')}</select></label>
                ${ED_FILTER_OK ? '' : '<p class="muted ed-note">Filters need Chrome, Edge or Firefox.</p>'}
                <div class="ed-grid2">
                    <label class="ed-f">Fade in<select id="inFi">${opts(ED_FADES, c.fadeIn, (v) => (v ? `${v} s` : 'None'))}</select></label>
                    <label class="ed-f">Fade out<select id="inFo">${opts(ED_FADES, c.fadeOut, (v) => (v ? `${v} s` : 'None'))}</select></label>
                </div>
                <label class="ed-f">Framing<select id="inFit"><option value="fit"${c.fit === 'fit' ? ' selected' : ''}>Fit: show everything</option><option value="fill"${c.fit === 'fill' ? ' selected' : ''}>Fill: crop the edges</option></select></label>`;
        } else if (tx) {
            insp.innerHTML = `
                <h2 class="ed-h2">Text</h2>
                <label class="ed-f">Text<textarea id="txText" rows="2" maxlength="120"></textarea></label>
                <div class="ed-grid2">
                    <label class="ed-f">Start (s)<input id="txStart" type="number" step="0.1" min="0"></label>
                    <label class="ed-f">Length (s)<input id="txDur" type="number" step="0.1" min="0.1"></label>
                </div>
                <label class="ed-f">Size <output id="txSizeO"></output><input id="txSize" type="range" min="3" max="20" step="1"></label>
                <div class="ed-grid2">
                    <label class="ed-f">Color<input id="txColor" type="color"></label>
                    <label class="ed-f">Position<select id="txPos"><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></label>
                </div>
                <label class="ed-check"><input id="txBg" type="checkbox"><span>Dark box behind the text</span></label>`;
        } else {
            insp.innerHTML = `
                <h2 class="ed-h2">Project</h2>
                <label class="ed-f">Shape of the video<select id="pjAspect">${Object.entries(ED_ASPECTS).map(([k, v]) => `<option value="${k}"${P.aspect === k ? ' selected' : ''}>${v[2]}</option>`).join('')}</select></label>
                <p class="muted ed-note" id="pjLen"></p>
                <p class="muted ed-note">Select a clip or a text on the timeline to change it.</p>`;
        }
        fillInspector();
    }

    /** Puts the numbers of the selected item into the fields, without rebuilding them (so typing is not interrupted). */
    function fillInspector() {
        const set = (id, v) => { const el = $(`#${id}`, insp); if (el && document.activeElement !== el) el.value = v; };
        const c = selClip(), tx = selText();
        if (c) {
            set('inIn', c.in.toFixed(2));
            set('inOut', c.out.toFixed(2));
            set('inVol', Math.round(c.volume * 100));
            $('#inVolO', insp).textContent = c.volume === 0 ? 'Muted' : `${Math.round(c.volume * 100)}%`;
        } else if (tx) {
            set('txText', tx.text);
            set('txStart', tx.start.toFixed(2));
            set('txDur', tx.dur.toFixed(2));
            set('txSize', tx.size);
            set('txColor', tx.color);
            set('txPos', tx.pos);
            const bg = $('#txBg', insp);
            if (bg) bg.checked = tx.bg;
            $('#txSizeO', insp).textContent = `${tx.size}%`;
        } else {
            const len = $('#pjLen', insp);
            if (len) len.textContent = P.clips.length ? `${P.clips.length} clip${P.clips.length === 1 ? '' : 's'} \u00b7 ${edFmt(edTotal(P))} long` : 'The timeline is empty.';
        }
    }

    insp.addEventListener('input', (e) => {
        const id = e.target.id, c = selClip(), tx = selText();
        if (c) {
            if (id === 'inVol') mutate(() => { c.volume = edNum(e.target.value, 100) / 100; }, `vol${c.uid}`);
        } else if (tx) {
            if (id === 'txText') mutate(() => { tx.text = e.target.value || ' '; }, `txt${tx.uid}`);
            else if (id === 'txSize') mutate(() => { tx.size = edNum(e.target.value, 7); }, `size${tx.uid}`);
            else if (id === 'txColor') mutate(() => { tx.color = e.target.value; }, `col${tx.uid}`);
        }
    });

    insp.addEventListener('change', (e) => {
        const id = e.target.id, c = selClip(), tx = selText();
        const v = e.target.value;
        if (c) {
            const min = ED_MIN * c.speed;
            if (id === 'inIn') mutate(() => { c.in = edClamp(edNum(v), 0, c.out - min); }, '');
            else if (id === 'inOut') mutate(() => { c.out = edClamp(edNum(v), c.in + min, c.asset.duration); }, '');
            else if (id === 'inSpeed') mutate(() => { c.speed = edNum(v, 1); }, '');
            else if (id === 'inFilter') mutate(() => { c.filter = v; }, '');
            else if (id === 'inFi') mutate(() => { c.fadeIn = edNum(v); }, '');
            else if (id === 'inFo') mutate(() => { c.fadeOut = edNum(v); }, '');
            else if (id === 'inFit') mutate(() => { c.fit = v; }, '');
        } else if (tx) {
            if (id === 'txStart') mutate(() => { tx.start = Math.max(0, edNum(v)); }, '');
            else if (id === 'txDur') mutate(() => { tx.dur = Math.max(ED_MIN, edNum(v, 1)); }, '');
            else if (id === 'txPos') mutate(() => { tx.pos = v; }, '');
            else if (id === 'txBg') mutate(() => { tx.bg = e.target.checked; }, '');
        } else if (id === 'pjAspect') {
            mutate(() => { P.aspect = v; sizeCanvas(); }, '');
        }
    });

    insp.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act2]');
        const c = selClip();
        if (!b || !c) return;
        const L = edLayout(P);
        const item = L.items.find((i) => i.c === c);
        const local = edClamp(P.t - item.start, 0, item.end - item.start);
        const src = c.in + local * c.speed, min = ED_MIN * c.speed;
        if (b.dataset.act2 === 'in-here') mutate(() => { c.in = edClamp(src, 0, c.out - min); P.t = item.start; }, '');
        else mutate(() => { c.out = edClamp(src, c.in + min, c.asset.duration); }, '');
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
        if (v) addAsset(vodInfo(v), b);
    });
    $('#edFile').addEventListener('change', async (e) => {
        const f = e.target.files[0];
        e.target.value = '';
        if (!f) return;
        if (!f.type.startsWith('video/')) { toast('Choose a video file.'); return; }
        const key = `file:${f.name}:${f.size}:${f.lastModified}`;
        const known = P.assets.get(key);
        await addAsset(known ? { key } : { key, name: f.name, url: URL.createObjectURL(f), duration: 0, thumb: '' });
    });
    playBtn.addEventListener('click', () => (P.playing ? pause() : play()));
    $('#edToStart').addEventListener('click', () => scrub(0));
    $('#edToEnd').addEventListener('click', () => scrub(edTotal(P)));
    $('#edUndo').addEventListener('click', undo);
    $('#edRedo').addEventListener('click', redo);
    $('#edExport').addEventListener('click', () => openExport());

    const onKey = (e) => {
        const tag = (e.target.tagName || '').toLowerCase();
        const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
        if (document.querySelector('dialog[open]')) return;
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === 'z') { if (typing && tag !== 'select') return; e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
        if (mod && e.key.toLowerCase() === 'y') { if (typing) return; e.preventDefault(); redo(); return; }
        if (typing || mod || e.altKey) return;
        if (e.key === ' ') { e.preventDefault(); if (P.clips.length) (P.playing ? pause() : play()); }
        else if (e.key === 's' || e.key === 'S') actions.split();
        else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); actions.del(); }
        else if (e.key === '[') actions.left();
        else if (e.key === ']') actions.right();
        else if (e.key === 'ArrowLeft') { e.preventDefault(); scrub(P.t - (e.shiftKey ? 1 : 1 / 30)); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); scrub(P.t + (e.shiftKey ? 1 : 1 / 30)); }
    };
    document.addEventListener('keydown', onKey);
    const onResize = () => renderTimeline();
    window.addEventListener('resize', onResize);

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
            const defaultTitle = (P.clips[0].asset.name || 'Edited video').slice(0, 70);
            shell('Export video', `
                <form class="props-form" id="exForm" novalidate>
                    <div class="field"><label for="exTitle">Title</label><input id="exTitle" maxlength="80" autocomplete="off" required></div>
                    <div class="field"><label for="exQ">Quality</label><select id="exQ"><option value="720">720p</option><option value="480">480p</option><option value="360">360p (smaller file)</option></select></div>
                    <div class="notice" role="note">It is recorded in real time: this video is ${esc(edFmt(total))} long, so it takes about that long. Keep this tab open and visible until it ends.</div>
                    <p class="form-error" id="exErr" role="alert" hidden></p>
                    <button type="submit" class="btn btn-primary btn-block" id="exClip">Save as a private clip</button>
                    <button type="button" class="btn btn-secondary btn-block" id="exFile">Download a file instead</button>
                </form>`);
            $('#exTitle', dlg).value = `${defaultTitle} (edit)`.slice(0, 80);
            const go = (mode) => {
                const title = $('#exTitle', dlg).value.trim();
                if (!title) { const er = $('#exErr', dlg); er.textContent = 'Give your video a title.'; er.hidden = false; return; }
                run({ mode, title, short: Number($('#exQ', dlg).value) });
            };
            $('#exForm', dlg).addEventListener('submit', (e) => { e.preventDefault(); go('clip'); });
            $('#exFile', dlg).addEventListener('click', () => go('file'));
        }

        function fail(message) {
            shell('Couldn\u2019t export', `<p class="form-error" role="alert">${esc(message)}</p><div class="row"><button type="button" class="btn btn-secondary" id="exClose">Close</button><button type="button" class="btn btn-primary" id="exAgain">Try again</button></div>`);
            $('#exClose', dlg).addEventListener('click', close);
            $('#exAgain', dlg).addEventListener('click', setup);
        }

        async function run(o) {
            const ac = edAudio(P);
            if (ac) { for (const a of P.assets.values()) edWire(P, a); await ac.resume().catch(() => {}); }
            const mime = (typeof VOD_MIMES !== 'undefined' ? VOD_MIMES : ['video/webm;codecs=vp8,opus', 'video/webm']).find((m) => MediaRecorder.isTypeSupported(m));
            if (!mime) { fail('This browser can\u2019t record video in a format Yeli accepts.'); return; }

            let upload = null;
            if (o.mode === 'clip') {
                try {
                    const info = await api('/vod/new', { method: 'POST', body: { mime, title: o.title } });
                    upload = { id: info.id, seq: 0, queue: Promise.resolve(), pending: 0, failed: false, message: '', fail(msg) { this.failed = true; this.message = msg || this.message; ctl.abort(this.message); } };
                } catch (e) { fail(e.message); return; }
            }

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
                if (upload) api(`/vod/${upload.id}/delete`, { method: 'POST' }).catch(() => {});
                fail('This browser couldn\u2019t start recording.');
                return;
            }
            const blobs = [];
            let cover = null, finished = false;
            recorder.ondataavailable = (ev) => {
                if (!ev.data || !ev.data.size || finished === 'aborted') return;
                if (upload) {
                    const seq = upload.seq++;
                    upload.pending += ev.data.size;
                    upload.queue = upload.queue.then(() => uploadVodPiece(upload, seq, ev.data)).catch(() => {});
                } else blobs.push(ev.data);
            };

            const bar = () => $('.ed-prog > span', dlg);
            shell('Exporting\u2026', `
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
                    if (upload && upload.failed) ctl.abort(upload.message);
                },
                async ended() {
                    if (finished) return;
                    finished = true;
                    if (!cover) cover = makeCover();
                    const stopped = new Promise((r) => { recorder.addEventListener('stop', r, { once: true }); });
                    try { recorder.stop(); } catch { /* already stopped */ }
                    await stopped;
                    shell('Saving\u2026', '<div class="ed-prog"><span style="width:100%"></span></div><p class="muted">Finishing the upload. Keep this tab open.</p>');
                    try {
                        if (upload) {
                            await Promise.race([upload.queue, new Promise((r) => setTimeout(r, 120000))]);
                            if (upload.failed) throw new Error(upload.message || 'The upload failed.');
                            const r = await api(`/vod/${upload.id}/finish`, { method: 'POST', body: { duration: total, cover } });
                            if (!r.saved) throw new Error('Nothing was recorded.');
                            P.dirty = false;
                            restore2();
                            done(r.video);
                        } else {
                            const blob = new Blob(blobs, { type: mime.split(';')[0] });
                            const url = URL.createObjectURL(blob);
                            const name = `${o.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'video'}.${mime.includes('mp4') ? 'mp4' : 'webm'}`;
                            P.dirty = false;
                            restore2();
                            shell('Your video is ready', `<p>The file was made on this device.</p><a class="btn btn-primary btn-block" id="exDl" href="${url}" download="${esc(name)}">Download ${esc(name)}</a><button type="button" class="btn btn-secondary btn-block" id="exOk">Close</button>`);
                            $('#exOk', dlg).addEventListener('click', close);
                            $('#exDl', dlg).click();
                            dlg.addEventListener('close', () => setTimeout(() => URL.revokeObjectURL(url), 60000));
                        }
                    } catch (e) {
                        restore2();
                        if (upload) api(`/vod/${upload.id}/delete`, { method: 'POST' }).catch(() => {});
                        fail(e.message);
                    }
                },
                abort(message) {
                    if (finished) return;
                    finished = 'aborted';
                    pause();
                    try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* already stopped */ }
                    if (upload) api(`/vod/${upload.id}/delete`, { method: 'POST' }).catch(() => {});
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
            shell('Saved as a private clip', `
                <p>Your edited video is in your clips. Only you can see it until you publish it.</p>
                <div class="row ed-done-row">
                    <button type="button" class="btn btn-primary btn-ico" id="exPub">${edIc('globe', 16)}<span>Publish now</span></button>
                    <a class="btn btn-secondary" href="${videoHref(video.id)}" id="exOpen">Open clip</a>
                    <button type="button" class="btn btn-secondary" id="exKeep">Keep editing</button>
                </div>`);
            $('#exKeep', dlg).addEventListener('click', close);
            $('#exOpen', dlg).addEventListener('click', () => dlg.close());
            $('#exPub', dlg).addEventListener('click', () => { dlg.close(); openPublishDialog(video, (next) => { location.hash = videoHref(next.id); }); });
            loadBin();
        }

        setup();
        dlg.showModal();
    }

    onLeave(() => {
        if (exportCtl) exportCtl.abort('');
        pause();
        P.mounted = null;
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('resize', onResize);
        root.removeEventListener('click', onTop);
    });

    sizeCanvas();
    renderAll();
    loadBin();
}
