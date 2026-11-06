'use strict';

/* =========================================================================
   Platforms: send the stream to other platforms (Kick, TikTok, Twitch, YouTube...)
   and bring their chats into this one. The bot and its voice work with both.
   ========================================================================= */

const PLATFORM_HELP = {
    kick: 'On Kick, copy the Stream URL and the Stream Key from your creator dashboard.',
    tiktok: 'TikTok gives you a new server address and key each time you go live (LIVE Center, only for accounts with LIVE access). Paste them here before you start streaming.',
    twitch: 'Copy your Stream Key from the Twitch Creator Dashboard (Settings, Stream).',
    youtube: 'In YouTube Studio, choose Go live, then Stream, and copy the Stream key.',
    facebook: 'In Facebook Live Producer, copy the Stream key.',
    custom: 'Any service that gives you an RTMP server address and a stream key.',
};

const PLATFORM_STATUS = { off: 'Off', starting: 'Starting\u2026', live: 'Sending', retrying: 'Retrying\u2026', error: 'Failed' };

const PLATFORM_WHY = {
    media_server: 'This server has no media server, so it can\u2019t send your stream to other platforms. See the README.',
    rtsp: 'This server isn\u2019t set up to send streams out yet: it needs ffmpeg and the YELI_MEDIA_RTSP setting. See the README.',
    ffmpeg: 'This server isn\u2019t set up to send streams out yet: it needs ffmpeg installed. See the README.',
};

async function openPlatforms() {
    const dlg = $('#platformsDialog');
    dlg.innerHTML = `
        <div class="dialog-body">
            <button type="button" class="dialog-close" data-close aria-label="Close">&times;</button>
            <h2>Platforms</h2>
            <p class="muted">Send your stream to other platforms and bring their chats here. The bot and its voice work in both.</p>
            <div id="platBody"><p class="muted">Loading\u2026</p></div>
            <button type="button" class="btn btn-primary btn-block" data-close>Done</button>
        </div>`;
    dlg.showModal();
    const body = $('#platBody', dlg);

    let rs, br;
    let editing = null; // null, 'new', or the id of the destination being edited
    let error = '';
    let draft = null;   // what was typed, kept when saving fails so nothing has to be typed again
    try {
        [rs, br] = await Promise.all([api('/restream'), api('/bridge')]);
    } catch (e) {
        body.innerHTML = `<p class="form-error">${esc(e.message)}</p>`;
        return;
    }

    const summary = () => JSON.stringify([rs.available, rs.live, rs.mode, rs.destinations.map((d) => [d.id, d.status, d.error, d.enabled]), br.twitch.status]);
    let shown = '';

    function sendSection() {
        const notice = !rs.available
            ? `<p class="plat-note">${esc(PLATFORM_WHY[rs.why] || PLATFORM_WHY.media_server)}</p>`
            : (rs.live && rs.mode !== 'sfu' ? '<p class="plat-note">You\u2019re live in peer-to-peer mode. Sending to other platforms needs the media server.</p>' : '');
        const cards = rs.destinations.map((d) => {
            const label = (rs.platforms.find((p) => p.id === d.platform) || {}).label || d.platform;
            return `<div class="plat-card" data-id="${d.id}">
                <div class="plat-head">
                    <span class="plat-tag plat-${esc(d.platform)}">${esc(label)}</span>
                    <strong translate="no">${esc(d.name || label)}</strong>
                    <span class="plat-status s-${esc(d.status)}">${esc(PLATFORM_STATUS[d.status] || d.status)}</span>
                </div>
                <p class="muted plat-url" translate="no">${esc(d.url)} \u00b7 ${esc(d.key_hint)}${d.fmt === 'vertical' ? ' \u00b7 9:16' : ''}</p>
                ${d.error && d.status !== 'off' ? `<p class="plat-error" translate="no">${esc(d.error)}</p>` : ''}
                <div class="plat-actions">
                    <label class="plat-on"><input type="checkbox" data-plat-toggle="${d.id}"${d.enabled ? ' checked' : ''}><span>On</span></label>
                    <button type="button" class="obs-btn" data-plat-edit="${d.id}">Edit</button>
                    <button type="button" class="obs-btn" data-plat-del="${d.id}">Delete</button>
                </div>
            </div>`;
        }).join('');
        const add = editing === null && rs.destinations.length < rs.max
            ? '<button type="button" class="obs-btn" data-plat-add>Add a platform</button>' : '';
        return `<fieldset class="panel-section"><legend>Send your stream to</legend>
            ${notice}
            ${cards || '<p class="muted">No platforms yet.</p>'}
            ${editing !== null ? formHtml() : add}
            <small class="hint">What you see in the studio goes out as it is: the chat, the alerts, the bot\u2019s messages and the bot\u2019s voice. Starts when you go live and stops when you stop.</small>
        </fieldset>`;
    }

    function formHtml() {
        const cur = editing === 'new' ? null : rs.destinations.find((d) => d.id === editing);
        const platform = draft ? draft.platform : cur ? cur.platform : (rs.platforms[0] || {}).id;
        const preset = (rs.platforms.find((p) => p.id === platform) || {}).url || '';
        const val = (field, fallback) => (draft ? draft[field] : cur ? cur[field] : fallback);
        return `<form id="platForm" class="props-form plat-form" novalidate>
            <div class="field"><label for="pfPlatform">Platform</label>
                <select id="pfPlatform" name="platform">${optionList(rs.platforms.map((p) => [p.id, p.label]), platform)}</select></div>
            <div class="field"><label for="pfName">Name (optional)</label>
                <input id="pfName" name="name" class="obs-input" maxlength="40" autocomplete="off" value="${esc(val('name', ''))}"></div>
            <div class="field"><label for="pfUrl">Server address</label>
                <input id="pfUrl" name="url" class="obs-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="rtmp://\u2026" value="${esc(val('url', preset))}"></div>
            <div class="field"><label for="pfKey">Stream key</label>
                <div class="copy-row"><input id="pfKey" name="key" type="password" class="obs-input" autocomplete="off" value="${esc(draft ? draft.key : '')}" placeholder="${cur ? 'Leave empty to keep the current key' : ''}"><button type="button" class="obs-btn" data-show="pfKey">Show</button></div>
                <small id="pfHelp">${esc(PLATFORM_HELP[platform] || '')}</small>
                <small>Never share it: anyone with it can stream on your account.</small></div>
            <div class="field"><label for="pfFmt">Format</label>
                <select id="pfFmt" name="fmt">${optionList([['original', 'Same as your studio'], ['vertical', 'Vertical 9:16 (for TikTok)']], val('fmt', 'original'))}</select></div>
            ${error ? `<p class="form-error">${esc(error)}</p>` : ''}
            <div class="row"><button type="submit" class="btn btn-primary">Save</button><button type="button" class="obs-btn" data-plat-cancel>Cancel</button></div>
        </form>`;
    }

    function chatSection() {
        const tw = br.twitch;
        return `<fieldset class="panel-section"><legend>Bring their chat here</legend>
            <p class="muted">Messages from other platforms show in your chat with their platform\u2019s tag, in the chat of your stream, and the bot answers their commands.</p>
            <div class="field"><label for="twCh">Twitch channel</label>
                <div class="copy-row"><input id="twCh" class="obs-input" maxlength="60" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="your_twitch_name" value="${esc(tw.channel)}" translate="no">
                    <button type="button" class="obs-btn" data-tw-save>Save</button></div>
                <label class="check"><input type="checkbox" id="twOn"${tw.enabled ? ' checked' : ''}><span><strong>Read the Twitch chat while I\u2019m live</strong><small>Read only, no Twitch account needed.</small></span></label>
                ${tw.enabled ? `<span class="plat-status s-${tw.status === 'connected' ? 'live' : tw.status === 'error' ? 'error' : 'starting'}">${tw.status === 'connected' ? 'Connected' : tw.status === 'error' ? 'Failed' : 'Waiting for you to go live'}</span>` : ''}</div>
            <div class="field"><label for="brUrl">Link for TikTok, Kick, YouTube and more</label>
                <div class="copy-row"><input id="brUrl" class="obs-input" readonly value="${esc(br.url)}"><button type="button" class="obs-btn" data-copy="brUrl">Copy</button></div>
                <small>Kick and TikTok don\u2019t let other apps read their chat without your login. Use any tool that listens to that chat and can call a link, and give it this one. Keep it private: anyone with it can write in your chat.</small></div>
            <details class="obs-sub"><summary>How to use the link</summary>
                <ol>
                    <li>In the tool, add a webhook (or a \u201ccall a URL\u201d action) for chat messages.</li>
                    <li>Send a POST to the link with this body:</li>
                </ol>
                <pre class="plat-code" translate="no">{"platform": "tiktok", "user": "ana", "text": "hello"}</pre>
                <p class="muted">The answer has the bot\u2019s reply in the field reply, so the tool can say it in that chat too.</p>
            </details>
            <button type="button" class="obs-btn" data-br-reset>Make a new link</button>
        </fieldset>`;
    }

    function render() {
        body.innerHTML = sendSection() + chatSection();
        shown = summary();
    }

    async function reload() {
        [rs, br] = await Promise.all([api('/restream'), api('/bridge')]);
    }

    async function refresh() {
        if (!dlg.open || editing !== null) return;
        const active = document.activeElement;
        if (active && body.contains(active) && /INPUT|SELECT/.test(active.tagName) && active.type !== 'checkbox') return; // don't interrupt typing
        try {
            await reload();
            if (summary() !== shown) render();
        } catch { /* try again next time */ }
    }

    render();
    const timer = setInterval(refresh, 4000);
    dlg.addEventListener('close', () => clearInterval(timer), { once: true });

    body.addEventListener('change', async (e) => {
        if (e.target.id === 'pfPlatform') {
            const p = rs.platforms.find((x) => x.id === e.target.value) || {};
            const url = $('#pfUrl', body);
            if (!url.value || rs.platforms.some((x) => x.url === url.value)) url.value = p.url || '';
            $('#pfHelp', body).textContent = PLATFORM_HELP[p.id] || '';
            if (p.id === 'tiktok') $('#pfFmt', body).value = 'vertical';
        } else if (e.target.dataset.platToggle) {
            try {
                await api(`/restream/${e.target.dataset.platToggle}`, { method: 'POST', body: { enabled: e.target.checked } });
                await reload();
                render();
            } catch (err) { toast(err.message); e.target.checked = !e.target.checked; }
        }
    });

    body.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        const data = { platform: f.platform.value, name: f.name.value, url: f.url.value, fmt: f.fmt.value };
        if (f.key.value) data.key = f.key.value;
        try {
            await api(editing === 'new' ? '/restream' : `/restream/${editing}`, { method: 'POST', body: data });
            editing = null;
            error = '';
            draft = null;
            await reload();
            render();
            toast('Saved.');
        } catch (err) {
            error = err.message;
            draft = { ...data, key: f.key.value };
            render();
        }
    });

    body.addEventListener('click', async (e) => {
        const t = e.target;
        if (t.closest('[data-plat-add]')) { editing = 'new'; error = ''; draft = null; render(); $('#pfKey', body).focus(); }
        else if (t.closest('[data-plat-cancel]')) { editing = null; error = ''; draft = null; render(); }
        else if (t.closest('[data-plat-edit]')) { editing = Number(t.closest('[data-plat-edit]').dataset.platEdit); error = ''; draft = null; render(); }
        else if (t.closest('[data-plat-del]')) {
            if (!confirm('Remove this platform?')) return;
            try { await api(`/restream/${t.closest('[data-plat-del]').dataset.platDel}/delete`, { method: 'POST' }); await reload(); render(); } catch (err) { toast(err.message); }
        } else if (t.closest('[data-show]')) {
            const f = $('#' + t.closest('[data-show]').dataset.show, body);
            f.type = f.type === 'password' ? 'text' : 'password';
            t.closest('[data-show]').textContent = f.type === 'password' ? 'Show' : 'Hide';
        } else if (t.closest('[data-copy]')) {
            try { await navigator.clipboard.writeText($('#' + t.closest('[data-copy]').dataset.copy, body).value); toast('Copied.'); } catch { toast('Select the text and copy it.'); }
        } else if (t.closest('[data-tw-save]')) {
            try {
                br = await api('/bridge/twitch', { method: 'POST', body: { channel: $('#twCh', body).value, enabled: $('#twOn', body).checked } });
                render();
                toast('Saved.');
            } catch (err) { toast(err.message); }
        } else if (t.closest('[data-br-reset]')) {
            if (!confirm('The old link will stop working. Make a new one?')) return;
            try { br = await api('/bridge/token/reset', { method: 'POST' }); render(); toast('New link created. Update it in your tool.'); } catch (err) { toast(err.message); }
        }
    });
}
