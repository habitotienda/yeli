'use strict';

/* =========================================================================
   Stream alerts, edited inside the studio like any other source.
   An "Alerts" source draws the current alert (image + text) on the stream, and its sound is mixed into the
   stream's audio. Donations and follows arrive as events; rules decide how each one looks and sounds.
   ========================================================================= */
const ALERT_W = 720;
const ALERT_H = 200;
const ALERT_SOUNDS = [['ding', 'Ding'], ['chime', 'Chime'], ['coin', 'Coin'], ['fanfare', 'Fanfare'], ['laser', 'Laser'], ['bell', 'Bell']];

function addAlertsSource() {
    const existing = [...S.sources.values()].find((x) => x.type === 'alerts');
    if (existing) return existing;
    const canvas = document.createElement('canvas');
    canvas.width = ALERT_W;
    canvas.height = ALERT_H;
    const src = { id: sid(), type: 'alerts', name: uniqueName('Alerts'), canvas };
    S.sources.set(src.id, src);
    startAlertsFeed();
    return src;
}

function startAlertsFeed() {
    if (S.alerts) return;
    const a = { rules: [], last: null, queue: [], current: null, timer: null, imgs: new Map(), buffers: new Map() };
    S.alerts = a;
    loadAlertRules();
    api('/alerts/events').then((r) => {
        a.last = r.last; // only what happens from now on
        if (S && S.alerts === a) a.timer = workerInterval(pollAlertEvents, 2000);
    }).catch(() => {});
}

async function loadAlertRules() {
    if (!S || !S.alerts) return;
    try { S.alerts.rules = (await api('/alerts')).rules; } catch { /* keep the old rules */ }
}

async function pollAlertEvents() {
    const a = S && S.alerts;
    if (!a || a.last === null) return;
    try {
        const r = await api(`/alerts/events?after=${a.last}`);
        a.last = r.last;
        r.events.forEach((e) => a.queue.push({ event: e }));
    } catch { /* try again on the next tick */ }
}

function pickRule(a, e) {
    return a.rules
        .filter((r) => r.enabled && r.event === e.kind && (e.kind !== 'donation' || e.amount >= r.min_amount))
        .sort((x, y) => y.min_amount - x.min_amount)[0] || null;
}

function alertImage(a, ref) {
    if (!ref) return null;
    if (!a.imgs.has(ref)) {
        const img = new Image();
        img.src = ref.startsWith('sticker:') ? stickerSrc(ref.slice(8)) : `/api/asset/${ref.slice(6)}`;
        a.imgs.set(ref, img);
    }
    const img = a.imgs.get(ref);
    return img.complete && img.naturalWidth ? img : null;
}

const alertText = (tpl, e, fallback) => (tpl || fallback).replace(/\{user\}/g, e.username).replace(/\{amount\}/g, Number(e.amount).toLocaleString()).replace(/\{message\}/g, e.message || '');

/** Called on every frame: starts the next queued alert and draws the current one. */
function tickAlerts(s) {
    const a = s.alerts;
    if (!a) return;
    const src = [...s.sources.values()].find((x) => x.type === 'alerts');
    if (!src) { a.queue.length = 0; a.current = null; return; }
    const now = performance.now();
    if (!a.current && a.queue.length) {
        const item = a.queue.shift();
        const rule = item.rule || pickRule(a, item.event);
        if (rule) {
            a.current = { event: item.event, rule, start: now };
            alertImage(a, rule.image); // start loading it
            playAlertSound(rule.sound, rule.volume);
        }
    }
    const ctx = src.canvas.getContext('2d');
    ctx.clearRect(0, 0, ALERT_W, ALERT_H);
    const cur = a.current;
    if (!cur) return;
    const t = (now - cur.start) / 1000;
    if (t >= cur.rule.seconds) { a.current = null; return; }
    drawAlertCard(ctx, a, cur, t);
}

function drawAlertCard(ctx, a, cur, t) {
    const fade = 0.35;
    const alpha = Math.max(0, Math.min(1, t / fade, (cur.rule.seconds - t) / fade));
    const dy = (1 - Math.min(1, t / fade)) * -28;
    const { event: e, rule } = cur;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(0, dy);
    ctx.fillStyle = 'rgba(18, 18, 24, 0.92)';
    ctx.fillRect(0, 10, ALERT_W, ALERT_H - 20);
    ctx.fillStyle = '#ffa600';
    ctx.fillRect(0, 10, 8, ALERT_H - 20);
    const img = alertImage(a, rule.image);
    let textX = 36;
    if (img) {
        const size = ALERT_H - 52;
        const k = Math.min(size / img.naturalWidth, size / img.naturalHeight);
        ctx.drawImage(img, 28 + (size - img.naturalWidth * k) / 2, 26 + (size - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
        textX = 28 + size + 24;
    }
    const fallback = e.kind === 'follow' ? '{user} just followed!' : '{user} sent {amount} Yelis!';
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.font = '800 38px Fredoka, "Segoe UI", sans-serif';
    const title = alertText(rule.title, e, fallback);
    const maxW = ALERT_W - textX - 20;
    // keep the title on up to two lines
    const words = title.split(' ');
    const lines = [''];
    for (const w of words) {
        const trial = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${w}` : w;
        if (ctx.measureText(trial).width > maxW && lines[lines.length - 1] && lines.length < 2) lines.push(w); else lines[lines.length - 1] = trial;
    }
    const msg = e.kind === 'donation' && e.message ? e.message : '';
    const total = lines.length * 44 + (msg ? 36 : 0);
    let y = ALERT_H / 2 - total / 2 + 22;
    lines.forEach((l, i) => ctx.fillText(l, textX, y + i * 44, maxW));
    if (msg) {
        ctx.font = '500 26px Fredoka, "Segoe UI", sans-serif';
        ctx.fillStyle = '#c9c9d2';
        ctx.fillText(msg, textX, y + lines.length * 44 + 8, maxW);
    }
    ctx.restore();
}

/* ---------- Sounds: built-in ones are synthesized (no files), or an uploaded clip ---------- */
function synthSound(name, ctx, out) {
    const t0 = ctx.currentTime;
    const tone = (freq, at, dur, type, vol) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
        o.connect(g).connect(out);
        o.start(t0 + at);
        o.stop(t0 + at + dur + 0.05);
    };
    if (name === 'ding') tone(880, 0, 0.9, 'sine', 0.8);
    else if (name === 'chime') [523, 659, 784].forEach((f, i) => tone(f, i * 0.15, 0.7, 'sine', 0.6));
    else if (name === 'coin') { tone(988, 0, 0.09, 'square', 0.22); tone(1319, 0.09, 0.5, 'square', 0.22); }
    else if (name === 'fanfare') [392, 523, 659, 784].forEach((f, i) => tone(f, i * 0.14, i === 3 ? 0.8 : 0.22, 'triangle', 0.6));
    else if (name === 'laser') {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(1500, t0);
        o.frequency.exponentialRampToValueAtTime(200, t0 + 0.35);
        g.gain.setValueAtTime(0.4, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
        o.connect(g).connect(out);
        o.start(t0);
        o.stop(t0 + 0.45);
    } else if (name === 'bell') { tone(660, 0, 1.4, 'sine', 0.6); tone(1584, 0, 1.0, 'sine', 0.25); tone(2508, 0, 0.7, 'sine', 0.15); }
}

async function playAlertSound(ref, volume) {
    if (!ref || !S) return;
    const a = ensureAudio();
    const ctx = a.ctx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, Number(volume) / 100));
    gain.connect(a.master);                // into the stream
    const monitor = ctx.createGain();      // and quietly to the streamer's speakers
    monitor.gain.value = 0.5;
    gain.connect(monitor).connect(ctx.destination);
    if (ref.startsWith('preset:')) { synthSound(ref.slice(7), ctx, gain); return; }
    try {
        const id = ref.slice(6);
        if (!S.alerts.buffers.has(id)) {
            const raw = await (await fetch(`/api/asset/${id}`)).arrayBuffer();
            S.alerts.buffers.set(id, await ctx.decodeAudioData(raw));
        }
        const src = ctx.createBufferSource();
        src.buffer = S.alerts.buffers.get(id);
        src.connect(gain);
        src.start();
    } catch { toast('That sound file couldn\u2019t be played.'); }
}

/* ---------- Editor ---------- */
function activeSceneHasAlerts() {
    return activeScene().items.some((it) => { const x = S.sources.get(it.src); return x && x.type === 'alerts'; });
}

function testAlert(rule) {
    if (!S.alerts) startAlertsFeed();
    if (!activeSceneHasAlerts()) toast('Add the Alerts source to this scene to see it. You\u2019ll still hear the sound.');
    const e = { kind: rule.event, username: state.me.username, amount: rule.event === 'donation' ? Math.max(Number(rule.min_amount) || 0, 100) : 0, message: rule.event === 'donation' ? 'Great stream!' : '' };
    S.alerts.queue.push({ event: e, rule });
    if (!S.sources.size || ![...S.sources.values()].some((x) => x.type === 'alerts')) playAlertSound(rule.sound, rule.volume);
}

async function imageFileToDataUrl(file) {
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) throw new Error('Use a PNG, JPG, GIF or WebP image.');
    const asIs = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
    if (file.size <= 50 * 1024 || file.type === 'image/gif') {
        if (file.size > 55 * 1024) throw new Error('That GIF is too big (limit 60 KB).');
        return asIs;
    }
    const bmp = await createImageBitmap(file);
    for (const side of [256, 192, 128]) {
        const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(bmp.width * k));
        c.height = Math.max(1, Math.round(bmp.height * k));
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        for (const type of ['image/webp', 'image/png']) {
            const url = c.toDataURL(type, 0.85);
            if (url.startsWith(`data:${type}`) && url.length * 0.75 < 58 * 1024) return url;
        }
    }
    throw new Error('Couldn\u2019t shrink that image enough.');
}

const soundFileToDataUrl = (file) => new Promise((resolve, reject) => {
    if (!/^audio\/(mpeg|ogg|wav|x-wav)$/.test(file.type)) return reject(new Error('Use an MP3, OGG or WAV sound.'));
    if (file.size > 85 * 1024) return reject(new Error('Sounds must be under 85 KB (about 5 seconds as an MP3).'));
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace('data:audio/x-wav', 'data:audio/wav'));
    r.onerror = () => reject(new Error('Couldn\u2019t read that file.'));
    r.readAsDataURL(file);
});

async function openAlertsEditor() {
    const info = await api('/alerts');
    let { rules, assets } = info;
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog obs-dialog alerts-dialog';
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => { dlg.remove(); loadAlertRules(); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });

    const imgOptions = (sel) => `<option value="">No image</option>
        <optgroup label="Stickers">${STICKER_DEFS.map((s) => `<option value="sticker:${s.id}"${sel === `sticker:${s.id}` ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</optgroup>
        ${assets.filter((a) => a.kind === 'image').length ? `<optgroup label="My images">${assets.filter((a) => a.kind === 'image').map((a, i) => `<option value="asset:${a.id}"${sel === `asset:${a.id}` ? ' selected' : ''}>My image ${i + 1}</option>`).join('')}</optgroup>` : ''}`;
    const sndOptions = (sel) => `<option value="">No sound</option>
        <optgroup label="Built in">${ALERT_SOUNDS.map(([k, l]) => `<option value="preset:${k}"${sel === `preset:${k}` ? ' selected' : ''}>${l}</option>`).join('')}</optgroup>
        ${assets.filter((a) => a.kind === 'sound').length ? `<optgroup label="My sounds">${assets.filter((a) => a.kind === 'sound').map((a, i) => `<option value="asset:${a.id}"${sel === `asset:${a.id}` ? ' selected' : ''}>My sound ${i + 1}</option>`).join('')}</optgroup>` : ''}`;

    const card = (r, i) => `
        <form class="alert-card" data-i="${i}" novalidate>
            <div class="field-row">
                <div class="field"><label>When</label><select name="event"><option value="donation"${r.event === 'donation' ? ' selected' : ''}>Someone sends Yelis</option><option value="follow"${r.event === 'follow' ? ' selected' : ''}>Someone follows</option></select></div>
                <div class="field"${r.event === 'follow' ? ' hidden' : ''} data-for="donation"><label>From (Yelis)</label><input name="min_amount" type="number" min="0" max="100000" value="${r.min_amount}"></div>
            </div>
            <div class="field"><label>Text</label><input name="title" maxlength="80" value="${esc(r.title)}" placeholder="${r.event === 'follow' ? '{user} just followed!' : '{user} sent {amount} Yelis!'}"><small>Use <code>{user}</code>, <code>{amount}</code> and <code>{message}</code>.</small></div>
            <div class="field-row">
                <div class="field"><label>Image</label><div class="copy-row"><select name="image">${imgOptions(r.image)}</select><button type="button" class="obs-btn" data-upload="image">Upload</button></div></div>
                <div class="field"><label>Sound</label><div class="copy-row"><select name="sound">${sndOptions(r.sound)}</select><button type="button" class="obs-btn" data-upload="sound">Upload</button></div></div>
            </div>
            <div class="field-row">
                <div class="field"><label>Shown for <output>${r.seconds}s</output></label><input name="seconds" type="range" min="2" max="10" value="${r.seconds}"></div>
                <div class="field"><label>Volume <output>${r.volume}%</output></label><input name="volume" type="range" min="0" max="100" value="${r.volume}"></div>
            </div>
            <p class="form-error" role="alert" hidden></p>
            <div class="row"><button type="submit" class="btn btn-primary">Save</button><button type="button" class="obs-btn" data-test>Test</button><button type="button" class="obs-btn" data-del>Delete</button></div>
        </form>`;

    function paint() {
        dlg.innerHTML = `<div class="dialog-body">
            <button type="button" class="dialog-close" data-close aria-label="Close">&times;</button>
            <h2>Alerts</h2>
            <p class="muted">Pick what each alert shows and plays. They appear on your stream through the <strong>Alerts</strong> source, and the sound goes out with your audio.${activeSceneHasAlerts() ? '' : ' <em>Add the Alerts source to this scene to see them.</em>'}</p>
            <div class="alert-list">${rules.length ? rules.map(card).join('') : '<p class="muted">No alerts yet.</p>'}</div>
            <button type="button" class="btn btn-secondary btn-block" data-add>Add an alert</button>
            <input type="file" id="alFile" hidden>
        </div>`;
    }
    paint();
    dlg.showModal();

    const read = (form) => {
        const f = form.elements;
        const r = rules[Number(form.dataset.i)];
        return { id: r.id, event: f.event.value, min_amount: Number(f.min_amount ? f.min_amount.value : 0) || 0, title: f.title.value, image: f.image.value, sound: f.sound.value,
            seconds: Number(f.seconds.value), volume: Number(f.volume.value), enabled: true };
    };
    dlg.addEventListener('input', (e) => {
        const out = e.target.closest('.field') && e.target.closest('.field').querySelector('output');
        if (out && e.target.type === 'range') out.textContent = e.target.value + (e.target.name === 'volume' ? '%' : 's');
    });
    dlg.addEventListener('change', (e) => {
        if (e.target.name === 'event') {
            const form = e.target.closest('form');
            form.querySelector('[data-for="donation"]').hidden = e.target.value === 'follow';
            form.elements.title.placeholder = e.target.value === 'follow' ? '{user} just followed!' : '{user} sent {amount} Yelis!';
        } else if (e.target.name === 'sound' && e.target.value) playAlertSound(e.target.value, 60);
    });
    dlg.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const err = form.querySelector('.form-error');
        err.hidden = true;
        try {
            const r = await api('/alerts/rules', { method: 'POST', body: read(form) });
            rules = r.rules;
            toast('Alert saved.');
            paint();
        } catch (e2) { err.textContent = e2.message; err.hidden = false; }
    });
    dlg.addEventListener('click', async (e) => {
        const form = e.target.closest('form');
        if (e.target.closest('[data-add]')) {
            rules = [...rules, { id: undefined, event: 'donation', min_amount: 0, title: '', image: 'sticker:star', sound: 'preset:ding', seconds: 5, volume: 80, enabled: true }];
            paint();
        } else if (e.target.closest('[data-test]')) testAlert(read(form));
        else if (e.target.closest('[data-del]')) {
            const r = rules[Number(form.dataset.i)];
            if (r.id) rules = (await api('/alerts/rules/delete', { method: 'POST', body: { id: r.id } })).rules; else rules = rules.filter((x) => x !== r);
            paint();
        } else if (e.target.closest('[data-upload]')) {
            const kind = e.target.closest('[data-upload]').dataset.upload;
            const input = $('#alFile', dlg);
            input.accept = kind === 'image' ? 'image/png,image/jpeg,image/gif,image/webp' : 'audio/mpeg,audio/ogg,audio/wav';
            input.onchange = async () => {
                const file = input.files[0];
                input.value = '';
                if (!file) return;
                try {
                    const data = kind === 'image' ? await imageFileToDataUrl(file) : await soundFileToDataUrl(file);
                    const up = await api('/alerts/assets', { method: 'POST', body: { kind, data } });
                    assets = [...assets, { id: up.id, kind, mime: up.mime }];
                    const draft = read(form);
                    draft[kind === 'image' ? 'image' : 'sound'] = `asset:${up.id}`;
                    rules[Number(form.dataset.i)] = { ...rules[Number(form.dataset.i)], ...draft };
                    paint();
                    toast('File added. Press Save to keep this alert.');
                } catch (e2) { toast(e2.message); }
            };
            input.click();
        }
    });
}
