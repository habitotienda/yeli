'use strict';

/* =========================================================================
   Media-server mode (MediaMTX): viewers play with WHEP, the streamer publishes with WHIP.
   Nobody encodes video per viewer, so many people can go live and each can have a big audience.
   ========================================================================= */
function iceComplete(pc, ms = 2500) {
    return new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') { resolve(); return; }
        const done = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', on); resolve(); };
        const on = () => { if (pc.iceGatheringState === 'complete') done(); };
        const t = setTimeout(done, ms);
        pc.addEventListener('icegatheringstatechange', on);
    });
}

const absoluteUrl = (loc, base) => { try { return new URL(loc, base).href; } catch { return null; } };

/** Same interface as createWatcher (P2P): status(), ended(), viewers(), superseded(). */
function createSfuWatcher(username, video, cb) {
    const peer = uid(); // presence id: counts the viewer and enforces one tab per account
    const path = `/watch/${encodeURIComponent(username)}`;
    const whep = `${state.config.media.url}/${username.toLowerCase()}/whep`;
    let pc = null;
    let resource = null;
    let stopped = false;
    let retryTimer = null;
    let presenceTimer = null;
    let attempts = 0;

    function closePc() {
        if (resource) { fetch(resource, { method: 'DELETE', keepalive: true }).catch(() => {}); resource = null; }
        if (pc) { pc.onconnectionstatechange = pc.ontrack = null; pc.close(); pc = null; }
    }

    function scheduleRetry() {
        if (stopped) return;
        attempts += 1;
        if (attempts > 8) { cb.status('failed'); return; }
        cb.status('reconnecting');
        retryTimer = setTimeout(connect, Math.min(1500 * attempts, 8000));
    }

    function tryPlay() {
        const p = video.play();
        if (p && p.catch) {
            p.catch(() => {
                video.dataset.noPersist = '1';
                video.muted = true;
                video.play().then(() => cb.status('blocked')).catch(() => {});
            });
        }
    }

    async function connect() {
        if (stopped) return;
        closePc();
        const mine = new RTCPeerConnection({ iceServers: state.config.iceServers, bundlePolicy: 'max-bundle' });
        pc = mine;
        mine.addTransceiver('video', { direction: 'recvonly' });
        mine.addTransceiver('audio', { direction: 'recvonly' });
        mine.ontrack = (e) => {
            if (video.srcObject !== e.streams[0]) video.srcObject = e.streams[0];
            tryPlay();
        };
        mine.onconnectionstatechange = () => {
            if (pc !== mine) return;
            if (mine.connectionState === 'connected') { attempts = 0; cb.status('playing'); }
            else if (mine.connectionState === 'failed') scheduleRetry();
            else if (mine.connectionState === 'disconnected') cb.status('reconnecting');
        };
        try {
            await mine.setLocalDescription(await mine.createOffer());
            await iceComplete(mine);
            if (stopped || pc !== mine) return;
            const res = await fetch(whep, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: mine.localDescription.sdp });
            if (stopped || pc !== mine) return;
            if (res.status === 404) { // the streamer is live on Yeli but the video hasn't arrived yet
                cb.status('connecting');
                mine.close();
                pc = null;
                retryTimer = setTimeout(connect, 2000);
                return;
            }
            if (!res.ok) throw new Error(`media server ${res.status}`);
            resource = res.headers.get('Location') ? absoluteUrl(res.headers.get('Location'), whep) : null;
            await mine.setRemoteDescription({ type: 'answer', sdp: await res.text() });
        } catch (e) {
            console.warn('WHEP error', e);
            if (pc === mine) { mine.close(); pc = null; }
            scheduleRetry();
        }
    }

    async function join() {
        try {
            await api(`${path}/join`, { method: 'POST', body: { peer } });
            return true;
        } catch (e) {
            stopped = true;
            if (e.status === 429) cb.status('full');
            else if (e.status === 404) cb.ended();
            else cb.status('failed');
            return false;
        }
    }

    // Presence only: tells the server this account is still watching (and notices a newer tab or a stream that ended).
    async function presence() {
        if (stopped) return;
        try {
            const r = await api(`${path}/poll?peer=${peer}&after=0`);
            if (stopped) return;
            if (!r.live) { stopped = true; closePc(); cb.ended(); return; }
            if (r.superseded) { stopped = true; closePc(); cb.superseded(); return; }
            if (!r.joined) { if (!(await join())) return; }
            else if (cb.viewers) cb.viewers(r.viewers);
        } catch (e) {
            if (e.status === 404) { stopped = true; closePc(); cb.ended(); return; }
        }
        presenceTimer = setTimeout(presence, 6000);
    }

    cb.status('connecting');
    (async () => {
        if (!(await join())) return;
        connect();
        presenceTimer = setTimeout(presence, 6000);
    })();

    return {
        setQuality() { /* a media server forwards one stream; viewers can't pick a lower one */ },
        stop() {
            if (stopped && !pc && !resource) return;
            stopped = true;
            clearTimeout(retryTimer);
            clearTimeout(presenceTimer);
            closePc();
            api(`${path}/leave`, { method: 'POST', body: { peer }, keepalive: true }).catch(() => {});
        },
    };
}
