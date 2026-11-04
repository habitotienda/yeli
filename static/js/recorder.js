'use strict';

/* =========================================================================
   Recorder: records the camera + microphone (phones and computers) or the screen (computers only)
   and keeps the video on the device. Nothing is uploaded.

   Phone browsers (iPhone Safari, Chrome and Firefox for Android) cannot capture their own screen, so
   on a phone this records the camera; the page points to the phone's built-in screen recorder instead.
   ========================================================================= */
const REC_CAN_SCREEN = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');
const REC_MIME = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const REC_SIZES = { 480: [854, 480, 1500000], 720: [1280, 720, 3500000], 1080: [1920, 1080, 6000000] };

function recPickType() {
    if (!window.MediaRecorder) return null;
    return REC_MIME.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

const recFmtTime = (ms) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
};
const recFmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

async function pageRecorder(root, alive) {
    document.title = 'Recorder | Yeli';
    const type = recPickType();
    const secure = window.isSecureContext && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
    const cfg = { mode: 'camera', facing: 'user', mic: true, size: '720' };

    let stream = null, recorder = null, chunks = [], bytes = 0, startedAt = 0, pausedAt = 0, pausedTotal = 0;
    let timer = null, wakeLock = null, audioCtx = null, resultUrl = null, resultFile = null, busy = false;

    root.innerHTML = `
    <div class="rec">
        <div class="page-head"><h1 class="page-title">Recorder</h1>
            <p class="page-sub">Record a video and keep it on your device. Nothing is uploaded.</p></div>
        ${secure && type !== null ? '' : `<div class="notice-test"><strong>${secure ? 'This browser can\u2019t record video.' : 'Recording needs a secure connection. Open the site over HTTPS or on localhost.'}</strong></div>`}

        <section class="panel rec-panel" id="recSetup">
            <div class="rec-opts">
                <div class="field"><span class="rec-label" id="recWhat">What to record</span>
                    <div class="seg" role="radiogroup" aria-labelledby="recWhat">
                        <label><input type="radio" name="recMode" value="camera" checked><span>Camera</span></label>
                        <label${REC_CAN_SCREEN ? '' : ' class="is-off"'}><input type="radio" name="recMode" value="screen"${REC_CAN_SCREEN ? '' : ' disabled'}><span>Screen</span></label>
                    </div></div>
                <div class="field" id="recFacingField"><span class="rec-label" id="recFace">Camera</span>
                    <div class="seg" role="radiogroup" aria-labelledby="recFace">
                        <label><input type="radio" name="recFacing" value="user" checked><span>Front camera</span></label>
                        <label><input type="radio" name="recFacing" value="environment"><span>Back camera</span></label>
                    </div></div>
                <div class="field"><label for="recSize">Quality</label>
                    <select id="recSize"><option value="480">Standard (480p)</option><option value="720" selected>HD (720p)</option><option value="1080">Full HD (1080p)</option></select></div>
                <label class="check"><input type="checkbox" id="recMic" checked><span><strong>Microphone</strong></span></label>
            </div>
            ${REC_CAN_SCREEN ? '' : '<p class="screen-note rec-note">Your phone\u2019s browser can\u2019t capture its screen. To record the screen, use your phone\u2019s own recorder: Control Center on iPhone, or Quick Settings on Android.</p>'}
        </section>

        <section class="rec-stage" id="recStage" hidden>
            <video id="recVideo" playsinline muted autoplay></video>
            <div class="rec-hud" id="recHud" hidden><i aria-hidden="true"></i><span id="recTime">0:00</span><span class="rec-size" id="recBytes"></span></div>
        </section>

        <div class="rec-controls" id="recControls">
            <button type="button" class="btn btn-rec" id="recStart" ${secure && type !== null ? '' : 'disabled'}>Start recording</button>
            <button type="button" class="btn btn-secondary" id="recPause" hidden>Pause</button>
            <button type="button" class="btn btn-primary" id="recStop" hidden>Stop</button>
            <button type="button" class="btn btn-secondary" id="recCancel" hidden>Cancel</button>
        </div>
        <p class="screen-note rec-note" id="recKeep" hidden>Keep this screen open while you record: if the app goes to the background, the video can freeze.</p>
        <p class="form-error" id="recError" role="alert" hidden></p>

        <section class="panel rec-result" id="recResult" hidden>
            <h2 class="section-title">Your video</h2>
            <video id="recPlay" controls playsinline></video>
            <p class="rec-meta" id="recMeta"></p>
            <div class="rec-controls">
                <a class="btn btn-primary" id="recSave" download>Save video</a>
                <button type="button" class="btn btn-secondary" id="recShare" hidden>Share</button>
                <button type="button" class="btn btn-secondary" id="recAgain">Record again</button>
                <button type="button" class="btn btn-secondary" id="recDiscard">Discard</button>
            </div>
        </section>
    </div>`;

    const el = (id) => root.querySelector('#' + id);
    const showError = (msg) => { const e = el('recError'); e.textContent = msg || ''; e.hidden = !msg; };

    function syncOptions() {
        el('recFacingField').hidden = cfg.mode !== 'camera';
    }

    function stopStream() {
        if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
        if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
        const v = el('recVideo');
        if (v) v.srcObject = null;
    }

    async function lockScreenOn() {
        try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* optional */ }
    }
    const lockScreenOff = () => { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } };

    async function openSource() {
        stopStream();
        const [w, h, bps] = REC_SIZES[cfg.size];
        let s;
        if (cfg.mode === 'screen') {
            s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30, width: { ideal: w }, height: { ideal: h } }, audio: true });
            if (cfg.mic) {
                // Mix the microphone with the sound of the screen (if it has any) into one audio track.
                try {
                    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
                    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                    const dest = audioCtx.createMediaStreamDestination();
                    audioCtx.createMediaStreamSource(mic).connect(dest);
                    if (s.getAudioTracks().length) audioCtx.createMediaStreamSource(new MediaStream([s.getAudioTracks()[0]])).connect(dest);
                    s = new MediaStream([...s.getVideoTracks(), dest.stream.getAudioTracks()[0]]);
                } catch { /* no microphone: record without it */ }
            }
        } else {
            s = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: cfg.facing, width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 30 } },
                audio: cfg.mic ? { echoCancellation: true, noiseSuppression: true } : false,
            });
        }
        stream = s;
        const v = el('recVideo');
        v.srcObject = s;
        v.classList.toggle('is-mirror', cfg.mode === 'camera' && cfg.facing === 'user');
        el('recStage').hidden = false;
        v.play().catch(() => {});
        s.getVideoTracks()[0].addEventListener('ended', () => { if (recorder && recorder.state !== 'inactive') { showError('Recording stopped because sharing ended.'); finish(); } });
        return bps;
    }

    function tick() {
        if (!recorder) return;
        const now = recorder.state === 'paused' ? pausedAt : Date.now();
        el('recTime').textContent = recFmtTime(now - startedAt - pausedTotal);
        el('recBytes').textContent = recFmtSize(bytes);
    }

    function setRecordingUi(on) {
        el('recStart').hidden = on;
        el('recSetup').hidden = on;
        el('recStop').hidden = !on;
        el('recPause').hidden = !on;
        el('recCancel').hidden = !on;
        el('recHud').hidden = !on;
        el('recKeep').hidden = !on;
        el('recHud').classList.toggle('is-paused', false);
    }

    async function start() {
        if (busy) return;
        busy = true; showError('');
        el('recResult').hidden = true; clearResult();
        try {
            const bps = await openSource();
            chunks = []; bytes = 0; pausedTotal = 0;
            const opts = { videoBitsPerSecond: bps };
            if (type) opts.mimeType = type;
            recorder = new MediaRecorder(stream, opts);
            recorder.ondataavailable = (e) => { if (e.data && e.data.size) { chunks.push(e.data); bytes += e.data.size; } };
            recorder.onerror = () => { showError('Something went wrong while recording.'); finish(); };
            recorder.onstop = onStopped;
            recorder.start(1000);
            startedAt = Date.now();
            timer = setInterval(tick, 500);
            setRecordingUi(true);
            tick();
            lockScreenOn();
        } catch (e) {
            stopStream();
            el('recStage').hidden = true;
            showError(e && e.name === 'NotAllowedError' ? 'Permission was denied. Allow camera, microphone or screen access in your browser and try again.' : (e && e.name === 'NotFoundError' ? 'No camera or microphone was found.' : (e && e.message) || 'Couldn\u2019t start recording.'));
        } finally { busy = false; }
    }

    function finish() {
        if (recorder && recorder.state !== 'inactive') recorder.stop();
        else onStopped();
    }

    function onStopped() {
        clearInterval(timer); timer = null;
        lockScreenOff();
        const rec = recorder; recorder = null;
        stopStream();
        el('recStage').hidden = true;
        setRecordingUi(false);
        el('recStart').hidden = false; el('recSetup').hidden = false;
        if (!chunks.length) return;
        const mime = (rec && rec.mimeType) || type || 'video/webm';
        const blob = new Blob(chunks, { type: mime });
        const ext = mime.includes('mp4') ? 'mp4' : 'webm';
        const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
        const name = `yeli-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.${ext}`;
        resultFile = new File([blob], name, { type: mime });
        resultUrl = URL.createObjectURL(blob);
        const play = el('recPlay'); play.src = resultUrl;
        const save = el('recSave'); save.href = resultUrl; save.download = name;
        el('recMeta').textContent = `${name} \u00b7 ${recFmtSize(blob.size)}`;
        el('recShare').hidden = !(navigator.canShare && navigator.canShare({ files: [resultFile] }));
        el('recResult').hidden = false;
        el('recResult').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        chunks = [];
    }

    function clearResult() {
        if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }
        resultFile = null;
        const play = el('recPlay'); if (play) { play.removeAttribute('src'); play.load(); }
    }

    function cancel() {
        chunks = [];
        if (recorder) { recorder.onstop = null; if (recorder.state !== 'inactive') recorder.stop(); recorder = null; }
        clearInterval(timer); timer = null; lockScreenOff(); stopStream();
        el('recStage').hidden = true; setRecordingUi(false); el('recStart').hidden = false; el('recSetup').hidden = false;
    }

    root.addEventListener('change', (e) => {
        const t = e.target;
        if (t.name === 'recMode') { cfg.mode = t.value; syncOptions(); }
        else if (t.name === 'recFacing') cfg.facing = t.value;
        else if (t.id === 'recSize') cfg.size = t.value;
        else if (t.id === 'recMic') cfg.mic = t.checked;
    });
    el('recStart').addEventListener('click', start);
    el('recStop').addEventListener('click', finish);
    el('recCancel').addEventListener('click', cancel);
    el('recPause').addEventListener('click', () => {
        if (!recorder) return;
        const b = el('recPause');
        if (recorder.state === 'recording') { recorder.pause(); pausedAt = Date.now(); b.textContent = 'Resume'; el('recHud').classList.add('is-paused'); }
        else if (recorder.state === 'paused') { recorder.resume(); pausedTotal += Date.now() - pausedAt; b.textContent = 'Pause'; el('recHud').classList.remove('is-paused'); }
        tick();
    });
    el('recShare').addEventListener('click', async () => {
        try { await navigator.share({ files: [resultFile], title: 'Yeli' }); } catch { /* cancelled */ }
    });
    el('recAgain').addEventListener('click', () => { el('recResult').hidden = true; clearResult(); root.querySelector('#recSetup').scrollIntoView({ block: 'nearest' }); });
    el('recDiscard').addEventListener('click', () => { el('recResult').hidden = true; clearResult(); });
    const onVisible = () => { if (document.visibilityState === 'visible' && recorder && recorder.state !== 'inactive') lockScreenOn(); };
    document.addEventListener('visibilitychange', onVisible);

    syncOptions();
    onLeave(() => {
        document.removeEventListener('visibilitychange', onVisible);
        if (recorder) { recorder.onstop = null; try { recorder.stop(); } catch { /* already stopped */ } recorder = null; }
        clearInterval(timer); lockScreenOff(); stopStream(); clearResult();
    });
}
