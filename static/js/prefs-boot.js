/* Applies saved preferences before the first paint (no flash of the default theme).
   Loaded synchronously from <head>; the full logic lives in preferences.js. */
(function () {
    var d = document.documentElement, p = {};
    try { p = JSON.parse(localStorage.getItem('yeli.prefs.v1')) || {}; } catch (e) {}
    d.dataset.theme = p.theme || 'dark';
    d.dataset.accent = p.accent || 'orange';
    d.dataset.density = p.density || 'comfortable';
    d.dataset.splash = p.splash === false ? 'off' : 'on';
    var m = p.motion || 'system';
    var reduced = m === 'reduced' || (m === 'system' && window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (reduced) d.classList.add('reduce-motion');
    if (p.splash !== false) d.classList.add('splash-active');
})();
