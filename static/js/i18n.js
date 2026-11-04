'use strict';

/* =========================================================================
   Yeli translations.
   The interface is written in English; this file swaps the text for Spanish (the dictionary lives in
   i18n-es.js) when the language is "es". It edits text nodes and a few attributes in place (it never
   replaces elements), so it can't break the page the way a browser translator can, and it also catches
   text the app draws later (pages, dialogs, toasts, server error messages).

   Anything that isn't in the dictionary stays in English. Names, chat messages and stream titles are never
   touched. To add a string, put "English text": "Spanish text" in i18n-es.js.
   ========================================================================= */
(() => {
    const DICT = new Map();
    const PATTERNS = window.YELI_ES_PATTERNS || [];
    const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
    const SKIP = '[translate="no"]:not(html), .chat-text, .chat-user, .stream-card .stream-title, .channel-card .stream-title, .stream-channel, #chTitle, .suggest-name, .um-who, .badge-live, .brand-name, .splash-word, [data-no-i18n]';
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);

    const norm = (s) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u2026/g, '...').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    Object.entries(window.YELI_ES || {}).forEach(([k, v]) => DICT.set(norm(k), v));

    let lang = window.YELI_LANG === 'es' ? 'es' : 'en';
    let observer = null;
    const missed = new Set();
    const origText = new WeakMap();
    const shownText = new WeakMap();
    const origAttr = new WeakMap();

    /* Translate one trimmed, whitespace-collapsed string. Returns undefined when we have nothing for it. */
    function core(text) {
        const key = norm(text);
        if (!key) return undefined;
        if (DICT.has(key)) return DICT.get(key);
        for (let i = 0; i < PATTERNS.length; i++) {
            const m = PATTERNS[i][0].exec(key);
            if (!m) continue;
            const rep = PATTERNS[i][1];
            const out = typeof rep === 'function' ? rep.apply(null, m) : key.replace(PATTERNS[i][0], rep);
            if (out !== undefined && out !== null) return out;
        }
        return undefined;
    }

    /* Same, keeping the spaces around the text. "~" at the start/end of a translation drops that side's space. */
    function tr(raw) {
        const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
        if (!m[2]) return raw;
        const out = core(m[2]);
        if (out === undefined) {
            if (/[A-Za-z]{3,}/.test(m[2])) missed.add(norm(m[2]));
            return raw;
        }
        let lead = m[1], trail = m[3], body = out;
        if (body.charAt(0) === '~') { lead = ''; body = body.slice(1); }
        if (body.charAt(body.length - 1) === '~') { trail = ''; body = body.slice(0, -1); }
        return lead + body + trail;
    }

    const skipped = (node) => {
        const el = node.nodeType === 1 ? node : node.parentElement;
        if (!el) return true;
        if (node.nodeType === 3 && SKIP_TAGS.has(el.tagName)) return true;   // never the text inside script/style/textarea
        return !!(el.closest && el.closest(SKIP));
    };

    function doText(node) {
        if (skipped(node)) return;
        const cur = node.nodeValue;
        let orig = origText.get(node);
        if (orig === undefined || shownText.get(node) !== cur) { orig = cur; origText.set(node, orig); } // new, or the app wrote new text
        const out = lang === 'es' ? tr(orig) : orig;
        if (out !== cur) node.nodeValue = out;
        shownText.set(node, out);
    }

    function doAttr(el, name) {
        if (skipped(el)) return;
        const cur = el.getAttribute(name);
        if (cur === null) return;
        let rec = origAttr.get(el);
        if (!rec) { rec = {}; origAttr.set(el, rec); }
        let entry = rec[name];
        if (!entry || entry.shown !== cur) { entry = rec[name] = { orig: cur, shown: cur }; }
        const out = lang === 'es' ? tr(entry.orig) : entry.orig;
        if (out !== cur) el.setAttribute(name, out);
        entry.shown = out;
    }

    function walk(root) {
        if (!root) return;
        if (root.nodeType === 3) { doText(root); return; }
        if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
        const first = root.nodeType === 9 ? root.documentElement : root;
        if (first.nodeType === 1 && skipped(first) && first !== document.documentElement) return;
        const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = tw.nextNode())) doText(n);
        const scope = root.nodeType === 1 ? root : root.documentElement || root;
        if (scope.nodeType === 1) {
            if (scope.matches && scope.matches('[placeholder],[aria-label],[title],[alt]')) ATTRS.forEach((a) => doAttr(scope, a));
            scope.querySelectorAll('[placeholder],[aria-label],[title],[alt]').forEach((el) => ATTRS.forEach((a) => doAttr(el, a)));
        }
    }

    function onMutations(records) {
        for (const r of records) {
            if (r.type === 'characterData') doText(r.target);
            else if (r.type === 'attributes') doAttr(r.target, r.attributeName);
            else r.addedNodes.forEach(walk);
        }
        observer.takeRecords(); // drop the echoes of our own edits
    }

    function start() {
        if (observer) return;
        observer = new MutationObserver(onMutations);
        observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }

    function stop() {
        if (!observer) return;
        observer.disconnect();
        observer = null;
    }

    function set(next) {
        next = next === 'es' ? 'es' : 'en';
        lang = next;
        window.YELI_LANG = next;
        document.documentElement.lang = next;
        walk(document);
        if (next === 'es') start(); else stop();
        window.dispatchEvent(new CustomEvent('yeli:lang', { detail: next }));
    }

    function init() {
        if (lang === 'es') { walk(document); start(); }
    }

    window.YeliI18n = {
        get lang() { return lang; },
        set,
        /* Translate a string that isn't in the page (for example for confirm() boxes). */
        t: (s) => (lang === 'es' ? tr(String(s)) : String(s)),
        tc: (s) => { const o = core(s); return o === undefined ? s : o; },
        missing: () => [...missed].sort(),
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
