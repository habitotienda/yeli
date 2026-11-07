'use strict';

/* =========================================================================
   Badges: the little custom icons next to a name.
     verified  - given by an admin to an account (the check seal)
     admin     - the people who run Yeli (also moderators in every chat, automatically)
     streamer  - the owner of the channel, shown in their own chat
     mod       - picked by the streamer for that channel's chat
     bronze / silver / gold - the Chat badge upgrade
     bot       - the channel bot
   The icons live in one hidden SVG sprite, so every badge is a tiny <use> (cheap, and the same everywhere).
   ========================================================================= */
const BADGE_SPRITE = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs><linearGradient id="yb-g-verified" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6cc4ff"/><stop offset="1" stop-color="#1c7ed6"/></linearGradient><linearGradient id="yb-g-admin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7a8f"/><stop offset="1" stop-color="#c2255c"/></linearGradient><linearGradient id="yb-g-streamer" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b97bff"/><stop offset="1" stop-color="#ff4fa3"/></linearGradient><linearGradient id="yb-g-mod" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4ee39a"/><stop offset="1" stop-color="#0f9b4f"/></linearGradient><linearGradient id="yb-g-bronze" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f5b27a"/><stop offset="1" stop-color="#9c5217"/></linearGradient><linearGradient id="yb-g-silver" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#8794a6"/></linearGradient><linearGradient id="yb-g-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0a0"/><stop offset="1" stop-color="#eda100"/></linearGradient><linearGradient id="yb-g-bot" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#74e8ff"/><stop offset="1" stop-color="#1a91cf"/></linearGradient></defs><symbol id="yb-verified" viewBox="0 0 24 24"><rect x="3.6" y="3.6" width="16.8" height="16.8" rx="5" fill="url(#yb-g-verified)"/><rect x="3.6" y="3.6" width="16.8" height="16.8" rx="5" transform="rotate(45 12 12)" fill="url(#yb-g-verified)"/><path d="M7.9 12.4l2.9 2.9 5.5-5.9" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4"/></symbol><symbol id="yb-admin" viewBox="0 0 24 24"><path d="M12 2.4l8 3v6.2c0 4.9-3.3 8.5-8 10-4.7-1.5-8-5.1-8-10V5.4z" fill="url(#yb-g-admin)"/><path d="M12 2.4l8 3v6.2c0 4.9-3.3 8.5-8 10-4.7-1.5-8-5.1-8-10V5.4z" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1"/><polygon points="12.00,6.80 13.29,10.02 16.76,10.25 14.09,12.48 14.94,15.85 12.00,14.00 9.06,15.85 9.91,12.48 7.24,10.25 10.71,10.02" fill="#fff"/></symbol><symbol id="yb-streamer" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="url(#yb-g-streamer)"/><circle cx="12" cy="12" r="2.3" fill="#fff"/><path d="M8.1 8.1a5.5 5.5 0 0 0 0 7.8M15.9 8.1a5.5 5.5 0 0 1 0 7.8" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.9"/><path d="M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" opacity=".55"/></symbol><symbol id="yb-mod" viewBox="0 0 24 24"><path d="M12 2.4l8 3v6.2c0 4.9-3.3 8.5-8 10-4.7-1.5-8-5.1-8-10V5.4z" fill="url(#yb-g-mod)"/><path d="M12 2.4l8 3v6.2c0 4.9-3.3 8.5-8 10-4.7-1.5-8-5.1-8-10V5.4z" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1"/><path d="M12 5.6l1.6 2.2v5.6h-3.2V7.8z" fill="#fff"/><rect x="8.6" y="13.2" width="6.8" height="1.8" rx=".9" fill="#fff"/><rect x="11.1" y="14.8" width="1.8" height="3" rx=".6" fill="#fff"/></symbol><symbol id="yb-bronze" viewBox="0 0 24 24"><path d="M7 2.4h3.7l1.3 6.4-3.3 1z" fill="#c9722b"/><path d="M17 2.4h-3.7L12 8.8l3.3 1z" fill="#c9722b" opacity=".85"/><circle cx="12" cy="14.6" r="6.9" fill="url(#yb-g-bronze)"/><circle cx="12" cy="14.6" r="6.9" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="1"/><circle cx="12" cy="14.6" r="4.9" fill="none" stroke="rgba(255,255,255,.65)" stroke-width="1"/><polygon points="12.00,11.50 12.79,13.51 14.95,13.64 13.28,15.02 13.82,17.11 12.00,15.95 10.18,17.11 10.72,15.02 9.05,13.64 11.21,13.51" fill="#fff" fill-opacity=".92"/></symbol><symbol id="yb-silver" viewBox="0 0 24 24"><path d="M7 2.4h3.7l1.3 6.4-3.3 1z" fill="#aeb8c6"/><path d="M17 2.4h-3.7L12 8.8l3.3 1z" fill="#aeb8c6" opacity=".85"/><circle cx="12" cy="14.6" r="6.9" fill="url(#yb-g-silver)"/><circle cx="12" cy="14.6" r="6.9" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="1"/><circle cx="12" cy="14.6" r="4.9" fill="none" stroke="rgba(255,255,255,.65)" stroke-width="1"/><polygon points="12.00,11.50 12.79,13.51 14.95,13.64 13.28,15.02 13.82,17.11 12.00,15.95 10.18,17.11 10.72,15.02 9.05,13.64 11.21,13.51" fill="#fff" fill-opacity=".92"/></symbol><symbol id="yb-gold" viewBox="0 0 24 24"><path d="M7 2.4h3.7l1.3 6.4-3.3 1z" fill="#f2b01e"/><path d="M17 2.4h-3.7L12 8.8l3.3 1z" fill="#f2b01e" opacity=".85"/><circle cx="12" cy="14.6" r="6.9" fill="url(#yb-g-gold)"/><circle cx="12" cy="14.6" r="6.9" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="1"/><circle cx="12" cy="14.6" r="4.9" fill="none" stroke="rgba(255,255,255,.65)" stroke-width="1"/><polygon points="12.00,11.50 12.79,13.51 14.95,13.64 13.28,15.02 13.82,17.11 12.00,15.95 10.18,17.11 10.72,15.02 9.05,13.64 11.21,13.51" fill="#fff" fill-opacity=".92"/></symbol><symbol id="yb-bot" viewBox="0 0 24 24"><path d="M12 7.2V4.2" stroke="url(#yb-g-bot)" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="3.5" r="1.6" fill="#ffd24d"/><rect x="3" y="11" width="2.2" height="4.6" rx="1.1" fill="url(#yb-g-bot)"/><rect x="18.8" y="11" width="2.2" height="4.6" rx="1.1" fill="url(#yb-g-bot)"/><rect x="4.6" y="7.2" width="14.8" height="12.6" rx="4.4" fill="url(#yb-g-bot)"/><circle cx="9.1" cy="12.8" r="1.9" fill="#fff"/><circle cx="14.9" cy="12.8" r="1.9" fill="#fff"/><circle cx="9.1" cy="12.8" r=".8" fill="#0b4a6e"/><circle cx="14.9" cy="12.8" r=".8" fill="#0b4a6e"/><path d="M9.2 16.7h5.6" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6"/></symbol></svg>';

const BADGES = {
    admin: 'Admin',
    verified: 'Verified',
    streamer: 'Streamer',
    mod: 'Moderator',
    bronze: 'Bronze supporter',
    silver: 'Silver supporter',
    gold: 'Gold supporter',
    bot: 'Bot',
};
const BADGE_TIERS = ['', 'bronze', 'silver', 'gold'];

(function mountBadgeSprite() {
    if (document.getElementById('yeliBadgeSprite')) return;
    const holder = document.createElement('div');
    holder.id = 'yeliBadgeSprite';
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    holder.innerHTML = BADGE_SPRITE;
    (document.body || document.documentElement).prepend(holder);
})();

/** One badge: badgeHtml('verified', 16) */
function badgeHtml(key, size = 16) {
    const label = BADGES[key];
    if (!label) return '';
    return `<span class="ybadge ybadge-${key}" role="img" title="${label}" aria-label="${label}" style="--bs:${size}px"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#yb-${key}"/></svg></span>`;
}

/** All the badges of someone, in a fixed order. u = { admin, verified, streamer, mod, tier (0-3), bot } */
function userBadgesHtml(u, size = 16) {
    if (!u) return '';
    const keys = [];
    if (u.bot) keys.push('bot');
    else {
        if (u.admin) keys.push('admin');
        if (u.verified) keys.push('verified');
        if (u.streamer) keys.push('streamer');
        else if (u.mod) keys.push('mod');
        if (u.tier && BADGE_TIERS[u.tier]) keys.push(BADGE_TIERS[u.tier]);
    }
    return keys.length ? `<span class="ybadges">${keys.map((k) => badgeHtml(k, size)).join('')}</span>` : '';
}

/** For channel/profile names: only the badges that belong to the account itself (admin and verified). */
const accountBadgesHtml = (ch, size = 16) => userBadgesHtml({ admin: ch && ch.admin, verified: ch && ch.verified }, size);
