'use strict';

/* =========================================================================
   Built-in SVG avatars. Everyone gets one automatically (based on their name);
   in "Edit profile" you can pick another one or upload your own photo.
   ========================================================================= */
const AVATAR_PRESETS = [
    { name: 'Fox', bg: ['#ffb347', '#ff6b6b'], art: `
        <polygon points="12,10 27,26 11,34" fill="#e8590c"/><polygon points="52,10 37,26 53,34" fill="#e8590c"/>
        <path d="M10 32 Q32 8 54 32 L46 52 Q32 60 18 52 Z" fill="#ff922b"/>
        <path d="M32 60 Q20 56 18 52 L26 44 Q32 48 38 44 L46 52 Q44 56 32 60Z" fill="#fff4e6"/>
        <circle cx="24" cy="34" r="3" fill="#2b2b2b"/><circle cx="40" cy="34" r="3" fill="#2b2b2b"/>
        <ellipse cx="32" cy="47" rx="3.5" ry="2.6" fill="#2b2b2b"/>` },
    { name: 'Cat', bg: ['#7f7fd5', '#86a8e7'], art: `
        <polygon points="11,8 26,22 10,34" fill="#868e96"/><polygon points="53,8 38,22 54,34" fill="#868e96"/>
        <ellipse cx="32" cy="38" rx="22" ry="19" fill="#adb5bd"/>
        <ellipse cx="24" cy="35" rx="3.4" ry="4.4" fill="#fcc419"/><ellipse cx="40" cy="35" rx="3.4" ry="4.4" fill="#fcc419"/>
        <ellipse cx="24" cy="35" rx="1.2" ry="3.6" fill="#212529"/><ellipse cx="40" cy="35" rx="1.2" ry="3.6" fill="#212529"/>
        <polygon points="29,43 35,43 32,47" fill="#f783ac"/>
        <path d="M32 47 Q29 52 25 50 M32 47 Q35 52 39 50" stroke="#495057" stroke-width="1.4" fill="none" stroke-linecap="round"/>
        <path d="M6 40 L19 42 M6 47 L19 45 M58 40 L45 42 M58 47 L45 45" stroke="#495057" stroke-width="1.2" stroke-linecap="round"/>` },
    { name: 'Robot', bg: ['#43e97b', '#38f9d7'], art: `
        <line x1="32" y1="6" x2="32" y2="15" stroke="#343a40" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="6" r="3.2" fill="#ff6b6b"/>
        <rect x="7" y="27" width="6" height="12" rx="2" fill="#868e96"/><rect x="51" y="27" width="6" height="12" rx="2" fill="#868e96"/>
        <rect x="12" y="14" width="40" height="36" rx="9" fill="#e9ecef"/>
        <rect x="19" y="25" width="10" height="10" rx="3" fill="#1971c2"/><rect x="35" y="25" width="10" height="10" rx="3" fill="#1971c2"/>
        <rect x="21" y="40" width="22" height="5" rx="2.5" fill="#343a40"/>
        <rect x="24" y="50" width="16" height="8" fill="#868e96"/>` },
    { name: 'Alien', bg: ['#0f2027', '#2c5364'], art: `
        <circle cx="8" cy="10" r="1.2" fill="#fff"/><circle cx="56" cy="14" r="1.4" fill="#fff"/><circle cx="52" cy="56" r="1" fill="#fff"/><circle cx="10" cy="52" r="1.3" fill="#fff"/>
        <path d="M32 8 C51 8 57 29 47 45 C42 53 22 53 17 45 C7 29 13 8 32 8Z" fill="#8ce99a"/>
        <ellipse cx="22" cy="30" rx="6.5" ry="10" transform="rotate(25 22 30)" fill="#212529"/>
        <ellipse cx="42" cy="30" rx="6.5" ry="10" transform="rotate(-25 42 30)" fill="#212529"/>
        <circle cx="20" cy="26" r="1.8" fill="#fff"/><circle cx="40" cy="26" r="1.8" fill="#fff"/>
        <path d="M28 46 Q32 48 36 46" stroke="#2b8a3e" stroke-width="2" fill="none" stroke-linecap="round"/>` },
    { name: 'Ghost', bg: ['#a18cd1', '#fbc2eb'], art: `
        <path d="M14 55 V30 C14 16 22 9 32 9 C42 9 50 16 50 30 V55 L44 50 L38 55 L32 50 L26 55 L20 50 Z" fill="#fff"/>
        <circle cx="26" cy="30" r="3.2" fill="#343a40"/><circle cx="38" cy="30" r="3.2" fill="#343a40"/>
        <ellipse cx="32" cy="40" rx="3" ry="4" fill="#343a40"/>
        <circle cx="21" cy="37" r="3" fill="#ffc9de" opacity=".8"/><circle cx="43" cy="37" r="3" fill="#ffc9de" opacity=".8"/>` },
    { name: 'Bear', bg: ['#f6d365', '#fda085'], art: `
        <circle cx="16" cy="16" r="8" fill="#8d5524"/><circle cx="48" cy="16" r="8" fill="#8d5524"/>
        <circle cx="16" cy="16" r="4" fill="#c68642"/><circle cx="48" cy="16" r="4" fill="#c68642"/>
        <circle cx="32" cy="36" r="22" fill="#b07a3c"/>
        <ellipse cx="32" cy="44" rx="10" ry="8" fill="#f1d9b5"/>
        <ellipse cx="32" cy="40" rx="4" ry="3" fill="#2b2b2b"/>
        <circle cx="23" cy="31" r="2.6" fill="#2b2b2b"/><circle cx="41" cy="31" r="2.6" fill="#2b2b2b"/>
        <path d="M32 43 V46 M28 48 Q32 51 36 48" stroke="#2b2b2b" stroke-width="1.8" fill="none" stroke-linecap="round"/>` },
    { name: 'Planet', bg: ['#141e30', '#243b55'], art: `
        <circle cx="10" cy="12" r="1.3" fill="#fff"/><circle cx="54" cy="10" r="1" fill="#fff"/><circle cx="52" cy="54" r="1.4" fill="#fff"/><circle cx="12" cy="54" r="1" fill="#fff"/>
        <circle cx="32" cy="32" r="14" fill="#ffa94d"/>
        <path d="M19 28 Q32 34 45 28 M19.5 36 Q32 41 44.5 36" stroke="#f08c00" stroke-width="2.4" fill="none" stroke-linecap="round"/>
        <ellipse cx="32" cy="33" rx="26" ry="7" transform="rotate(-20 32 33)" fill="none" stroke="#ffe8cc" stroke-width="2.6"/>` },
    { name: 'Moon', bg: ['#667eea', '#764ba2'], art: `
        <path d="M40 9 A23 23 0 1 0 55 41 A19 19 0 1 1 40 9Z" fill="#ffe066"/>
        <circle cx="14" cy="14" r="1.8" fill="#fff"/><circle cx="52" cy="14" r="1.3" fill="#fff"/><circle cx="12" cy="50" r="1.5" fill="#fff"/><circle cx="54" cy="52" r="2" fill="#fff"/>` },
    { name: 'Bolt', bg: ['#f12711', '#f5af19'], art: `
        <polygon points="37,5 13,36 28,36 24,59 51,25 35,25" fill="#fff"/>` },
    { name: 'Peaks', bg: ['#74ebd5', '#9face6'], art: `
        <circle cx="47" cy="19" r="8" fill="#fff3bf"/>
        <polygon points="0,58 22,20 42,52 64,58 64,64 0,64" fill="#5c7cfa"/>
        <polygon points="0,64 14,40 30,64" fill="#364fc7"/><polygon points="26,64 46,34 64,64" fill="#3b5bdb"/>
        <polygon points="17,30 22,20 27,30 22,27" fill="#fff"/><polygon points="41,41 46,34 51,41 46,39" fill="#fff"/>` },
    { name: 'Gem', bg: ['#ff6a88', '#ff99ac'], art: `
        <polygon points="19,13 45,13 57,27 32,57 7,27" fill="#66d9e8"/>
        <polygon points="7,27 57,27 32,57" fill="#3bc9db"/>
        <polygon points="19,13 32,27 45,13" fill="#99e9f2"/>
        <polygon points="7,27 19,13 32,27" fill="#74c0fc"/><polygon points="57,27 45,13 32,27" fill="#a5d8ff"/>
        <polyline points="19,13 32,27 45,13 M7,27 H57 M32,27 L32,57" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.2"/>` },
    { name: 'Cool', bg: ['#ffe259', '#ffa751'], art: `
        <circle cx="32" cy="33" r="23" fill="#ffd43b"/>
        <rect x="12" y="25" width="18" height="12" rx="5" fill="#212529"/><rect x="34" y="25" width="18" height="12" rx="5" fill="#212529"/>
        <rect x="29" y="28" width="6" height="3" fill="#212529"/>
        <path d="M16 28 L20 28 M38 28 L42 28" stroke="#fff" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>
        <path d="M21 43 Q32 53 43 43" stroke="#5c3d00" stroke-width="3" fill="none" stroke-linecap="round"/>` },
];

const presetSvg = (i) => {
    const p = AVATAR_PRESETS[i];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.bg[0]}"/><stop offset="1" stop-color="${p.bg[1]}"/></linearGradient></defs>
        <rect width="64" height="64" fill="url(#g)"/>${p.art}</svg>`;
};

const presetCache = {};
function presetDataUri(i) {
    if (!presetCache[i]) presetCache[i] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(presetSvg(i));
    return presetCache[i];
}

/** Image URL for any user object ({username, hue, avatar}). */
function avatarSrc(c) {
    const a = c.avatar || '';
    if (a.startsWith('upload:')) return `/api/avatar/${encodeURIComponent(c.username)}?v=${encodeURIComponent(a.slice(7))}`;
    let idx = a.startsWith('preset:') ? parseInt(a.slice(7), 10) : NaN;
    if (!(idx >= 0 && idx < AVATAR_PRESETS.length)) idx = (Number(c.hue) || 0) % AVATAR_PRESETS.length;
    return presetDataUri(idx);
}

const avatar = (c, cls = '') =>
    `<img class="avatar ${cls}" src="${avatarSrc(c).replace(/"/g, '&quot;')}" alt="" decoding="async">`;
