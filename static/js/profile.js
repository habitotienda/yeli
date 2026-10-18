'use strict';

/* =========================================================================
   Edit profile: avatar (built-in SVG or your own photo), bio and password
   ========================================================================= */
async function fileToAvatarDataUrl(file) {
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
    if (file.size > 10 * 1024 * 1024) throw new Error('That image is too large. The limit is 10 MB.');
    let bitmap;
    try { bitmap = await createImageBitmap(file); } catch { throw new Error('This browser can\u2019t read that image. Try a JPG or PNG.'); }
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, size, size);
    const side = Math.min(bitmap.width, bitmap.height); // square crop from the center
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    bitmap.close && bitmap.close();
    for (const q of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4]) {
        const url = canvas.toDataURL('image/jpeg', q);
        if (url.length * 0.75 < 58000) return url;
    }
    throw new Error('Couldn\u2019t shrink that image enough. Try a different one.');
}

async function pageSettings(root, alive) {
    document.title = 'Edit profile | Yeli';
    if (!state.me) {
        root.innerHTML = emptyState('Log in to edit your profile', 'Your picture and bio live on your account.', '<button type="button" class="btn btn-primary" data-auth="login">Log In</button>');
        return;
    }
    const me = state.me;
    const hasUpload = !!me.has_upload;

    // pending: what will be saved. avatar is '' (automatic), 'preset:N' or 'upload'.
    const pending = { avatar: me.avatar.startsWith('upload:') ? 'upload' : me.avatar, dataUrl: null };
    const previewSrc = () => {
        if (pending.dataUrl) return pending.dataUrl;
        if (pending.avatar === 'upload') return `/api/avatar/${encodeURIComponent(me.username)}?v=${encodeURIComponent(me.avatar.startsWith('upload:') ? me.avatar.slice(7) : Date.now())}`;
        return avatarSrc({ username: me.username, hue: me.hue, avatar: pending.avatar });
    };

    root.innerHTML = `
    <div class="page-head">
        <h1 class="page-title">Edit profile</h1>
        <p class="page-sub">Signed in as <strong>${esc(me.username)}</strong> (${esc(me.email)}).</p>
    </div>
    <div class="settings">
        <form class="panel" id="profileForm" novalidate>
            <h2 class="section-title">Profile picture</h2>
            <div class="avatar-edit">
                <img class="avatar avatar-xl" id="avPreview" alt="Your profile picture">
                <div class="avatar-actions">
                    <p class="muted">Pick one of the built-in avatars or upload your own photo.</p>
                    <div class="row">
                        <label class="btn btn-secondary file-btn">Upload photo<input type="file" id="avFile" accept="image/*" hidden></label>
                        <button type="button" class="btn btn-secondary" id="avDefault">Use my default</button>
                    </div>
                </div>
            </div>
            <div class="avatar-grid" role="radiogroup" aria-label="Built-in avatars" id="avGrid">
                ${hasUpload ? `<button type="button" class="avatar-opt" role="radio" data-value="upload" aria-label="Your photo"><img class="avatar" alt="" src="/api/avatar/${encodeURIComponent(me.username)}?v=${encodeURIComponent(me.avatar.startsWith('upload:') ? me.avatar.slice(7) : '0')}"></button>` : ''}
                ${AVATAR_PRESETS.map((p, i) => `<button type="button" class="avatar-opt" role="radio" data-value="preset:${i}" aria-label="${esc(p.name)}" title="${esc(p.name)}"><img class="avatar" alt="" src="${presetDataUri(i)}"></button>`).join('')}
            </div>
            <p class="form-error" id="avError" role="alert" hidden></p>

            <div class="field">
                <label for="bio">Bio</label>
                <textarea id="bio" name="bio" rows="4" maxlength="200" placeholder="Tell viewers what your channel is about"></textarea>
                <small id="bioCount"></small>
            </div>
            <p class="form-error" id="profileError" role="alert" hidden></p>
            <div class="row"><button type="submit" class="btn btn-primary" id="profileSave">Save changes</button>
                <a class="btn btn-secondary" href="${channelHref(me.username)}">View my channel</a></div>
        </form>

        <form class="panel" id="pwForm" novalidate>
            <h2 class="section-title">Password</h2>
            <div class="field"><label for="pwCur">Current password</label><input id="pwCur" name="current" type="password" autocomplete="current-password" required></div>
            <div class="field"><label for="pwNew">New password</label><input id="pwNew" name="new" type="password" autocomplete="new-password" minlength="8" required><small>At least 8 characters.</small></div>
            <div class="field"><label for="pwNew2">Repeat new password</label><input id="pwNew2" name="again" type="password" autocomplete="new-password" required></div>
            <p class="form-error" id="pwError" role="alert" hidden></p>
            <div class="row"><button type="submit" class="btn btn-secondary">Change password</button></div>
        </form>
    </div>`;

    const bio = $('#bio');
    bio.value = me.bio || '';
    const count = () => { $('#bioCount').textContent = `${bio.value.length}/200`; };
    bio.addEventListener('input', count);
    count();

    const avError = $('#avError');
    function paintAvatar() {
        $('#avPreview').src = previewSrc();
        document.querySelectorAll('#avGrid .avatar-opt').forEach((b) => b.setAttribute('aria-checked', String(!pending.dataUrl && b.dataset.value === pending.avatar)));
    }
    paintAvatar();

    $('#avGrid').addEventListener('click', (e) => {
        const b = e.target.closest('.avatar-opt');
        if (!b) return;
        pending.avatar = b.dataset.value;
        pending.dataUrl = null;
        avError.hidden = true;
        paintAvatar();
    });
    $('#avDefault').addEventListener('click', () => { pending.avatar = ''; pending.dataUrl = null; paintAvatar(); });
    $('#avFile').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        avError.hidden = true;
        try {
            pending.dataUrl = await fileToAvatarDataUrl(file);
            paintAvatar();
        } catch (err) {
            avError.textContent = err.message;
            avError.hidden = false;
        }
    });

    $('#profileForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('#profileSave');
        const errEl = $('#profileError');
        errEl.hidden = true;
        btn.disabled = true;
        try {
            const body = { bio: bio.value };
            if (pending.dataUrl) await api('/me/avatar', { method: 'POST', body: { image: pending.dataUrl } });
            else body.avatar = pending.avatar;
            const r = await api('/me/profile', { method: 'POST', body });
            state.me = { ...state.me, ...r.user };
            pending.dataUrl = null;
            pending.avatar = state.me.avatar.startsWith('upload:') ? 'upload' : state.me.avatar;
            renderAuth();
            await refreshSidebar();
            toast('Profile saved.');
        } catch (err) {
            errEl.textContent = err.message;
            errEl.hidden = false;
        } finally {
            btn.disabled = false;
        }
    });

    $('#pwForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const errEl = $('#pwError');
        errEl.hidden = true;
        if (form.new.value !== form.again.value) {
            errEl.textContent = 'The new passwords don\u2019t match.';
            errEl.hidden = false;
            return;
        }
        try {
            await api('/me/password', { method: 'POST', body: { current: form.current.value, new: form.new.value } });
            form.reset();
            toast('Password updated.');
        } catch (err) {
            errEl.textContent = err.message;
            errEl.hidden = false;
        }
    });
}
