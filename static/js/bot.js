'use strict';

/* =========================================================================
   Bot & chat settings: custom !commands, auto-posts (timers) and moderation
   ========================================================================= */
const PERM_LABELS = { everyone: 'Everyone', followers: 'Followers', mods: 'Moderators', owner: 'Only me' };

async function pageBot(root, alive) {
    document.title = 'Bot & chat | Yeli';
    if (!state.me) {
        root.innerHTML = emptyState('Log in to set up your bot', 'Commands and chat rules live on your channel.', '<button type="button" class="btn btn-primary" data-auth="login">Log In</button>');
        return;
    }
    const data = await api('/bot');
    if (!alive()) return;
    let { settings, commands } = data;
    let editing = null;
    const st = settings;

    const render = () => {
        root.innerHTML = `
        <div class="page-head"><h1 class="page-title">Bot &amp; chat</h1>
            <p class="page-sub">Viewers type <code>!name</code> in your chat and <strong>YeliBot</strong> answers. Commands: ${commands.length} of ${data.slots}.
            Ban viewers and add moderators in <a href="#/moderation" class="link-btn">Moderation</a>.</p></div>

        <section class="section"><h2 class="section-title">Commands</h2>
            <form class="panel" id="cmdForm" novalidate>
                <div class="field-row">
                    <div class="field"><label for="cmName">Command</label><input id="cmName" name="name" maxlength="20" placeholder="!socials" autocomplete="off" required value="${esc(editing ? '!' + editing.name : '')}"></div>
                    <div class="field"><label for="cmPerm">Who can use it</label>
                        <select id="cmPerm" name="perm">${Object.entries(PERM_LABELS).map(([k, l]) => `<option value="${k}"${editing && editing.perm === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
                </div>
                <div class="field"><label for="cmText">What the bot says</label>
                    <textarea id="cmText" name="response" rows="2" maxlength="300" placeholder="Follow me on example: {channel}! Thanks for asking, {user}">${esc(editing ? editing.response : '')}</textarea>
                    <small>Variables: ${data.variables.map((v) => `<code>${esc(v)}</code>`).join(' ')}</small></div>
                <div class="field-row">
                    <div class="field"><label for="cmCool">Cooldown (seconds)</label><input id="cmCool" name="cooldown" type="number" min="0" max="3600" value="${editing ? editing.cooldown : 5}"></div>
                    <div class="field"><label for="cmEvery">Auto-post every (minutes, 0 = off)</label><input id="cmEvery" name="every_min" type="number" min="0" max="720" value="${editing ? editing.every_min : 0}"><small>Posted while you\u2019re live, from 5 minutes up.</small></div>
                </div>
                <p class="form-error" id="cmErr" role="alert" hidden></p>
                <div class="row"><button type="submit" class="btn btn-primary">${editing ? 'Save command' : 'Add command'}</button>
                    ${editing ? '<button type="button" class="btn btn-secondary" data-cancel>Cancel</button>' : ''}</div>
            </form>
            ${commands.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Command</th><th>Says</th><th>Who</th><th>Used</th><th></th></tr></thead><tbody>
                ${commands.map((c) => `<tr><td><code>!${esc(c.name)}</code>${c.every_min ? ` <span class="badge">every ${c.every_min}m</span>` : ''}</td><td class="wrap">${esc(c.response)}</td><td>${PERM_LABELS[c.perm]}</td><td>${num(c.uses)}</td>
                    <td class="actions"><button type="button" class="obs-btn" data-edit="${c.id}">Edit</button><button type="button" class="obs-btn" data-del="${c.id}">Delete</button></td></tr>`).join('')}
            </tbody></table></div>` : '<p class="muted">No custom commands yet.</p>'}
            <p class="hint">Built in: ${data.builtin.map((b) => `<code>!${b}</code>`).join(' ')}</p>
        </section>

        <section class="section"><h2 class="section-title">Voice: read messages aloud</h2>
            <form class="panel" id="ttsForm" novalidate>
                <label class="check"><input type="checkbox" name="tts_enabled"${st.tts_enabled ? ' checked' : ''}><span><strong>Turn on the voice command</strong>
                    <small>A viewer types the command and a message, and everyone watching hears it. Each viewer\u2019s browser reads it aloud (they can mute it), and it also plays in the studio.</small></span></label>
                <div class="field-row">
                    <div class="field"><label for="ttCmd">Command</label><input id="ttCmd" name="tts_command" maxlength="20" value="!${esc(st.tts_command)}" autocomplete="off"><small>Example: <code>!${esc(st.tts_command)} Hola a todos</code></small></div>
                    <div class="field"><label for="ttPerm">Who can use it</label>
                        <select id="ttPerm" name="tts_perm">${Object.entries(PERM_LABELS).map(([k, l]) => `<option value="${k}"${st.tts_perm === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
                </div>
                <label class="check"><input type="checkbox" name="tts_name"${st.tts_name ? ' checked' : ''}><span><strong>Say the viewer\u2019s name</strong>
                    <small>On: \u201cbob says: Hola a todos\u201d. Off: \u201cHola a todos\u201d.</small></span></label>
                <div class="field"><label for="ttTpl">What is read when the name is on</label><input id="ttTpl" name="tts_template" maxlength="120" value="${esc(st.tts_template)}"><small>Use <code>{user}</code> and <code>{text}</code>. In Spanish: <code>{user} dice: {text}</code></small></div>
                <div class="field-row">
                    <div class="field"><label for="ttCool">Cooldown per viewer (seconds)</label><input id="ttCool" name="tts_cooldown" type="number" min="0" max="600" value="${st.tts_cooldown}"></div>
                    <div class="field"><label for="ttMax">Longest message (characters)</label><input id="ttMax" name="tts_max" type="number" min="20" max="300" value="${st.tts_max}"></div>
                </div>
                <div class="field"><label for="ttLang">Voice language (optional)</label><input id="ttLang" name="tts_lang" maxlength="12" value="${esc(st.tts_lang)}" placeholder="es-AR, en-US\u2026"><small>Empty = each viewer\u2019s own language. Chat rules (blocked words, links) also apply to what is read.</small></div>
                <p class="form-error" id="ttErr" role="alert" hidden></p>
                <div class="row"><button type="submit" class="btn btn-primary">Save voice settings</button></div>
            </form>
        </section>

        <section class="section"><h2 class="section-title">Chat rules</h2>
            <form class="panel" id="setForm" novalidate>
                <div class="field-row">
                    <div class="field"><label for="stSlow">Slow mode (seconds between messages)</label><input id="stSlow" name="slow_seconds" type="number" min="0" max="300" value="${st.slow_seconds}"></div>
                    <div class="field"><label for="stCaps">Block shouting above (% capitals, 0 = off)</label><input id="stCaps" name="caps_percent" type="number" min="0" max="100" value="${st.caps_percent}"></div>
                </div>
                <div class="stack">
                    <label class="check"><input type="checkbox" name="followers_only"${st.followers_only ? ' checked' : ''}><span><strong>Followers-only chat</strong></span></label>
                    <label class="check"><input type="checkbox" name="block_links"${st.block_links ? ' checked' : ''}><span><strong>Block links</strong></span></label>
                </div>
                <div class="field"><label for="stWords">Blocked words (comma separated)</label><input id="stWords" name="banned_words" maxlength="500" value="${esc(st.banned_words)}" placeholder="spoiler, word2"></div>
                <div class="stack">
                    <label class="check"><input type="checkbox" name="welcome"${st.welcome ? ' checked' : ''}><span><strong>Greet new followers</strong></span></label>
                    <div class="field"><label class="sr-only" for="stWel">Greeting</label><input id="stWel" name="welcome_text" maxlength="200" value="${esc(st.welcome_text)}"></div>
                    <label class="check"><input type="checkbox" name="thanks"${st.thanks ? ' checked' : ''}><span><strong>Thank donations</strong><small>Use {user}, {amount}</small></span></label>
                    <div class="field"><label class="sr-only" for="stThx">Thank-you message</label><input id="stThx" name="thanks_text" maxlength="200" value="${esc(st.thanks_text)}"></div>
                </div>
                <p class="form-error" id="stErr" role="alert" hidden></p>
                <div class="row"><button type="submit" class="btn btn-primary">Save chat rules</button></div>
                <p class="hint">Your own messages are never limited. Open your chat in its own window with the pop-out button above the chat, or use <code>#/popout/yourname?overlay=1</code> as an OBS browser source for a transparent chat.</p>
            </form>
        </section>`;
        wire();
    };

    function wire() {
        const form = $('#cmdForm');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const err = $('#cmErr');
            err.hidden = true;
            try {
                const r = await api('/bot/commands', { method: 'POST', body: {
                    id: editing ? editing.id : undefined, name: form.name.value, response: form.response.value, perm: form.perm.value,
                    cooldown: Number(form.cooldown.value), every_min: Number(form.every_min.value),
                } });
                commands = r.commands;
                editing = null;
                toast('Command saved.');
                render();
            } catch (e2) { err.textContent = e2.message; err.hidden = false; }
        });
        root.onclick = async (e) => {
            const edit = e.target.closest('[data-edit]');
            const del = e.target.closest('[data-del]');
            if (edit) { editing = commands.find((c) => c.id === Number(edit.dataset.edit)); render(); window.scrollTo(0, 0); }
            else if (e.target.closest('[data-cancel]')) { editing = null; render(); }
            else if (del) {
                await api('/bot/commands/delete', { method: 'POST', body: { id: Number(del.dataset.del) } });
                commands = commands.filter((c) => c.id !== Number(del.dataset.del));
                render();
            }
        };
        $('#ttsForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const err = $('#ttErr');
            err.hidden = true;
            try {
                const r = await api('/bot/settings', { method: 'POST', body: { ...st,
                    tts_enabled: f.tts_enabled.checked, tts_command: f.tts_command.value, tts_perm: f.tts_perm.value, tts_name: f.tts_name.checked,
                    tts_template: f.tts_template.value, tts_cooldown: Number(f.tts_cooldown.value), tts_max: Number(f.tts_max.value), tts_lang: f.tts_lang.value } });
                Object.assign(st, r.settings);
                toast('Voice settings saved.');
                render();
            } catch (e2) { err.textContent = e2.message; err.hidden = false; }
        });
        const set = $('#setForm');
        set.addEventListener('submit', async (e) => {
            e.preventDefault();
            const err = $('#stErr');
            err.hidden = true;
            try {
                const r = await api('/bot/settings', { method: 'POST', body: { ...st,
                    slow_seconds: Number(set.slow_seconds.value), caps_percent: Number(set.caps_percent.value),
                    followers_only: set.followers_only.checked, block_links: set.block_links.checked, banned_words: set.banned_words.value,
                    welcome: set.welcome.checked, welcome_text: set.welcome_text.value, thanks: set.thanks.checked, thanks_text: set.thanks_text.value,
                } });
                Object.assign(st, r.settings);
                toast('Chat rules saved.');
            } catch (e2) { err.textContent = e2.message; err.hidden = false; }
        });
    }
    render();
}

/* Chat in its own window (pop-out), or a transparent read-only chat for an OBS browser source (?overlay=1). */
async function pagePopout(root, channel, params) {
    document.title = `${channel} chat | Yeli`;
    root.innerHTML = `<div class="popout-chat${params.get('overlay') ? ' popout-overlay' : ''}" id="popoutChat"></div>`;
    const owner = !!(state.me && state.me.username.toLowerCase() === channel.toLowerCase());
    let mod = false;
    try { mod = (await api(`/channel/${encodeURIComponent(channel)}`)).channel.is_mod; } catch { /* unknown channel: plain chat */ }
    const chat = createChat($('#popoutChat'), channel, { isOwner: owner, canMod: owner || mod });
    onLeave(() => chat.destroy());
}
