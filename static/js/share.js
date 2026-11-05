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
    mail: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="M3.5 7.5l8.5 6 8.5-6"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
};

/* The real brand glyphs (filled, from Simple Icons / Font Awesome Free), each with its own viewBox. */
const SH_BRANDS = {
    whatsapp: ['0 0 24 24', 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52s.198-.298.298-.497c.099-.198.05-.371-.025-.52s-.669-1.612-.916-2.207c-.242-.579-.487-.5-.669-.51a13 13 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074s2.096 3.2 5.077 4.487c.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413s.248-1.289.173-1.413c-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.82 9.82 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.82 11.82 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.9 11.9 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.82 11.82 0 0 0-3.48-8.413'],
    /* only the paper plane of the Telegram logo: the round button is the circle */
    telegram: ['2.6 3.5 17 17', 'M16.906 7.224c.1-.002.321.023.465.14a.5.5 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024q-.159.037-5.061 3.345-.72.495-1.302.48c-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789q.04-.324.893-.663 5.247-2.286 6.998-3.014c3.332-1.386 4.025-1.627 4.476-1.635'],
    x: ['0 0 24 24', 'M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z'],
    facebook: ['0 0 320 512', 'M80 299.3V512h116V299.3h86.5l18-97.8H196v-34.6c0-51.7 20.3-71.5 72.7-71.5 16.3 0 29.4.4 37 1.2V7.9C291.4 4 256.4 0 236.2 0 129.3 0 80 50.5 80 159.4v42.1H14v97.8z'],
};
const SH_BRAND = (key, size) => {
    const [vb, d] = SH_BRANDS[key];
    return `<svg viewBox="${vb}" width="${size}" height="${size}" aria-hidden="true" fill="currentColor" focusable="false"><path d="${d}"/></svg>`;
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
                    <span class="share-app-ico">${SH_BRANDS[key] ? SH_BRAND(key, key === 'facebook' ? 24 : key === 'telegram' ? 28 : 26) : SH_ICON(SH_PATHS[key], 26)}</span><span class="share-app-name" translate="no">${name}</span>
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
