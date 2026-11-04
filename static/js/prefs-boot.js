/* Applies saved preferences before the first paint (no flash of the default theme or language).
   Loaded synchronously from <head>; the full logic lives in preferences.js. */
(function () {
    var d = document.documentElement, p = {};
    try { p = JSON.parse(localStorage.getItem('yeli.prefs.v1')) || {}; } catch (e) {}
    d.dataset.theme = p.theme === 'light' ? 'light' : 'dark';
    d.dataset.density = p.density || 'comfortable';
    d.dataset.splash = p.splash === false ? 'off' : 'on';

    /* Language: "auto" follows the browser (Spanish if it asks for Spanish, English otherwise) */
    var pref = p.lang === 'en' || p.lang === 'es' ? p.lang : 'auto';
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
    var lang = pref === 'auto' ? (/^es(\b|-|_)/i.test(nav) ? 'es' : 'en') : pref;
    window.YELI_LANG = lang;
    d.lang = lang;
    if (lang === 'es') {
        /* Yeli translates itself: stop the browser translator from touching an already translated page */
        d.setAttribute('translate', 'no');
        var meta = document.createElement('meta');
        meta.name = 'google'; meta.content = 'notranslate';
        document.head.appendChild(meta);
    }

    var tc = document.querySelector('meta[name="theme-color"]');
    if (tc && d.dataset.theme === 'light') tc.setAttribute('content', '#f4f5f7');

    var m = p.motion || 'system';
    var reduced = m === 'reduced' || (m === 'system' && window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (reduced) d.classList.add('reduce-motion');
    if (p.splash !== false) d.classList.add('splash-active');
})();
