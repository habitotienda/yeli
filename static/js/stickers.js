'use strict';

/* =========================================================================
   Chat stickers, drawn as SVG. Prices are decided by the server (economy.py):
   free stickers go in chat, paid ones are a donation of Yelis that shows up big.
   ========================================================================= */
const star = (cx, cy, r1, r2, n) => Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 ? r2 : r1;
    const a = (Math.PI * i) / n - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
}).join(' ');

const FACE = '<circle cx="32" cy="32" r="26" fill="#ffd43b" stroke="#e8a900" stroke-width="2"/>';
const TXT = 'font-family="Arial,Helvetica,sans-serif" font-weight="800" text-anchor="middle"';

const STICKER_DEFS = [
    { id: 'gg', name: 'GG', art: `<rect x="4" y="14" width="56" height="36" rx="12" fill="#2fb344"/><text x="32" y="41" font-size="24" ${TXT} fill="#fff">GG</text>` },
    { id: 'lol', name: 'LOL', art: `${FACE}<path d="M16 26q5-6 10 0M38 26q5-6 10 0" stroke="#5c3d00" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M16 36q16 22 32 0z" fill="#5c3d00"/><path d="M24 46q8 6 16 0q-8-4-16 0z" fill="#ff8787"/><path d="M11 30q-4 6 0 10q4-4 0-10zM53 30q-4 6 0 10q4-4 0-10z" fill="#74c0fc"/>` },
    { id: 'wow', name: 'Wow', art: `${FACE}<circle cx="22" cy="28" r="6" fill="#fff"/><circle cx="42" cy="28" r="6" fill="#fff"/><circle cx="22" cy="29" r="2.6" fill="#212529"/><circle cx="42" cy="29" r="2.6" fill="#212529"/><path d="M15 17q7-5 13 0M36 17q7-5 13 0" stroke="#5c3d00" stroke-width="2.5" fill="none" stroke-linecap="round"/><ellipse cx="32" cy="46" rx="5" ry="7" fill="#5c3d00"/>` },
    { id: 'hype', name: 'Hype', art: `<polygon points="${star(32, 32, 29, 19, 11)}" fill="#845ef7"/><text x="32" y="37" font-size="15" ${TXT} fill="#fff">HYPE</text>` },
    { id: 'love', name: 'Love', art: '<path d="M32 55C10 39 6 24 14 16c7-7 15-3 18 4 3-7 11-11 18-4 8 8 4 23-18 39z" fill="#fa5252"/><path d="M17 21q3-5 8-3" stroke="#ffc9c9" stroke-width="3" fill="none" stroke-linecap="round"/>' },
    { id: 'fire', name: 'Fire', art: '<path d="M32 5c4 12 18 18 18 35 0 12-8 18-18 18S14 52 14 40c0-8 6-12 8-20 4 6 6 8 8 8-1-8-3-16 2-23z" fill="#ff922b"/><path d="M32 58c-8 0-12-6-10-14 2-6 8-8 10-14 4 6 10 10 10 16 0 8-4 12-10 12z" fill="#ffd43b"/>' },
    { id: 'party', name: 'Party', art: '<path d="M8 57L22 20l22 22z" fill="#ff922b"/><path d="M13 45l14 4M17 34l14 5" stroke="#e8590c" stroke-width="3"/><circle cx="40" cy="14" r="3" fill="#fa5252"/><circle cx="52" cy="24" r="3" fill="#4dabf7"/><circle cx="30" cy="10" r="2.5" fill="#51cf66"/><circle cx="55" cy="40" r="2.5" fill="#cc5de8"/><path d="M34 24q8-14 14-6M44 32q10-6 14 4" stroke="#fcc419" stroke-width="3" fill="none" stroke-linecap="round"/>' },
    { id: 'sad', name: 'Sad', art: `${FACE}<circle cx="22" cy="30" r="3" fill="#5c3d00"/><circle cx="42" cy="30" r="3" fill="#5c3d00"/><path d="M14 22l9 3M50 22l-9 3" stroke="#5c3d00" stroke-width="2.5" stroke-linecap="round"/><path d="M22 47q10-9 20 0" stroke="#5c3d00" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M40 33q-5 8 0 11q5-3 0-11z" fill="#74c0fc"/>` },
    { id: 'cool', name: 'Cool', art: `${FACE}<rect x="11" y="24" width="18" height="12" rx="5" fill="#212529"/><rect x="35" y="24" width="18" height="12" rx="5" fill="#212529"/><rect x="29" y="27" width="6" height="3" fill="#212529"/><path d="M21 44q11 10 22 0" stroke="#5c3d00" stroke-width="3" fill="none" stroke-linecap="round"/>` },
    { id: 'ok', name: 'OK', art: '<circle cx="32" cy="32" r="26" fill="#40c057"/><path d="M19 33l9 9 17-18" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' },
    { id: 'rip', name: 'RIP', art: `<path d="M14 58V26Q14 8 32 8t18 18v32z" fill="#adb5bd" stroke="#868e96" stroke-width="2"/><text x="32" y="34" font-size="14" ${TXT} fill="#495057">RIP</text><path d="M32 40v12M27 45h10" stroke="#495057" stroke-width="3" stroke-linecap="round"/>` },
    { id: 'zzz', name: 'Sleepy', art: `<circle cx="27" cy="38" r="21" fill="#ffd43b" stroke="#e8a900" stroke-width="2"/><path d="M15 34q4 4 8 0M30 34q4 4 8 0" stroke="#5c3d00" stroke-width="2.5" fill="none" stroke-linecap="round"/><ellipse cx="27" cy="46" rx="4" ry="3" fill="#5c3d00"/><text x="46" y="22" font-size="16" ${TXT} fill="#4c6ef5">Z</text><text x="55" y="12" font-size="11" ${TXT} fill="#748ffc">z</text>` },
    { id: 'crown', name: 'Crown', art: '<path d="M7 47L11 20l13 12 8-18 8 18 13-12 4 27z" fill="#fcc419" stroke="#e67700" stroke-width="2" stroke-linejoin="round"/><rect x="7" y="47" width="50" height="9" rx="2" fill="#f59f00" stroke="#e67700" stroke-width="2"/><circle cx="32" cy="38" r="3.5" fill="#fa5252"/><circle cx="18" cy="40" r="2.5" fill="#4dabf7"/><circle cx="46" cy="40" r="2.5" fill="#51cf66"/>' },
    { id: 'star', name: 'Star', art: `<polygon points="${star(32, 33, 28, 12, 5)}" fill="#fcc419" stroke="#e67700" stroke-width="2.5" stroke-linejoin="round"/><path d="M26 28l4-5" stroke="#fff3bf" stroke-width="3" stroke-linecap="round"/>` },
    { id: 'diamond', name: 'Diamond', art: '<polygon points="18,12 46,12 58,26 32,57 6,26" fill="#66d9e8" stroke="#1098ad" stroke-width="2" stroke-linejoin="round"/><polygon points="6,26 58,26 32,57" fill="#3bc9db"/><polygon points="18,12 32,26 46,12" fill="#99e9f2"/><path d="M18 12l14 14 14-14M6 26h52M32 26v31" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.4"/>' },
    { id: 'rocket', name: 'Rocket', art: '<path d="M32 4c11 8 14 26 9 42H23C18 30 21 12 32 4z" fill="#f1f3f5" stroke="#adb5bd" stroke-width="2"/><path d="M32 4c6 4 9 10 10 17H22c1-7 4-13 10-17z" fill="#fa5252"/><circle cx="32" cy="29" r="5" fill="#4dabf7" stroke="#1c7ed6" stroke-width="2"/><path d="M23 38l-9 10 9-2zM41 38l9 10-9-2z" fill="#fa5252"/><path d="M26 46q6 16 12 0z" fill="#ff922b"/><path d="M29 46q3 8 6 0z" fill="#ffd43b"/>' },
    { id: 'trophy', name: 'Trophy', art: '<path d="M18 8h28v18c0 10-6 16-14 16S18 36 18 26z" fill="#fcc419" stroke="#e67700" stroke-width="2"/><path d="M18 14H8c0 10 4 15 11 16M46 14h10c0 10-4 15-11 16" fill="none" stroke="#e67700" stroke-width="3" stroke-linecap="round"/><rect x="28" y="42" width="8" height="9" fill="#f59f00"/><rect x="20" y="51" width="24" height="7" rx="2" fill="#e67700"/><path d="M25 14v14" stroke="#fff3bf" stroke-width="3" stroke-linecap="round"/>' },
    { id: 'fireworks', name: 'Fireworks', art: '<rect x="4" y="4" width="56" height="56" rx="14" fill="#1c1c3a"/><g stroke-width="3" stroke-linecap="round"><path d="M32 14v8M32 42v8M14 32h8M42 32h8M19 19l6 6M39 39l6 6M45 19l-6 6M25 39l-6 6" stroke="#fcc419"/><path d="M14 12v4M12 14h4M52 48v4M50 50h4" stroke="#ff6b6b"/><path d="M50 14l2 2M12 50l2 2" stroke="#4dabf7"/></g><circle cx="32" cy="32" r="3.5" fill="#fff"/>' },
];

/* Exclusive stickers: the only way to get them is the daily chest (ids must match economy.CHEST_STICKERS).
   They are kept apart from STICKER_DEFS so they never show up in the free/premium pickers or in the alert editor. */
const CHEST_STICKER_DEFS = [
    { id: 'ghost', name: 'Ghost', art: '<path d="M14 56V30C14 15 22 8 32 8s18 7 18 22v26l-6-5-6 5-6-5-6 5-6-5z" fill="#f1f3f5" stroke="#ced4da" stroke-width="2" stroke-linejoin="round"/><ellipse cx="25" cy="30" rx="3.5" ry="5" fill="#343a40"/><ellipse cx="39" cy="30" rx="3.5" ry="5" fill="#343a40"/><ellipse cx="32" cy="42" rx="4" ry="3" fill="#343a40"/><ellipse cx="19" cy="38" rx="3" ry="2" fill="#ffc9c9"/><ellipse cx="45" cy="38" rx="3" ry="2" fill="#ffc9c9"/>' },
    { id: 'pizza', name: 'Pizza', art: '<path d="M32 58L8 16Q32 4 56 16z" fill="#fcc419" stroke="#e67700" stroke-width="2" stroke-linejoin="round"/><path d="M8 16Q32 4 56 16" fill="none" stroke="#c2751c" stroke-width="6" stroke-linecap="round"/><circle cx="24" cy="24" r="4.500" fill="#e03131"/><circle cx="39" cy="26" r="4.500" fill="#e03131"/><circle cx="32" cy="39" r="4" fill="#e03131"/><circle cx="31" cy="20" r="1.500" fill="#40c057"/><circle cx="26" cy="33" r="1.500" fill="#40c057"/>' },
    { id: 'moon', name: 'Moon', art: '<rect x="4" y="4" width="56" height="56" rx="14" fill="#1c1c3a"/><path d="M40 12a20 20 0 1 0 12 30A17 17 0 0 1 40 12z" fill="#ffe066" stroke="#fab005" stroke-width="2" stroke-linejoin="round"/><path d="M27 33q3 3 6 0" stroke="#7c5a00" stroke-width="2.500" fill="none" stroke-linecap="round"/><circle cx="48" cy="18" r="1.800" fill="#fff"/><circle cx="52" cy="30" r="1.300" fill="#fff"/><circle cx="14" cy="14" r="1.300" fill="#fff"/>' },
    { id: 'alien', name: 'Alien', art: '<path d="M32 6c14 0 22 10 22 22 0 14-10 28-22 28S10 42 10 28C10 16 18 6 32 6z" fill="#69db7c" stroke="#2f9e44" stroke-width="2"/><path d="M13 27q10 3 14 14q-14 0-14-14zM51 27q-10 3-14 14q14 0 14-14z" fill="#212529"/><path d="M26 49q6 4 12 0" stroke="#2b8a3e" stroke-width="2.500" fill="none" stroke-linecap="round"/><circle cx="19" cy="31" r="1.800" fill="#fff"/><circle cx="45" cy="31" r="1.800" fill="#fff"/>' },
    { id: 'kitty', name: 'Kitty', art: '<path d="M10 28L12 8l16 10q4-1 8 0L52 8l2 20q4 6 0 14c-4 10-13 16-22 16S14 52 10 42q-4-8 0-14z" fill="#ffa94d" stroke="#e8590c" stroke-width="2" stroke-linejoin="round"/><path d="M15 14l7 5M49 14l-7 5" stroke="#ffc9c9" stroke-width="3" stroke-linecap="round"/><ellipse cx="23" cy="33" rx="3" ry="4" fill="#212529"/><ellipse cx="41" cy="33" rx="3" ry="4" fill="#212529"/><path d="M29 41h6l-3 3z" fill="#f06595"/><path d="M32 44q-3 5-7 3M32 44q3 5 7 3" stroke="#5c3d00" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M8 38l11 2M8 44l11-2M56 38l-11 2M56 44l-11-2" stroke="#fff" stroke-width="1.500" stroke-linecap="round"/>' },
    { id: 'rainbow', name: 'Rainbow', art: '<path d="M6 46a26 26 0 0 1 52 0" fill="none" stroke="#fa5252" stroke-width="6"/><path d="M12 46a20 20 0 0 1 40 0" fill="none" stroke="#fcc419" stroke-width="6"/><path d="M18 46a14 14 0 0 1 28 0" fill="none" stroke="#40c057" stroke-width="6"/><path d="M24 46a8 8 0 0 1 16 0" fill="none" stroke="#4dabf7" stroke-width="6"/><path d="M2 50q4-8 11-6q7-4 12 2zM39 46q6-6 12-2q7-2 11 6z" fill="#fff" stroke="#ced4da" stroke-width="1.500" stroke-linejoin="round"/>' },
    { id: 'robot', name: 'Robot', art: '<path d="M32 4v8" stroke="#868e96" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="5" r="3.500" fill="#fa5252"/><rect x="10" y="12" width="44" height="40" rx="9" fill="#ced4da" stroke="#868e96" stroke-width="2"/><rect x="16" y="20" width="32" height="18" rx="6" fill="#212529"/><circle cx="25" cy="29" r="4.500" fill="#4dabf7"/><circle cx="39" cy="29" r="4.500" fill="#4dabf7"/><path d="M22 45h20" stroke="#868e96" stroke-width="3" stroke-linecap="round" stroke-dasharray="3 4"/><rect x="4" y="26" width="6" height="12" rx="2" fill="#868e96"/><rect x="54" y="26" width="6" height="12" rx="2" fill="#868e96"/>' },
    { id: 'cupcake', name: 'Cupcake', art: '<path d="M14 34h36l-5 24H19z" fill="#f783ac" stroke="#d6336c" stroke-width="2" stroke-linejoin="round"/><path d="M23 36l2 20M32 36v20M41 36l-2 20" stroke="#d6336c" stroke-width="1.500"/><path d="M10 34c0-8 6-10 10-10 0-8 6-14 12-14s12 6 12 14c4 0 10 2 10 10z" fill="#ffd8a8" stroke="#e8590c" stroke-width="2" stroke-linejoin="round"/><circle cx="32" cy="9" r="4" fill="#fa5252"/><path d="M33 5q3-4 6-3" stroke="#2f9e44" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M20 28l3 2M30 24l3 2M42 28l3 2" stroke="#fa5252" stroke-width="2.500" stroke-linecap="round"/>' },
];

const stickerCache = {};
/* A GIF bought in the gallery is a sticker whose id is "g:<picture id>"; its image is the GIF the server keeps. */
const isGallerySticker = (id) => typeof id === 'string' && id.startsWith('g:');
const findSticker = (id) => STICKER_DEFS.find((s) => s.id === id) || CHEST_STICKER_DEFS.find((s) => s.id === id);
function stickerSrc(id) {
    if (isGallerySticker(id)) return `/api/gallery/${encodeURIComponent(id.slice(2))}/gif`;
    if (!stickerCache[id]) {
        const def = findSticker(id);
        if (!def) return '';
        stickerCache[id] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${def.art}</svg>`);
    }
    return stickerCache[id];
}

const stickerName = (id) => (isGallerySticker(id) ? 'GIF' : (findSticker(id) || { name: id }).name);
const stickerCost = (id) => ((state.config.economy && state.config.economy.stickers) || {})[id] || 0;
