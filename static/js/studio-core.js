'use strict';

/* =========================================================================
   Studio core: scenes + sources composited on a canvas, and an audio mixer.
   The canvas (plus the mixed audio) is what viewers receive, like OBS's program output.
   ========================================================================= */
const STUDIO_KEY = 'yeli:studio:v2';
const RES = { 480: [854, 480], 720: [1280, 720], 1080: [1920, 1080] };
const STUDIO_DEFAULTS = {
    res: '720', fps: '30', bitrate: '2500', hint: 'auto',
    ns: true, ec: true, agc: true, videoDeviceId: '', audioDeviceId: '', micVolume: 1,
    title: '', category: '',
};

let S = null; // the open studio session (null when closed)

const sid = () => Math.random().toString(36).slice(2, 9);

function loadCfg() {
    try { return { ...STUDIO_DEFAULTS, ...JSON.parse(localStorage.getItem(STUDIO_KEY) || '{}') }; }
    catch { return { ...STUDIO_DEFAULTS }; }
}

function saveCfg() {
    if (!S) return;
    try { localStorage.setItem(STUDIO_KEY, JSON.stringify(S.cfg)); } catch { /* private mode */ }
}

const notifyStudio = () => { if (S && S.onChange) S.onChange(); };

function mediaError(e) {
    switch (e && e.name) {
        case 'NotAllowedError': return 'Permission was denied. Allow camera, microphone or screen access in your browser and try again.';
        case 'NotFoundError': return 'No camera or microphone was found on this device.';
        case 'NotReadableError': return 'Your camera or microphone is being used by another app.';
        case 'OverconstrainedError': return 'That device doesn\u2019t support the requested quality. Try a lower resolution.';
        default: return (e && e.message) || 'Couldn\u2019t start the capture.';
    }
}

/* ---------- Session ---------- */
function openSession() {
    if (S) return S;
    const cfg = loadCfg();
    if (!cfg.category || !state.config.categories.includes(cfg.category)) cfg.category = state.config.categories[0] || 'Other';
    const [w, h] = RES[cfg.res] || RES[720];
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.className = 'studio-canvas';
    const scene = { id: sid(), name: 'Scene', items: [] };
    S = {
        cfg, canvas, ctx: canvas.getContext('2d', { alpha: false }),
        scenes: [scene], sceneId: scene.id,
        sources: new Map(), selected: null,
        audio: null, outStream: null,
        frames: 0, fps: 0, lastFpsAt: performance.now(),
        host: document.createElement('div'), ticker: null, onChange: null,
    };
    S.host.className = 'media-host';
    S.host.setAttribute('aria-hidden', 'true');
    document.body.appendChild(S.host);
    startTicker();
    return S;
}

function closeSession() {
    if (!S) return;
    stopTicker();
    S.sources.forEach((src) => releaseSource(src));
    if (S.audio) {
        S.audio.channels.forEach((ch) => { try { ch.track.stop(); } catch { /* already stopped */ } });
        S.audio.ctx.close().catch(() => {});
    }
    if (S.outStream) S.outStream.getTracks().forEach((t) => t.stop());
    S.host.remove();
    S = null;
}

/** setInterval that keeps its pace in background tabs (timers run inside a Worker, which browsers don't throttle). */
function workerInterval(fn, ms) {
    const fallback = () => { const id = setInterval(fn, ms); return { stop: () => clearInterval(id) }; };
    try {
        const w = new Worker('static/js/ticker.js');
        let fb = null;
        w.onmessage = fn;
        w.onerror = () => { w.terminate(); if (!fb) fb = fallback(); };
        w.postMessage({ cmd: 'start', ms });
        return { stop() { if (fb) fb.stop(); else { w.postMessage({ cmd: 'stop' }); w.terminate(); } } };
    } catch { return fallback(); }
}

function startTicker() {
    stopTicker();
    S.ticker = workerInterval(drawFrame, 1000 / (Number(S.cfg.fps) || 30));
}

function stopTicker() {
    if (S && S.ticker) { S.ticker.stop(); S.ticker = null; }
}

const activeScene = () => S.scenes.find((sc) => sc.id === S.sceneId) || S.scenes[0];

/* ---------- Compositor ---------- */
function drawable(src) {
    if (src.type === 'camera' || src.type === 'screen') {
        const v = src.video;
        return v.readyState >= 2 && v.videoWidth ? { el: v, aspect: v.videoWidth / v.videoHeight } : null;
    }
    if (src.type === 'image') return src.img && src.img.naturalWidth ? { el: src.img, aspect: src.img.naturalWidth / src.img.naturalHeight } : null;
    if (src.type === 'text') return src.canvas ? { el: src.canvas, aspect: src.canvas.width / src.canvas.height } : null;
    return null;
}

function srcAspect(src) {
    const d = drawable(src);
    if (d) return d.aspect;
    const t = src.stream && src.stream.getVideoTracks()[0];
    const st = t && t.getSettings();
    return st && st.width && st.height ? st.width / st.height : 16 / 9;
}

const itemRect = (it, aspect, CW, CH) => {
    const w = it.scale * CW;
    return { x: it.x * CW, y: it.y * CH, w, h: w / aspect };
};

function drawFrame() {
    const s = S;
    if (!s) return;
    const { ctx, canvas } = s;
    const CW = canvas.width, CH = canvas.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CW, CH);
    for (const it of activeScene().items) {
        if (!it.visible) continue;
        const src = s.sources.get(it.src);
        const d = src && drawable(src);
        if (!d) continue;
        const r = itemRect(it, d.aspect, CW, CH);
        try { ctx.drawImage(d.el, r.x, r.y, r.w, r.h); } catch { /* source not ready yet */ }
    }
    s.frames++;
    const t = performance.now();
    if (t - s.lastFpsAt >= 1000) {
        s.fps = Math.round((s.frames * 1000) / (t - s.lastFpsAt));
        s.frames = 0;
        s.lastFpsAt = t;
    }
}

function applyPreset(it, aspect, preset) {
    const CW = S.canvas.width, CH = S.canvas.height, ca = CW / CH, m = 0.02;
    const center = (scale) => { it.scale = scale; it.x = (1 - scale) / 2; it.y = (CH - (scale * CW) / aspect) / 2 / CH; };
    switch (preset) {
        case 'fit': center(aspect >= ca ? 1 : aspect / ca); break;
        case 'fill': center(aspect >= ca ? aspect / ca : 1); break;
        case 'tl': case 'tr': case 'bl': case 'br': {
            const scale = 0.26;
            const h = (scale * CW) / aspect;
            it.scale = scale;
            it.x = preset.endsWith('l') ? m : 1 - scale - m;
            it.y = preset.startsWith('t') ? (m * CW) / CH : (CH - h - m * CW) / CH;
            break;
        }
        case 'left': case 'right': {
            it.scale = 0.5;
            it.x = preset === 'left' ? 0 : 0.5;
            it.y = (CH - (0.5 * CW) / aspect) / 2 / CH;
            break;
        }
        case 'lower': it.scale = 0.34; it.x = 0.04; it.y = 0.84 - 0.05; break;
        default: break;
    }
}

/* ---------- Scenes ---------- */
function addScene() {
    const n = S.scenes.length + 1;
    const scene = { id: sid(), name: `Scene ${n}`, items: [] };
    S.scenes.push(scene);
    S.sceneId = scene.id;
    S.selected = null;
    notifyStudio();
}

function removeScene(id) {
    if (S.scenes.length < 2) return false;
    const scene = S.scenes.find((sc) => sc.id === id);
    if (!scene) return false;
    S.scenes = S.scenes.filter((sc) => sc.id !== id);
    if (S.sceneId === id) S.sceneId = S.scenes[0].id;
    S.selected = null;
    scene.items.forEach((it) => dropIfUnused(it.src));
    notifyStudio();
    return true;
}

function selectScene(id) {
    if (S.sceneId === id) return;
    S.sceneId = id;
    S.selected = null;
    notifyStudio();
}

/* ---------- Sources ---------- */
function uniqueName(base) {
    const names = new Set([...S.sources.values()].map((s) => s.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
}

async function gum(constraints) {
    try {
        return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
        // A saved device may be unplugged: retry once with the default device.
        const loose = JSON.parse(JSON.stringify(constraints));
        for (const kind of ['video', 'audio']) if (loose[kind] && typeof loose[kind] === 'object') delete loose[kind].deviceId;
        if ((e.name === 'OverconstrainedError' || e.name === 'NotFoundError') && JSON.stringify(loose) !== JSON.stringify(constraints)) return gum(loose);
        throw e;
    }
}

function requireMedia() {
    if (!navigator.mediaDevices) throw new Error('Streaming needs a secure connection. Open the site over HTTPS or on localhost.');
}

function videoConstraints(deviceId) {
    const [w, h] = RES[S.cfg.res] || RES[720];
    const v = { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: Number(S.cfg.fps) || 30 } };
    if (deviceId) v.deviceId = { exact: deviceId };
    return v;
}

function attachVideo(src, stream) {
    if (!src.video) {
        src.video = document.createElement('video');
        src.video.muted = true;
        src.video.playsInline = true;
        src.video.autoplay = true;
        S.host.appendChild(src.video);
    }
    src.video.srcObject = new MediaStream(stream.getVideoTracks());
    src.video.play().catch(() => {});
}

async function addCameraSource(deviceId = S.cfg.videoDeviceId) {
    requireMedia();
    const stream = await gum({ video: videoConstraints(deviceId) });
    const track = stream.getVideoTracks()[0];
    const src = { id: sid(), type: 'camera', name: uniqueName('Video Capture Device'), stream, deviceId: track.getSettings().deviceId || deviceId || '' };
    attachVideo(src, stream);
    S.sources.set(src.id, src);
    track.addEventListener('ended', () => { if (S && S.sources.has(src.id)) { removeSource(src.id); toast('A camera was disconnected.'); } });
    return src;
}

async function replaceCamera(src, deviceId) {
    requireMedia();
    const stream = await gum({ video: videoConstraints(deviceId) });
    src.stream.getTracks().forEach((t) => t.stop());
    src.stream = stream;
    src.deviceId = stream.getVideoTracks()[0].getSettings().deviceId || deviceId || '';
    attachVideo(src, stream);
    stream.getVideoTracks()[0].addEventListener('ended', () => { if (S && S.sources.has(src.id)) removeSource(src.id); });
    S.cfg.videoDeviceId = src.deviceId;
    saveCfg();
}

async function addScreenSource() {
    requireMedia();
    if (!navigator.mediaDevices.getDisplayMedia) throw new Error('Screen sharing isn\u2019t supported on this device or browser.');
    const [w, h] = RES[S.cfg.res] || RES[720];
    const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: Number(S.cfg.fps) || 30 } },
        audio: true,
    });
    const src = { id: sid(), type: 'screen', name: uniqueName('Display Capture'), stream };
    attachVideo(src, stream);
    S.sources.set(src.id, src);
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) addAudioChannel(`screen:${src.id}`, 'Desktop Audio', audioTrack);
    stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (S && S.sources.has(src.id)) { removeSource(src.id); toast('Screen sharing stopped.'); }
    });
    return src;
}

function renderText(src) {
    const { text, size, color, bg } = src.props;
    const lines = String(text || ' ').split('\n').slice(0, 6);
    const font = `600 ${size}px Fredoka, "Segoe UI", sans-serif`;
    const c = src.canvas || document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = font;
    const pad = bg ? Math.round(size * 0.35) : 4;
    const lineH = Math.round(size * 1.25);
    const width = Math.max(40, Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + pad * 2);
    c.width = width;
    c.height = lineH * lines.length + pad * 2;
    ctx.font = font;
    if (bg) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath();
        ctx.roundRect(0, 0, c.width, c.height, Math.round(size * 0.3));
        ctx.fill();
    }
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, pad, pad + i * lineH + (lineH - size) / 2));
    src.canvas = c;
}

function addTextSource() {
    const src = { id: sid(), type: 'text', name: uniqueName('Text'), props: { text: 'Your text here', size: 64, color: '#ffffff', bg: true } };
    renderText(src);
    S.sources.set(src.id, src);
    return src;
}

function addImageSource(file) {
    return new Promise((resolve, reject) => {
        if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) return reject(new Error('Choose a PNG, JPG, WebP or GIF image.'));
        if (file.size > 4 * 1024 * 1024) return reject(new Error('That image is too large. The limit is 4 MB.'));
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Couldn\u2019t read that file.'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('Couldn\u2019t read that image.'));
            img.onload = () => {
                const src = { id: sid(), type: 'image', name: uniqueName(file.name.replace(/\.[^.]+$/, '').slice(0, 30) || 'Image'), img };
                S.sources.set(src.id, src);
                resolve(src);
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

function releaseSource(src) {
    if (src.stream) src.stream.getTracks().forEach((t) => t.stop());
    if (src.video) { src.video.srcObject = null; src.video.remove(); }
    removeAudioChannel(`screen:${src.id}`);
}

function removeSource(id) {
    const src = S.sources.get(id);
    if (!src) return;
    S.scenes.forEach((sc) => { sc.items = sc.items.filter((it) => it.src !== id); });
    releaseSource(src);
    S.sources.delete(id);
    if (S.selected && !activeScene().items.some((it) => it.id === S.selected)) S.selected = null;
    notifyStudio();
}

function dropIfUnused(srcId) {
    if (!S.scenes.some((sc) => sc.items.some((it) => it.src === srcId))) removeSource(srcId);
}

function addItem(src, preset) {
    const scene = activeScene();
    const it = { id: sid(), src: src.id, visible: true, x: 0, y: 0, scale: 1 };
    const hasVideo = scene.items.some((i) => { const t = S.sources.get(i.src); return t && (t.type === 'camera' || t.type === 'screen'); });
    const choice = preset || (src.type === 'text' ? 'lower' : src.type === 'camera' && hasVideo ? 'br' : 'fit');
    applyPreset(it, srcAspect(src), choice);
    scene.items.push(it);
    S.selected = it.id;
    notifyStudio();
    return it;
}

function removeItem(itemId) {
    const scene = activeScene();
    const it = scene.items.find((i) => i.id === itemId);
    if (!it) return;
    scene.items = scene.items.filter((i) => i.id !== itemId);
    if (S.selected === itemId) S.selected = null;
    dropIfUnused(it.src);
    notifyStudio();
}

function moveItem(itemId, dir) {
    const list = activeScene().items;
    const i = list.findIndex((it) => it.id === itemId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    notifyStudio();
}

/* ---------- Audio mixer ---------- */
function ensureAudio() {
    if (S.audio) return S.audio;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = ctx.createMediaStreamDestination();
    const master = ctx.createGain();
    master.connect(dest);
    S.audio = { ctx, dest, master, channels: new Map() };
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return S.audio;
}

const applyGain = (ch) => { ch.gain.gain.value = ch.muted ? 0 : ch.volume; };

function addAudioChannel(id, label, track, volume = 1) {
    const a = ensureAudio();
    removeAudioChannel(id);
    const src = a.ctx.createMediaStreamSource(new MediaStream([track]));
    const gain = a.ctx.createGain();
    const analyser = a.ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(gain);
    gain.connect(analyser);
    gain.connect(a.master);
    const ch = { id, label, src, gain, analyser, track, volume, muted: false };
    applyGain(ch);
    a.channels.set(id, ch);
    notifyStudio();
    return ch;
}

function removeAudioChannel(id) {
    if (!S || !S.audio) return;
    const ch = S.audio.channels.get(id);
    if (!ch) return;
    try { ch.src.disconnect(); ch.gain.disconnect(); } catch { /* already disconnected */ }
    if (id === 'mic') ch.track.stop();
    S.audio.channels.delete(id);
    notifyStudio();
}

async function enableMic() {
    requireMedia();
    const audio = { echoCancellation: !!S.cfg.ec, noiseSuppression: !!S.cfg.ns, autoGainControl: !!S.cfg.agc };
    if (S.cfg.audioDeviceId) audio.deviceId = { exact: S.cfg.audioDeviceId };
    const stream = await gum({ audio });
    addAudioChannel('mic', 'Mic/Aux', stream.getAudioTracks()[0], Number(S.cfg.micVolume) || 1);
}

const micChannel = () => (S && S.audio ? S.audio.channels.get('mic') : null);

/* ---------- Program output ---------- */
function getOutStream() {
    if (S.outStream && S.outStream.getVideoTracks()[0].readyState === 'live') return S.outStream;
    const a = ensureAudio();
    const vt = S.canvas.captureStream(Number(S.cfg.fps) || 30).getVideoTracks()[0];
    if ('contentHint' in vt) vt.contentHint = S.cfg.hint === 'auto' ? '' : S.cfg.hint;
    S.outStream = new MediaStream([vt, a.dest.stream.getAudioTracks()[0]]);
    return S.outStream;
}

function setOutputSize(res) {
    const [w, h] = RES[res] || RES[720];
    S.cfg.res = String(res);
    S.canvas.width = w;
    S.canvas.height = h;
    saveCfg();
    notifyStudio();
}

function setFps(fps) {
    S.cfg.fps = String(fps);
    if (S.outStream) { S.outStream.getTracks().forEach((t) => t.stop()); S.outStream = null; }
    startTicker();
    saveCfg();
}

async function listDevices() {
    try {
        const all = await navigator.mediaDevices.enumerateDevices();
        return { cams: all.filter((d) => d.kind === 'videoinput'), mics: all.filter((d) => d.kind === 'audioinput') };
    } catch { return { cams: [], mics: [] }; }
}
