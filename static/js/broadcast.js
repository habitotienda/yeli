'use strict';

/* =========================================================================
   Broadcasting: send the studio's program output to each viewer over WebRTC
   ========================================================================= */
const QUALITY_STEPS = [0, 720, 480, 360, 240]; // 0 = source quality

/**
 * Go live. With a media server (state.config.media.enabled) the studio publishes once with WHIP and the
 * server fans it out; otherwise every viewer connects straight to this browser (peer-to-peer).
 * `external` = the video comes from OBS, this page only registers the channel and keeps it live.
 */
async function startStreaming({ external = false } = {}) {
    const s = S;
    const sfu = !!state.config.media.enabled;
    const title = (s.cfg.title || '').trim();
    const stream = external ? null : getOutStream();
    await api('/stream/start', { method: 'POST', body: { title, category: s.cfg.category, mode: sfu ? 'sfu' : 'p2p' } });
    const b = {
        studio: s, stream, mode: sfu ? 'sfu' : 'p2p', external,
        title: title || `${state.me.username}'s stream`, category: s.cfg.category,
        maxBitrate: Number(s.cfg.bitrate) * 1000, fps: Number(s.cfg.fps), hint: s.cfg.hint,
        outHeight: s.canvas.height,
        peers: new Map(), pendingQuality: new Map(), whip: null, after: 0, viewers: 0, upKbps: 0,
        startedAt: Date.now(), stopped: false, poller: null,
    };
    broadcast = b;
    if (sfu && !external) {
        try {
            await publishWhip(b);
        } catch (e) {
            await stopBroadcast();
            throw e;
        }
    }
    startPolling(b);
    if (!external) startThumbnails(b);
    startStats(b);
    renderAuth();
    notifyStudio();
}

/** Publish the program output to the media server (WHIP). Returns when the server has answered. */
async function publishWhip(b) {
    const info = await api('/stream/key');
    if (!info.enabled) throw new Error('This server has no media server configured.');
    const pc = new RTCPeerConnection({ iceServers: state.config.iceServers, bundlePolicy: 'max-bundle' });
    b.stream.getTracks().forEach((t) => pc.addTrack(t, b.stream));
    await pc.setLocalDescription(await pc.createOffer());
    await iceComplete(pc);
    let res;
    try {
        res = await fetch(info.whip, {
            method: 'POST',
            headers: { 'Content-Type': 'application/sdp', Authorization: `Bearer ${info.key}` },
            body: pc.localDescription.sdp,
        });
    } catch {
        pc.close();
        throw new Error('Can\u2019t reach the media server. Is MediaMTX running?');
    }
    if (res.status === 401 || res.status === 403) { pc.close(); throw new Error('The media server rejected your stream key.'); }
    if (!res.ok) { pc.close(); throw new Error(`The media server answered ${res.status}.`); }
    const loc = res.headers.get('Location');
    b.whip = { pc, resource: loc ? absoluteUrl(loc, info.whip) : null, tries: 0 };
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    tunePeer(pc, b, 0);
    pc.onconnectionstatechange = () => {
        if (b.stopped || b.whip.pc !== pc || pc.connectionState !== 'failed') return;
        const tries = b.whip.tries + 1;
        pc.close();
        if (tries > 3) { toast('Lost the connection to the media server.'); stopBroadcast(); return; }
        toast('Reconnecting to the media server\u2026');
        setTimeout(() => {
            if (b.stopped) return;
            publishWhip(b).then(() => { b.whip.tries = tries; }).catch(() => stopBroadcast());
        }, 1500);
    };
}

/** Send a small snapshot of the program output every 20 s so cards on Home show what is happening. */
function startThumbnails(b) {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 270;
    const ctx = canvas.getContext('2d');
    const snap = async () => {
        const src = b.studio.canvas;
        if (b.stopped || !src.width) return;
        ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
        try {
            await api('/stream/thumbnail', { method: 'POST', body: { image: canvas.toDataURL('image/jpeg', 0.6) } });
        } catch { /* a missed thumbnail is harmless */ }
    };
    const first = setTimeout(snap, 2500);
    const every = setInterval(snap, 20000);
    b.stopThumbnails = () => { clearTimeout(first); clearInterval(every); };
}

/** Measure real upload (all viewers together) like OBS's kb/s indicator. */
function startStats(b) {
    let last = null;
    const id = setInterval(async () => {
        let bytes = 0;
        const pcs = [...b.peers.values()].map((p) => p.pc);
        if (b.whip) pcs.push(b.whip.pc);
        for (const pc of pcs) {
            const p = { pc };
            try {
                const report = await p.pc.getStats();
                report.forEach((r) => { if (r.type === 'outbound-rtp') bytes += r.bytesSent || 0; });
            } catch { /* peer closing */ }
        }
        const t = performance.now();
        if (last) b.upKbps = Math.max(0, Math.round(((bytes - last.bytes) * 8) / (t - last.t)));
        last = { bytes, t };
    }, 2000);
    b.stopStats = () => clearInterval(id);
}

function closePeer(b, id) {
    const p = b.peers.get(id);
    if (!p) return;
    p.pc.onicecandidate = p.pc.onconnectionstatechange = null;
    p.pc.close();
    b.peers.delete(id);
}

/** Apply bitrate / frame rate limits, and the quality the viewer asked for. */
async function tunePeer(pc, b, quality) {
    for (const sender of pc.getSenders()) {
        if (!sender.track) continue;
        try {
            const params = sender.getParameters();
            if (!params.encodings || !params.encodings.length) params.encodings = [{}];
            const enc = params.encodings[0];
            if (sender.track.kind === 'video') {
                const source = b.outHeight;
                const target = quality && quality < source ? quality : source;
                enc.scaleResolutionDownBy = Math.max(1, source / target);
                enc.maxBitrate = Math.max(150000, Math.round(b.maxBitrate * Math.pow(target / source, 1.4)));
                enc.maxFramerate = target <= 360 ? Math.min(b.fps, 30) : b.fps;
                params.degradationPreference = b.hint === 'detail' ? 'maintain-resolution' : 'maintain-framerate';
            } else {
                enc.maxBitrate = 96000;
            }
            await sender.setParameters(params);
        } catch { /* not supported by this browser; defaults apply */ }
    }
}

/** Called when bitrate / optimization change while live. */
function applyLiveSettings() {
    const b = broadcast;
    if (!b) return;
    b.maxBitrate = Number(b.studio.cfg.bitrate) * 1000;
    b.hint = b.studio.cfg.hint;
    const vt = b.stream.getVideoTracks()[0];
    if (vt && 'contentHint' in vt) vt.contentHint = b.hint === 'auto' ? '' : b.hint;
    b.peers.forEach((p) => tunePeer(p.pc, b, p.quality));
    if (b.whip) tunePeer(b.whip.pc, b, 0);
}

async function onViewerSignal(b, s) {
    const id = s.from;
    const send = (kind, payload) => api('/stream/signal', { method: 'POST', body: { peer: id, kind, payload } }).catch(() => {});

    if (s.kind === 'join') {
        closePeer(b, id);
        const pc = new RTCPeerConnection({ iceServers: state.config.iceServers });
        const quality = b.pendingQuality.get(id) || 0;
        b.pendingQuality.delete(id);
        b.peers.set(id, { pc, pending: [], quality });
        b.stream.getTracks().forEach((t) => pc.addTrack(t, b.stream));
        pc.onicecandidate = (e) => { if (e.candidate) send('candidate', e.candidate.toJSON()); };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closePeer(b, id);
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await send('offer', { type: pc.localDescription.type, sdp: pc.localDescription.sdp });
        tunePeer(pc, b, quality);
    } else if (s.kind === 'answer') {
        const p = b.peers.get(id);
        if (!p) return;
        await p.pc.setRemoteDescription(s.payload);
        for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
    } else if (s.kind === 'candidate') {
        const p = b.peers.get(id);
        if (!p) return;
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(s.payload).catch(() => {});
        else p.pending.push(s.payload);
    } else if (s.kind === 'quality') {
        const height = Number(s.payload && s.payload.height) || 0;
        const q = QUALITY_STEPS.includes(height) ? height : 0;
        const p = b.peers.get(id);
        if (p) { p.quality = q; tunePeer(p.pc, b, q); }
        else b.pendingQuality.set(id, q);
    } else if (s.kind === 'leave') {
        closePeer(b, id);
        b.pendingQuality.delete(id);
    }
}

/** Poll for new viewers and signaling. Driven by a worker timer so it keeps running while this tab is in the background. */
function startPolling(b) {
    let busy = false;
    const run = async () => {
        if (busy || b.stopped) return;
        busy = true;
        try {
            const r = await api(`/stream/poll?after=${b.after}`);
            if (b.stopped) return;
            if (!r.live) { stopBroadcast(true); return; }
            b.viewers = r.viewers;
            for (const s of r.signals) {
                b.after = Math.max(b.after, s.id);
                await onViewerSignal(b, s).catch((e) => console.warn('signal error', e));
            }
        } catch (e) {
            if (e.status === 401) stopBroadcast(true);
        } finally {
            busy = false;
        }
    };
    b.poller = workerInterval(run, b.mode === 'sfu' ? 4000 : 700);
    run();
}

async function stopBroadcast(serverAlreadyStopped = false) {
    const b = broadcast;
    if (!b) return;
    b.stopped = true;
    if (b.poller) b.poller.stop();
    if (b.stopThumbnails) b.stopThumbnails();
    if (b.stopStats) b.stopStats();
    b.peers.forEach((_, id) => closePeer(b, id));
    if (b.whip) {
        if (b.whip.resource) fetch(b.whip.resource, { method: 'DELETE', keepalive: true }).catch(() => {});
        b.whip.pc.onconnectionstatechange = null;
        b.whip.pc.close();
    }
    broadcast = null;
    renderAuth();
    // Sources stay open while the studio page is showing (like OBS after "Stop Streaming").
    if (S && !studioRoot) closeSession(); else notifyStudio();
    if (!serverAlreadyStopped) await api('/stream/stop', { method: 'POST' }).catch(() => {});
}
