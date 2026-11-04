/* Browser translators (Google Translate, Edge, Safari) replace text nodes with <font> wrappers.
   When the app then removes or inserts around a node it still holds, the DOM throws and the page
   stops updating. These two guards make those calls tolerant, as React and others do.
   Loaded first, from <head>. */
(function () {
    if (typeof Node !== 'function' || !Node.prototype) return;

    var removeChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function (child) {
        if (child && child.parentNode !== this) return child; // already moved by the translator
        return removeChild.apply(this, arguments);
    };

    var insertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function (node, ref) {
        if (ref && ref.parentNode !== this) return insertBefore.call(this, node, null);
        return insertBefore.apply(this, arguments);
    };
})();

/* Things a translator must leave alone: names, the brand, the currency and chat. */
(function () {
    var SELECTOR = [
        '.brand-name', '.coin-chip', '.stream-channel', '.stream-card .stream-title', '.suggest-name',
        '.um-who', '.badge-live', '.sidebar-circle-wrapper .item-text', '.splash-word'
    ].join(',');
    var queued = false;

    function mark() {
        queued = false;
        var nodes = document.querySelectorAll(SELECTOR);
        for (var i = 0; i < nodes.length; i++) if (!nodes[i].hasAttribute('translate')) nodes[i].setAttribute('translate', 'no');
    }

    function schedule() {
        if (queued) return;
        queued = true;
        (window.requestAnimationFrame || setTimeout)(mark);
    }

    document.addEventListener('DOMContentLoaded', function () {
        mark();
        new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    });
})();
