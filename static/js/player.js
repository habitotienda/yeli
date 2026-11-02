'use strict';

/* =========================================================================
   Custom video controls (play, volume, picture-in-picture, fullscreen)
   ========================================================================= */
const VC_ICONS = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>',
    volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor"/><path d="M16 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    pip: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="11.5" y="11" width="7" height="5" rx="1" fill="currentColor"/></svg>',
    fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.500v3M12 18.500v3M2.500 12h3M18.500 12h3M5.300 5.300l2.100 2.100M16.600 16.600l2.100 2.100M5.300 18.700l2.100-2.100M16.600 7.400l2.100-2.100" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    exit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function loadVolumePrefs() {
    try {
        const v = JSON.parse(localStorage.getItem('yeli:volume') || '{}');
        return { volume: typeof v.volume === 'number' ? Math.min(1, Math.max(0, v.volume)) : 1, muted: !!v.muted };
    } catch { return { volume: 1, muted: false }; }
}

function saveVolumePrefs(video) {
    try { localStorage.setItem('yeli:volume', JSON.stringify({ volume: video.volume, muted: video.muted })); } catch { /* private mode */ }
}

/**
 * Adds a control bar to `player` (an element that contains `video`).
 * Returns { destroy() }.
 */
function loadQualityPref() {
    try { const q = Number(localStorage.getItem('yeli:quality')); return [0, 720, 480, 360, 240].includes(q) ? q : 0; } catch { return 0; }
}

function saveQualityPref(q) {
    try { localStorage.setItem('yeli:quality', String(q)); } catch { /* private mode */ }
}

/**
 * opts.quality = { onChange(height) } adds a quality menu (0 = source).
 * Returns { destroy(), getQuality() }.
 */
function createPlayerControls(player, video, { live = true, quality = null } = {}) {
    let currentQuality = quality ? loadQualityPref() : 0;
    const prefs = loadVolumePrefs();
    video.volume = prefs.volume;
    video.muted = prefs.muted;

    const canPip = !!document.pictureInPictureEnabled && !video.disablePictureInPicture;
    const el = document.createElement('div');
    el.className = 'vc';
    el.innerHTML = `
        <div class="vc-bar">
            <button type="button" class="vc-btn" data-vc="play" aria-label="Pause"></button>
            <button type="button" class="vc-btn" data-vc="mute" aria-label="Mute"></button>
            <input type="range" class="vc-volume" min="0" max="1" step="0.02" aria-label="Volume">
            ${live ? '<span class="vc-live"><i aria-hidden="true"></i>LIVE</span>' : ''}
            <span class="vc-spacer"></span>
            ${quality ? '<button type="button" class="vc-btn" data-vc="quality" aria-label="Quality" aria-haspopup="menu" aria-expanded="false"></button>' : ''}
            ${canPip ? '<button type="button" class="vc-btn" data-vc="pip" aria-label="Picture in picture"></button>' : ''}
            <button type="button" class="vc-btn" data-vc="fs" aria-label="Fullscreen"></button>
        </div>
        ${quality ? '<div class="vc-menu" role="menu" aria-label="Quality" hidden></div>' : ''}`;
    player.appendChild(el);
    player.tabIndex = 0;
    player.classList.add('has-controls');

    const btn = (name) => el.querySelector(`[data-vc="${name}"]`);
    const slider = el.querySelector('.vc-volume');
    const isFs = () => document.fullscreenElement === player || document.webkitFullscreenElement === player;

    function paint() {
        btn('play').innerHTML = video.paused ? VC_ICONS.play : VC_ICONS.pause;
        btn('play').setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
        const silent = video.muted || video.volume === 0;
        btn('mute').innerHTML = silent ? VC_ICONS.muted : VC_ICONS.volume;
        btn('mute').setAttribute('aria-label', silent ? 'Unmute' : 'Mute');
        slider.value = video.muted ? 0 : video.volume;
        slider.style.setProperty('--fill', `${Number(slider.value) * 100}%`);
        btn('fs').innerHTML = isFs() ? VC_ICONS.exit : VC_ICONS.fullscreen;
        btn('fs').setAttribute('aria-label', isFs() ? 'Exit fullscreen' : 'Fullscreen');
        if (btn('pip')) btn('pip').innerHTML = VC_ICONS.pip;
        if (btn('quality')) btn('quality').innerHTML = VC_ICONS.gear;
        player.classList.toggle('is-paused', video.paused);
    }

    const togglePlay = () => { if (video.paused) video.play().catch(() => {}); else video.pause(); };
    const userChoice = () => { delete video.dataset.noPersist; };
    const toggleMute = () => { userChoice(); video.muted = !video.muted; if (!video.muted && video.volume === 0) video.volume = 0.5; };
    const toggleFs = () => {
        if (isFs()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else (player.requestFullscreen || player.webkitRequestFullscreen || (() => {})).call(player);
    };
    const togglePip = async () => {
        try {
            if (document.pictureInPictureElement) await document.exitPictureInPicture();
            else await video.requestPictureInPicture();
        } catch { /* not available right now */ }
    };

    const menu = el.querySelector('.vc-menu');
    const QUALITY_LABELS = [[0, 'Source'], [720, '720p'], [480, '480p'], [360, '360p'], [240, '240p']];
    function closeMenu() {
        if (!menu) return;
        menu.hidden = true;
        btn('quality').setAttribute('aria-expanded', 'false');
    }
    function openMenu() {
        const receiving = video.videoWidth ? `${video.videoWidth}\u00d7${video.videoHeight}` : 'waiting for video';
        menu.innerHTML = `<p class="vc-menu-title">Quality</p>${QUALITY_LABELS.map(([q, l]) =>
            `<button type="button" role="menuitemradio" aria-checked="${q === currentQuality}" data-q="${q}">${l}</button>`).join('')}
            <p class="vc-menu-note">Receiving ${receiving}</p>`;
        menu.hidden = false;
        btn('quality').setAttribute('aria-expanded', 'true');
        const checked = menu.querySelector('[aria-checked="true"]');
        if (checked) checked.focus({ preventScroll: true });
    }

    el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-vc]');
        if (!b) return;
        if (b.dataset.vc === 'quality') { if (menu.hidden) openMenu(); else closeMenu(); return; }
        ({ play: togglePlay, mute: toggleMute, fs: toggleFs, pip: togglePip })[b.dataset.vc]();
    });
    if (menu) {
        menu.addEventListener('click', (e) => {
            const item = e.target.closest('[data-q]');
            if (!item) return;
            currentQuality = Number(item.dataset.q);
            saveQualityPref(currentQuality);
            quality.onChange(currentQuality);
            closeMenu();
            btn('quality').focus({ preventScroll: true });
        });
        menu.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); btn('quality').focus({ preventScroll: true }); }
        });
    }
    const onDocClick = (e) => { if (menu && !menu.hidden && !e.target.closest('.vc-menu') && !e.target.closest('[data-vc="quality"]')) closeMenu(); };
    document.addEventListener('click', onDocClick);
    slider.addEventListener('input', () => {
        userChoice();
        video.volume = Number(slider.value);
        video.muted = video.volume === 0;
    });

    // Click the picture to play/pause, double click for fullscreen
    let clickTimer = null;
    const onVideoClick = () => {
        clearTimeout(clickTimer);
        clickTimer = setTimeout(togglePlay, 220);
    };
    const onVideoDbl = () => { clearTimeout(clickTimer); toggleFs(); };
    video.addEventListener('click', onVideoClick);
    video.addEventListener('dblclick', onVideoDbl);

    // Auto-hide while playing
    let idleTimer = null;
    const wake = () => {
        player.classList.remove('is-idle');
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            if (menu && !menu.hidden) return;
            if (!video.paused && !player.contains(document.activeElement && document.activeElement.closest('.vc-bar') ? document.activeElement : null)) {
                player.classList.add('is-idle');
            }
        }, 2600);
    };
    ['mousemove', 'pointerdown', 'touchstart', 'focusin'].forEach((t) => player.addEventListener(t, wake, { passive: true }));
    player.addEventListener('mouseleave', () => { if (!video.paused) player.classList.add('is-idle'); });

    // Keyboard shortcuts when the player has focus
    player.addEventListener('keydown', (e) => {
        if (e.target.matches('input')) return;
        const key = e.key.toLowerCase();
        if (key === ' ' || key === 'k') { e.preventDefault(); togglePlay(); }
        else if (key === 'm') toggleMute();
        else if (key === 'f') toggleFs();
        else if (key === 'arrowup') { userChoice(); video.volume = Math.min(1, video.volume + 0.1); video.muted = false; e.preventDefault(); }
        else if (key === 'arrowdown') { userChoice(); video.volume = Math.max(0, video.volume - 0.1); e.preventDefault(); }
        wake();
    });

    const onVol = () => { paint(); if (!video.dataset.noPersist) saveVolumePrefs(video); };
    video.addEventListener('play', paint);
    video.addEventListener('pause', paint);
    video.addEventListener('volumechange', onVol);
    const onFs = () => paint();
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);

    paint();
    wake();

    return {
        getQuality: () => currentQuality,
        destroy() {
            clearTimeout(idleTimer);
            clearTimeout(clickTimer);
            video.removeEventListener('click', onVideoClick);
            video.removeEventListener('dblclick', onVideoDbl);
            video.removeEventListener('play', paint);
            video.removeEventListener('pause', paint);
            video.removeEventListener('volumechange', onVol);
            document.removeEventListener('click', onDocClick);
            document.removeEventListener('fullscreenchange', onFs);
            document.removeEventListener('webkitfullscreenchange', onFs);
            if (document.fullscreenElement === player) document.exitFullscreen().catch(() => {});
        },
    };
}
