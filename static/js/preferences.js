'use strict';

/* =========================================================================
   Preferences (stored on this device) + loading screen
   Loaded before script.js so the settings apply before the app draws.
   ========================================================================= */
(() => {
    const KEY = 'yeli.prefs.v1';
    const DEFAULTS = {
        theme: 'dark',        // dark | black | midnight
        accent: 'orange',     // orange | pink | blue | teal | green | purple
        density: 'comfortable', // comfortable | compact
        motion: 'system',     // system | reduced | full
        splash: true,         // loading animation
        sidebar: false,       // sidebar expanded by default (desktop)
        translate: 'allow',   // allow | block (browser page translation)
    };
    const THEME_COLOR = { dark: '#1e1e1e', black: '#000000', midnight: '#0f1624' };

    const root = document.documentElement;
    const reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

    function load() {
        try {
            const saved = JSON.parse(localStorage.getItem(KEY));
            return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
        } catch {
            return { ...DEFAULTS };
        }
    }

    function save() {
        try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode: the settings last until reload */ }
    }

    const prefs = load();

    const motionReduced = () => prefs.motion === 'reduced' || (prefs.motion === 'system' && !!reduceQuery && reduceQuery.matches);

    function apply() {
        root.dataset.theme = prefs.theme;
        root.dataset.accent = prefs.accent;
        root.dataset.density = prefs.density;
        root.dataset.splash = prefs.splash ? 'on' : 'off';
        root.classList.toggle('reduce-motion', motionReduced());
        if (prefs.translate === 'block') root.setAttribute('translate', 'no'); else root.removeAttribute('translate');
        let tmeta = document.querySelector('meta[name="google"][content="notranslate"]');
        if (prefs.translate === 'block' && !tmeta) {
            tmeta = document.createElement('meta');
            tmeta.name = 'google';
            tmeta.content = 'notranslate';
            document.head.appendChild(tmeta);
        } else if (prefs.translate !== 'block' && tmeta) {
            tmeta.remove();
        }
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', THEME_COLOR[prefs.theme] || THEME_COLOR.dark);
    }

    if (reduceQuery && reduceQuery.addEventListener) reduceQuery.addEventListener('change', apply);
    apply();

    /* Sidebar: open by default on wide screens if the person asked for it */
    function applySidebarDefault() {
        const sidebar = document.querySelector('.sidebar');
        const btn = document.querySelector('.menu-toggle-btn');
        if (!sidebar || !btn || !prefs.sidebar || window.innerWidth <= 720) return;
        sidebar.classList.add('expanded');
        btn.setAttribute('aria-expanded', 'true');
    }
    applySidebarDefault();

    /* ---------------------------------------------------------------------
       Dialog
       --------------------------------------------------------------------- */
    const dialog = document.getElementById('prefsDialog');
    const form = document.getElementById('prefsForm');

    function syncForm() {
        if (!form) return;
        Object.keys(DEFAULTS).forEach((name) => {
            const fields = form.querySelectorAll(`[name="${name}"]`);
            fields.forEach((field) => {
                if (field.type === 'checkbox') field.checked = !!prefs[name];
                else field.checked = field.value === prefs[name];
            });
        });
    }

    function openPrefs() {
        if (!dialog) return;
        if (typeof window.closeUserMenu === 'function') window.closeUserMenu();
        syncForm();
        if (!dialog.open) dialog.showModal();
    }

    document.addEventListener('click', (e) => {
        if (e.target.closest('[data-prefs-open]')) { openPrefs(); return; }
        if (e.target.closest('[data-prefs-close]')) { dialog.close(); return; }
        if (e.target === dialog) dialog.close(); // click on the backdrop
    });

    if (form) {
        form.addEventListener('change', (e) => {
            const field = e.target;
            if (!field.name || !(field.name in DEFAULTS)) return;
            prefs[field.name] = field.type === 'checkbox' ? field.checked : field.value;
            save();
            apply();
            if (field.name === 'sidebar') {
                const sidebar = document.querySelector('.sidebar');
                const btn = document.querySelector('.menu-toggle-btn');
                if (sidebar && window.innerWidth > 720) {
                    sidebar.classList.toggle('expanded', prefs.sidebar);
                    btn.setAttribute('aria-expanded', String(prefs.sidebar));
                }
            }
        });
        form.addEventListener('submit', (e) => e.preventDefault());
    }

    const resetBtn = document.getElementById('prefsReset');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            Object.assign(prefs, DEFAULTS);
            save();
            apply();
            syncForm();
            const sidebar = document.querySelector('.sidebar');
            if (sidebar && window.innerWidth > 720) {
                sidebar.classList.remove('expanded');
                document.querySelector('.menu-toggle-btn').setAttribute('aria-expanded', 'false');
            }
        });
    }

    window.YeliPrefs = { get: () => ({ ...prefs }), open: openPrefs };

    /* ---------------------------------------------------------------------
       Loading screen: stays until the app says it is ready (and long enough for
       the logo to finish drawing), then the shutter opens. Hard stop at 10 s.
       --------------------------------------------------------------------- */
    const splash = document.getElementById('splash');
    if (!splash) return;

    const started = performance.now();
    const minTime = !prefs.splash ? 0 : motionReduced() ? 400 : 1900;
    let finished = false;

    function finish() {
        if (finished) return;
        finished = true;
        const wait = Math.max(0, minTime - (performance.now() - started));
        setTimeout(() => {
            splash.classList.add('is-leaving');
            root.classList.remove('splash-active');
            setTimeout(() => splash.remove(), 800);
        }, wait);
    }

    window.addEventListener('yeli:ready', finish);
    setTimeout(finish, 10000);
})();
