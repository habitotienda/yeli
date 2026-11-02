'use strict';

/* =========================================================================
   Moderation: chat bans and moderators of a channel
   ========================================================================= */
const BAN_LENGTHS = [[10, '10 minutes'], [60, '1 hour'], [1440, '1 day'], [10080, '7 days'], [0, 'Permanent']];

async function pageModeration(root, alive) {
    document.title = 'Moderation | Yeli';
    if (!state.me) {
        root.innerHTML = emptyState('Log in to moderate', 'Bans and moderators belong to your channel.', '<button type="button" class="btn btn-primary" data-auth="login">Log In</button>');
        return;
    }
    const { channels: modOf } = await api('/mod/channels');
    if (!alive()) return;
    const channels = [state.me.username, ...modOf];
    let channel = channels[0];
    let data = null;

    async function load() {
        data = await api(`/mod/${encodeURIComponent(channel)}`);
        if (alive()) render();
    }

    function render() {
        const when = (b) => (b.until ? `until ${new Date(b.until * 1000).toLocaleString()}` : 'permanent');
        root.innerHTML = `
        <div class="page-head"><h1 class="page-title">Moderation</h1>
            <p class="page-sub">Banned viewers can\u2019t write in the chat. Moderators can delete messages and ban or unban viewers.</p></div>
        ${channels.length > 1 ? `<div class="field mod-channel"><label for="modCh">Channel</label>
            <select id="modCh">${channels.map((c) => `<option value="${esc(c)}"${c === channel ? ' selected' : ''}>${esc(c)}${c === state.me.username ? ' (yours)' : ''}</option>`).join('')}</select></div>` : ''}

        <section class="section"><h2 class="section-title">Ban a viewer</h2>
            <form class="panel" id="banForm" novalidate>
                <div class="field-row">
                    <div class="field"><label for="bnUser">Username</label><input id="bnUser" name="user" maxlength="20" autocomplete="off" required></div>
                    <div class="field"><label for="bnLen">For</label><select id="bnLen" name="minutes">${BAN_LENGTHS.map(([m, l]) => `<option value="${m}">${l}</option>`).join('')}</select></div>
                </div>
                <div class="field"><label for="bnWhy">Reason (optional)</label><input id="bnWhy" name="reason" maxlength="120" autocomplete="off"></div>
                <label class="check"><input type="checkbox" name="purge" checked><span><strong>Delete their messages from the chat</strong></span></label>
                <p class="form-error" id="bnErr" role="alert" hidden></p>
                <div class="row"><button type="submit" class="btn btn-primary">Ban</button></div>
            </form>
            ${data.bans.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>User</th><th>Until</th><th>By</th><th>Reason</th><th></th></tr></thead><tbody>
                ${data.bans.map((b) => `<tr><td>${esc(b.username)}</td><td>${esc(when(b))}</td><td>${esc(b.by_name)}</td><td class="wrap">${esc(b.reason || '')}</td>
                    <td class="actions"><button type="button" class="obs-btn" data-unban="${esc(b.username)}">Unban</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nobody is banned.</p>'}
        </section>

        ${data.is_owner ? `<section class="section"><h2 class="section-title">Moderators</h2>
            <form class="panel" id="modForm" novalidate>
                <div class="field"><label for="mdUser">Add a moderator</label>
                    <div class="copy-row"><input id="mdUser" name="user" maxlength="20" placeholder="username" autocomplete="off" required><button type="submit" class="btn btn-primary">Add</button></div></div>
                <p class="form-error" id="mdErr" role="alert" hidden></p>
            </form>
            ${data.mods.length ? `<ul class="history">${data.mods.map((m) => `<li><span>${esc(m)}</span><button type="button" class="obs-btn" data-rmmod="${esc(m)}">Remove</button></li>`).join('')}</ul>` : '<p class="muted">No moderators yet.</p>'}
            <p class="hint">Moderators see delete, timeout and ban buttons in your chat, and aren\u2019t limited by your chat rules.</p>
        </section>` : '<p class="hint">You\u2019re a moderator here. Only the streamer can add or remove moderators.</p>'}`;

        const ch = $('#modCh');
        if (ch) ch.addEventListener('change', () => { channel = ch.value; load(); });
        $('#banForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const err = $('#bnErr');
            err.hidden = true;
            try {
                data = { ...data, ...(await api(`/mod/${encodeURIComponent(channel)}/ban`, { method: 'POST', body: {
                    user: f.user.value, minutes: Number(f.minutes.value), reason: f.reason.value, purge: f.purge.checked } })) };
                toast('Banned.');
                render();
            } catch (e2) { err.textContent = e2.message; err.hidden = false; }
        });
        const mf = $('#modForm');
        if (mf) mf.addEventListener('submit', async (e) => {
            e.preventDefault();
            const err = $('#mdErr');
            err.hidden = true;
            try { data = { ...data, ...(await api('/mods/add', { method: 'POST', body: { user: mf.user.value } })) }; render(); }
            catch (e2) { err.textContent = e2.message; err.hidden = false; }
        });
        root.onclick = async (e) => {
            const un = e.target.closest('[data-unban]');
            const rm = e.target.closest('[data-rmmod]');
            if (un) { data = { ...data, ...(await api(`/mod/${encodeURIComponent(channel)}/unban`, { method: 'POST', body: { user: un.dataset.unban } })) }; render(); }
            else if (rm) { data = { ...data, ...(await api('/mods/remove', { method: 'POST', body: { user: rm.dataset.rmmod } })) }; render(); }
        };
    }
    await load();
}
