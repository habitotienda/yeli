'use strict';

/* =========================================================================
   GIF maker (no libraries). The gallery turns a moment of a stream into
     - a picture (JPEG, small enough for the server), and
     - a short looping GIF: this is what the buyer gets and sends in chat.
   Everything runs in the browser: the video is the same one the publish dialog already plays.

   encodeGif(frames, { delay })   frames: [{ width, height, data }] (ImageData-like, all the same size) -> Uint8Array
   captureMoment(video, aspect, t) draws the cropped picture and the GIF frames of that moment
   ========================================================================= */

/** Median-cut palette of up to 256 colours from a list of [r, g, b] samples. */
function gifPalette(samples) {
    const spread = (box) => {                // the widest colour channel of a box, and how wide it is
        const lo = [255, 255, 255], hi = [0, 0, 0];
        for (const p of box) for (let c = 0; c < 3; c++) { if (p[c] < lo[c]) lo[c] = p[c]; if (p[c] > hi[c]) hi[c] = p[c]; }
        const range = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
        const ch = range[0] >= range[1] && range[0] >= range[2] ? 0 : range[1] >= range[2] ? 1 : 2;
        return [range[ch], ch];
    };
    const boxes = [samples];
    while (boxes.length < 256) {
        // split the biggest box that still has different colours in it
        let best = -1, bestN = 1, bestCh = 0;
        boxes.forEach((b, i) => {
            if (b.length <= bestN) return;
            const [r, ch] = spread(b);
            if (r > 0) { best = i; bestN = b.length; bestCh = ch; }
        });
        if (best < 0) break;
        const box = boxes[best];
        box.sort((x, y) => x[bestCh] - y[bestCh]);
        const mid = box.length >> 1;
        boxes.splice(best, 1, box.slice(0, mid), box.slice(mid));
    }
    return boxes.filter((b) => b.length).map((b) => {
        const sum = [0, 0, 0];
        for (const p of b) { sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; }
        return sum.map((v) => Math.round(v / b.length));
    });
}

/** Variable-width LZW as GIF wants it. `indices` are palette indexes; the result is split in sub-blocks of at most 255 bytes. */
function gifLzw(indices, minCode = 8) {
    const clear = 1 << minCode, end = clear + 1;
    const out = [];
    let cur = 0, bits = 0;
    const emit = (code, width) => {
        cur |= code << bits;
        bits += width;
        while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; }
    };
    let width = minCode + 1, next = end + 1;
    let dict = new Map();
    emit(clear, width);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
        const k = indices[i];
        const key = prefix * 256 + k;
        const hit = dict.get(key);
        if (hit !== undefined) { prefix = hit; continue; }
        emit(prefix, width);
        if (next < 4096) {
            dict.set(key, next++);
            if (next > (1 << width) && width < 12) width++;
        } else {                    // the table is full: start over
            emit(clear, width);
            dict = new Map();
            width = minCode + 1;
            next = end + 1;
        }
        prefix = k;
    }
    emit(prefix, width);
    emit(end, width);
    if (bits > 0) out.push(cur & 255);
    const blocks = [];
    for (let i = 0; i < out.length; i += 255) {
        const n = Math.min(255, out.length - i);
        blocks.push(n, ...out.slice(i, i + n));
    }
    blocks.push(0);
    return blocks;
}

function encodeGif(frames, { delay = 10, loop = 0 } = {}) {
    const { width: w, height: h } = frames[0];
    // palette: sample the pixels of every frame (every 3rd one is plenty), ignoring nothing: the pictures are opaque
    const samples = [];
    for (const f of frames) {
        for (let i = 0; i < f.data.length; i += 12) samples.push([f.data[i], f.data[i + 1], f.data[i + 2]]);
    }
    const palette = gifPalette(samples);
    while (palette.length < 256) palette.push([0, 0, 0]);

    // nearest palette colour, remembered per 15-bit colour
    const cache = new Int16Array(32768).fill(-1);
    const nearest = (r, g, b) => {
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        let hit = cache[key];
        if (hit >= 0) return hit;
        let bestD = Infinity;
        const rr = (r & 0xf8) | 4, gg = (g & 0xf8) | 4, bb = (b & 0xf8) | 4;
        for (let i = 0; i < 256; i++) {
            const p = palette[i];
            const d = (p[0] - rr) ** 2 + (p[1] - gg) ** 2 + (p[2] - bb) ** 2;
            if (d < bestD) { bestD = d; hit = i; }
        }
        cache[key] = hit;
        return hit;
    };

    const bytes = [];
    const u16 = (v) => bytes.push(v & 255, (v >> 8) & 255);
    'GIF89a'.split('').forEach((c) => bytes.push(c.charCodeAt(0)));
    u16(w); u16(h);
    bytes.push(0xf7, 0, 0);                                   // global colour table, 256 colours
    for (const p of palette) bytes.push(p[0], p[1], p[2]);
    bytes.push(0x21, 0xff, 11);                               // looping
    'NETSCAPE2.0'.split('').forEach((c) => bytes.push(c.charCodeAt(0)));
    bytes.push(3, 1); u16(loop); bytes.push(0);
    for (const f of frames) {
        bytes.push(0x21, 0xf9, 4, 0x00); u16(delay); bytes.push(0, 0);   // frame delay (1/100 s)
        bytes.push(0x2c); u16(0); u16(0); u16(w); u16(h); bytes.push(0);
        const idx = new Uint8Array(w * h);
        for (let i = 0, j = 0; j < idx.length; i += 4, j++) idx[j] = nearest(f.data[i], f.data[i + 1], f.data[i + 2]);
        bytes.push(8);
        for (const b of gifLzw(idx, 8)) bytes.push(b);
    }
    bytes.push(0x3b);
    return Uint8Array.from(bytes);
}

/* ---------------------------------------------------------------------------
   From a video to a gallery picture
   --------------------------------------------------------------------------- */
const GALLERY_FORMATS = { '1:1': [1, 1], '4:5': [4, 5] };
const GIF_SIZE = { '1:1': [200, 200], '4:5': [160, 200] };
const IMAGE_SIZE = { '1:1': [480, 480], '4:5': [480, 600] };
const IMAGE_MAX_BYTES = 78000;     // the server accepts 80 KB (config.MAX_COVER_BYTES)
const GIF_FRAMES = 10, GIF_STEP = 0.15; // 1.5 seconds of the stream, as a loop
const GIF_MAX_BYTES = 580 * 1024;      // the server accepts 600 KB (config.GALLERY_GIF_MAX)

/** Draw the video into the canvas, cropped from the middle to the shape of `aspect`. */
function drawCropped(ctx, video, aspect, W, H) {
    const [aw, ah] = GALLERY_FORMATS[aspect];
    const r = aw / ah;
    const vw = video.videoWidth, vh = video.videoHeight;
    let sw = vw, sh = vh;
    if (vw / vh > r) sw = vh * r; else sh = vw / r;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, W, H);
}

function seekVideo(video, t) {
    return new Promise((resolve, reject) => {
        const limit = Math.max(0, (Number.isFinite(video.duration) ? video.duration : t) - 0.05);
        const target = Math.min(Math.max(0, t), limit);
        if (Math.abs(video.currentTime - target) < 0.01 && video.readyState >= 2) { resolve(); return; }
        const done = () => { clearTimeout(timer); video.removeEventListener('seeked', done); resolve(); };
        const timer = setTimeout(() => { video.removeEventListener('seeked', done); reject(new Error('The video took too long to move to that moment.')); }, 6000);
        video.addEventListener('seeked', done);
        try { video.currentTime = target; } catch (e) { clearTimeout(timer); video.removeEventListener('seeked', done); reject(e); }
    });
}

/** Just the picture of the current moment, as a JPEG data URL under the server's limit. */
function momentImage(video, aspect) {
    let [W, H] = IMAGE_SIZE[aspect];
    const canvas = document.createElement('canvas');
    for (let shrink = 0; shrink < 4; shrink++) {
        canvas.width = W; canvas.height = H;
        drawCropped(canvas.getContext('2d'), video, aspect, W, H);
        for (const q of [0.85, 0.75, 0.65, 0.55, 0.45, 0.35]) {
            const url = canvas.toDataURL('image/jpeg', q);
            if (url.length * 0.75 < IMAGE_MAX_BYTES) return url;
        }
        W = Math.round(W * 0.8); H = Math.round(H * 0.8);
    }
    throw new Error('Couldn\u2019t shrink that picture enough. Try another moment.');
}

/** The looping GIF that starts at `t`: GIF_FRAMES pictures, GIF_STEP seconds apart (it runs backwards from the end of the video if needed). */
async function momentGif(video, aspect, t, onProgress) {
    const [W, H] = GIF_SIZE[aspect];
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const total = Number.isFinite(video.duration) ? video.duration : t + GIF_FRAMES * GIF_STEP;
    const start = Math.max(0, Math.min(t, total - GIF_FRAMES * GIF_STEP - 0.1));
    const frames = [];
    for (let i = 0; i < GIF_FRAMES; i++) {
        await seekVideo(video, start + i * GIF_STEP);
        drawCropped(ctx, video, aspect, W, H);
        const img = ctx.getImageData(0, 0, W, H);
        frames.push({ width: W, height: H, data: img.data });
        if (onProgress) onProgress((i + 1) / GIF_FRAMES);
    }
    const delay = Math.round(GIF_STEP * 100);
    let gif = encodeGif(frames, { delay });
    // too heavy (a very busy picture): keep every second frame and show each twice as long
    if (gif.length > GIF_MAX_BYTES) gif = encodeGif(frames.filter((_, i) => i % 2 === 0), { delay: delay * 2 });
    if (gif.length > GIF_MAX_BYTES) throw new Error('This moment makes a GIF that is too big. Try a calmer moment.');
    return gif;
}

const gifBlobUrl = (bytes) => URL.createObjectURL(new Blob([bytes], { type: 'image/gif' }));
