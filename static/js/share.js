'use strict';

/* =========================================================================
   Share dialog: copy the link, send it to WhatsApp / Telegram / X / Facebook / email, the phone's own
   share sheet, and a QR code anyone can scan. The QR code is drawn here (no library, no network):
   a small QR encoder (byte mode, error correction M, versions 1-20) written after the public QR spec.
   ========================================================================= */

/* ---------- QR encoder ---------- */
const QR = (() => {
    const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26];
    const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];
    const MAX_VERSION = 20;

    const bit = (x, i) => ((x >>> i) & 1) !== 0;

    function rawModules(ver) {
        let r = (16 * ver + 128) * ver + 64;
        if (ver >= 2) {
            const n = Math.floor(ver / 7) + 2;
            r -= (25 * n - 10) * n - 55;
            if (ver >= 7) r -= 36;
        }
        return r;
    }
    const dataCodewords = (ver) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];

    function gfMul(x, y) {
        let z = 0;
        for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
        return z & 0xff;
    }
    function rsDivisor(degree) {
        const result = new Array(degree).fill(0);
        result[degree - 1] = 1;
        let root = 1;
        for (let i = 0; i < degree; i++) {
            for (let j = 0; j < result.length; j++) {
                result[j] = gfMul(result[j], root);
                if (j + 1 < result.length) result[j] ^= result[j + 1];
            }
            root = gfMul(root, 2);
        }
        return result;
    }
    function rsRemainder(data, divisor) {
        const result = new Array(divisor.length).fill(0);
        for (const b of data) {
            const factor = b ^ result.shift();
            result.push(0);
            divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
        }
        return result;
    }

    function alignPositions(ver) {
        if (ver === 1) return [];
        const n = Math.floor(ver / 7) + 2;
        const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
        const out = [6];
        for (let pos = ver * 4 + 10; out.length < n; pos -= step) out.splice(1, 0, pos);
        return out;
    }

    function penalty(m, size) {
        let score = 0;
        const lines = [];
        for (let y = 0; y < size; y++) lines.push(m[y].map(Number).join(''));
        for (let x = 0; x < size; x++) lines.push(m.map((row) => Number(row[x])).join(''));
        for (const s of lines) {
            for (const run of s.match(/0+|1+/g)) if (run.length >= 5) score += 3 + run.length - 5;
            const f = s.match(/(?=(10111010000|00001011101))/g);
            if (f) score += 40 * f.length;
        }
        for (let y = 0; y < size - 1; y++) {
            for (let x = 0; x < size - 1; x++) {
                const c = m[y][x];
                if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
            }
        }
        let dark = 0;
        for (const row of m) for (const c of row) if (c) dark++;
        const total = size * size;
        score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
        return score;
    }

    /** Returns { size, modules: boolean[][] } for the text, or null when it doesn't fit. */
    function encode(text) {
        const bytes = Array.from(new TextEncoder().encode(text));
        let ver = 1;
        for (; ver <= MAX_VERSION; ver++) {
            const capBits = dataCodewords(ver) * 8;
            if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= capBits) break;
        }
        if (ver > MAX_VERSION) return null;

        // data bits
        const bits = [];
        const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
        put(0b0100, 4);
        put(bytes.length, ver < 10 ? 8 : 16);
        bytes.forEach((b) => put(b, 8));
        const capBits = dataCodewords(ver) * 8;
        put(0, Math.min(4, capBits - bits.length));
        put(0, (8 - (bits.length % 8)) % 8);
        for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) put(pad, 8);
        const data = [];
        for (let i = 0; i < bits.length; i += 8) {
            let v = 0;
            for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
            data.push(v);
        }

        // error correction + interleave
        const numBlocks = NUM_BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver];
        const raw = Math.floor(rawModules(ver) / 8);
        const shortBlocks = numBlocks - (raw % numBlocks);
        const shortLen = Math.floor(raw / numBlocks);
        const div = rsDivisor(eccLen);
        const blocks = [];
        for (let i = 0, k = 0; i < numBlocks; i++) {
            const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
            k += dat.length;
            const ecc = rsRemainder(dat, div);
            if (i < shortBlocks) dat.push(0);
            blocks.push(dat.concat(ecc));
        }
        const all = [];
        for (let i = 0; i < blocks[0].length; i++) {
            blocks.forEach((blk, j) => { if (i !== shortLen - eccLen || j >= shortBlocks) all.push(blk[i]); });
        }

        // function patterns
        const size = ver * 4 + 17;
        const m = Array.from({ length: size }, () => new Array(size).fill(false));
        const fn = Array.from({ length: size }, () => new Array(size).fill(false));
        const setFn = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };
        for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
        const finder = (cx, cy) => {
            for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
                const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
                if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
            }
        };
        finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
        const pos = alignPositions(ver);
        pos.forEach((cx, i) => pos.forEach((cy, j) => {
            if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) return;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }));
        const drawFormat = (mask) => {
            const d = mask; // error correction level M = 0b00
            let rem = d;
            for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
            const b = ((d << 10) | rem) ^ 0x5412;
            for (let i = 0; i <= 5; i++) setFn(8, i, bit(b, i));
            setFn(8, 7, bit(b, 6)); setFn(8, 8, bit(b, 7)); setFn(7, 8, bit(b, 8));
            for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(b, i));
            for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(b, i));
            for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(b, i));
            setFn(8, size - 8, true);
        };
        drawFormat(0);
        if (ver >= 7) {
            let rem = ver;
            for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
            const b = (ver << 12) | rem;
            for (let i = 0; i < 18; i++) {
                const a = size - 11 + (i % 3), c = Math.floor(i / 3);
                setFn(a, c, bit(b, i)); setFn(c, a, bit(b, i));
            }
        }

        // codewords, zig-zag
        let idx = 0;
        for (let right = size - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5;
            for (let vert = 0; vert < size; vert++) {
                for (let j = 0; j < 2; j++) {
                    const x = right - j;
                    const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
                    if (!fn[y][x] && idx < all.length * 8) { m[y][x] = bit(all[idx >>> 3], 7 - (idx & 7)); idx++; }
                }
            }
        }

        // best mask
        const MASKS = [
            (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
            (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
            (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
        ];
        const applyMask = (k) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[k](x, y)) m[y][x] = !m[y][x]; };
        let best = 0, bestScore = Infinity;
        for (let k = 0; k < 8; k++) {
            applyMask(k); drawFormat(k);
            const s = penalty(m, size);
            if (s < bestScore) { bestScore = s; best = k; }
            applyMask(k); // undo
        }
        applyMask(best); drawFormat(best);
        return { size, modules: m };
    }

    /** SVG markup (black on white, with the 4-module quiet zone every scanner expects). */
    function toSvg(text) {
        const qr = encode(text);
        if (!qr) return '';
        const q = 4, n = qr.size + q * 2;
        let d = '';
        for (let y = 0; y < qr.size; y++) {
            for (let x = 0; x < qr.size; x++) {
                if (!qr.modules[y][x]) continue;
                let w = 1;
                while (x + w < qr.size && qr.modules[y][x + w]) w++;
                d += `M${x + q} ${y + q}h${w}v1h-${w}z`;
                x += w - 1;
            }
        }
        return `<svg viewBox="0 0 ${n} ${n}" role="img" aria-label="QR code" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
    }

    /** PNG blob of the same picture, for the download button. */
    function toPng(text, scale = 10) {
        const qr = encode(text);
        return new Promise((resolve) => {
            if (!qr) { resolve(null); return; }
            const q = 4, n = qr.size + q * 2, c = document.createElement('canvas');
            c.width = c.height = n * scale;
            const g = c.getContext('2d');
            g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
            g.fillStyle = '#000';
            qr.modules.forEach((row, y) => row.forEach((on, x) => { if (on) g.fillRect((x + q) * scale, (y + q) * scale, scale, scale); }));
            c.toBlob(resolve, 'image/png');
        });
    }
    return { encode, toSvg, toPng };
})();

/* ---------- Share dialog ---------- */
const SH_ICON = (inner, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const SH_PATHS = {
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    whatsapp: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.7-.9L3 21l1.9-5.3A8.4 8.4 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z"/><g transform="translate(7.2 6.7) scale(.4)"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" stroke-width="3.4"/></g>',
    telegram: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
    x: '<path d="M4 4l16 16M20 4L4 20"/>',
    facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
    mail: '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M22 6l-10 7L2 6"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
};

/**
 * Open the share dialog for the current page.
 * opts: { title: what the page is called (a channel or video name), text: the message sent with the link }
 */
function openShareDialog({ title, text }) {
    const url = location.href;
    const msg = text || title;
    const enc = encodeURIComponent;
    const apps = [
        ['WhatsApp', 'whatsapp', `https://wa.me/?text=${enc(`${msg} ${url}`)}`],
        ['Telegram', 'telegram', `https://t.me/share/url?url=${enc(url)}&text=${enc(msg)}`],
        ['X', 'x', `https://twitter.com/intent/tweet?text=${enc(msg)}&url=${enc(url)}`],
        ['Facebook', 'facebook', `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`],
        ['Email', 'mail', `mailto:?subject=${enc(msg)}&body=${enc(`${msg}\n${url}`)}`],
    ];
    const qrSvg = QR.toSvg(url);
    const canNative = typeof navigator.share === 'function';
    const dlg = dialogShell('Share', `
        <div class="share-dialog">
            <p class="share-title" translate="no">${esc(title)}</p>
            <div class="copy-row">
                <input type="text" id="shareUrl" readonly value="${esc(url)}" aria-label="Link" translate="no">
                <button type="button" class="btn btn-primary btn-ico" id="shareCopy">${SH_ICON(SH_PATHS.copy, 18)}<span>Copy</span></button>
            </div>
            <div class="share-apps">${apps.map(([name, key, href]) => `
                <a class="share-app share-${key}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">
                    <span class="share-app-ico">${SH_ICON(SH_PATHS[key])}</span><span class="share-app-name" translate="no">${name}</span>
                </a>`).join('')}
                ${canNative ? `<button type="button" class="share-app share-more" id="shareNative"><span class="share-app-ico">${SH_ICON(SH_PATHS.more)}</span><span class="share-app-name">More</span></button>` : ''}
            </div>
            ${qrSvg ? `<div class="share-qr">
                <div class="share-qr-img">${qrSvg}</div>
                <div class="share-qr-info">
                    <strong>QR code</strong>
                    <p class="muted">Scan it with your phone camera to open this page.</p>
                    <button type="button" class="btn btn-secondary btn-ico" id="shareQrDl">${SH_ICON(SH_PATHS.download, 18)}<span>Download QR</span></button>
                </div>
            </div>` : ''}
        </div>`);

    const input = dlg.querySelector('#shareUrl');
    const copyBtn = dlg.querySelector('#shareCopy');
    input.addEventListener('focus', () => input.select());

    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(url);
        } catch {
            input.focus(); input.select();
            toast('Press Ctrl+C (or hold the link) to copy it.');
            return;
        }
        if (copyBtn.classList.contains('is-done')) return;
        const original = copyBtn.innerHTML;
        copyBtn.classList.add('is-done');
        copyBtn.innerHTML = `${SH_ICON(SH_PATHS.check, 18)}<span>Copied</span>`;
        setTimeout(() => { if (copyBtn.isConnected) { copyBtn.classList.remove('is-done'); copyBtn.innerHTML = original; } }, 1800);
    });

    const nativeBtn = dlg.querySelector('#shareNative');
    if (nativeBtn) nativeBtn.addEventListener('click', async () => {
        try { await navigator.share({ title, text: msg, url }); dlg.close(); } catch { /* cancelled */ }
    });

    const dl = dlg.querySelector('#shareQrDl');
    if (dl) dl.addEventListener('click', async () => {
        const blob = await QR.toPng(url);
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'yeli-qr.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
}
