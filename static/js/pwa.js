'use strict';

/* =========================================================================
   Install Yeli as an app: service worker + "Install" button in Settings.
   Needs https (or localhost). Chrome/Edge/Android show a real install prompt;
   iPhone/iPad Safari has no prompt, so we explain Share -> Add to Home Screen.
   ========================================================================= */
(() => {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* the site works without it */ });
        });
    }

    const section = document.getElementById('pgInstall');
    const button = document.getElementById('installBtn');
    const hint = document.getElementById('installHint');
    if (!section || !button || !hint) return;

    const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    const ua = navigator.userAgent || '';
    const isIos = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let deferred = null;

    function paint() {
        if (standalone()) { section.hidden = true; return; }
        if (deferred) {
            hint.textContent = 'Add Yeli to your home screen and open it like an app.';
            button.hidden = false;
            section.hidden = false;
        } else if (isIos) {
            hint.textContent = 'On iPhone and iPad: tap the Share button in Safari, then Add to Home Screen.';
            button.hidden = true;
            section.hidden = false;
        } else {
            section.hidden = true;
        }
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferred = e;
        paint();
    });

    window.addEventListener('appinstalled', () => {
        deferred = null;
        paint();
        if (typeof window.toast === 'function') window.toast('Yeli is installed.');
    });

    button.addEventListener('click', async () => {
        if (!deferred) return;
        deferred.prompt();
        try { await deferred.userChoice; } catch { /* ignored */ }
        deferred = null;
        paint();
    });

    paint();
})();
