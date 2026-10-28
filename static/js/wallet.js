'use strict';

/* =========================================================================
   Wallet: buy Yelis, donate them, cash out what you earn, and the admin panel
   ========================================================================= */
const eco = () => state.config.economy;
const money = (cents) => (cents / 100).toLocaleString(undefined, { style: 'currency', currency: eco().currency });
const num = (n) => Number(n).toLocaleString();
const coinImg = (size = 16) => `<img class="coin" src="static/svg/coin.svg" alt="" width="${size}" height="${size}">`;

function setBalance(n) {
    if (!state.me) return;
    state.me.balance = n;
    renderAuth();
}

function payoutQuote(coins, rate) {
    const p = eco().payout;
    const gross = Math.floor((coins * (rate || p.rates[0])) / 100);
    const withheld = Math.round((gross * p.withholdPct));
    return { gross, withheld, fee: p.feeCents, net: Math.max(0, gross - withheld - p.feeCents) };
}

const testBanner = () => eco().mode === 'sandbox'
    ? `<div class="notice notice-test" role="note"><strong>Test mode.</strong> Yelis here are play money: nothing is charged and nothing can be paid out for real. See the README to connect real payments (needs an adult\u2019s payment account).</div>`
    : '';

function dialogShell(title, bodyHtml) {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.innerHTML = `<div class="dialog-body"><button type="button" class="dialog-close" aria-label="Close">&times;</button><h2>${esc(title)}</h2>${bodyHtml}</div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('.dialog-close')) dlg.close(); });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
    return dlg;
}

/* ---------- Donate ---------- */
function openDonate(channel) {
    if (!state.me) { openAuth('login', `Log in to support ${channel} with Yelis.`); return; }
    const e = eco();
    const presets = [50, 100, 500, 1000];
    const dlg = dialogShell(`Support ${channel}`, `
        <p class="muted">Your balance: <strong id="dnBal">${coinImg()} ${num(state.me.balance)}</strong> Yelis</p>
        <form id="donateForm" class="props-form" novalidate>
            <div class="chip-row" role="group" aria-label="Amount">${presets.map((n) => `<button type="button" class="chip" data-amt="${n}">${num(n)}</button>`).join('')}</div>
            <div class="field"><label for="dnCoins">Yelis to send</label>
                <input id="dnCoins" name="coins" type="number" inputmode="numeric" min="${e.minDonation}" max="${e.maxDonation}" step="1" value="100" required></div>
            <div class="field"><label for="dnMsg">Message (optional)</label>
                <input id="dnMsg" name="message" maxlength="100" placeholder="Say something nice" autocomplete="off"></div>
            <p class="form-error" id="dnErr" role="alert" hidden></p>
            <button type="submit" class="btn btn-primary btn-block" id="dnSend">Send Yelis</button>
            <p class="hint" id="dnHelp"></p>
        </form>`);
    const form = $('#donateForm', dlg);
    const help = $('#dnHelp', dlg);
    const err = $('#dnErr', dlg);
    const paint = () => {
        const n = Number(form.coins.value) || 0;
        help.innerHTML = n > state.me.balance
            ? `You need ${num(n - state.me.balance)} more Yelis. <a href="#/wallet" class="link-btn">Buy Yelis</a>`
            : `${channel} receives ${num(n)} Yelis.`;
    };
    form.addEventListener('input', paint);
    form.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-amt]');
        if (b) { form.coins.value = b.dataset.amt; paint(); }
    });
    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        err.hidden = true;
        const btn = $('#dnSend', dlg);
        btn.disabled = true;
        try {
            const r = await api('/wallet/donate', { method: 'POST', body: { channel, coins: Number(form.coins.value), message: form.message.value } });
            setBalance(r.balance);
            dlg.close();
            toast(`You sent ${num(r.donation.coins)} Yelis to ${channel}. Thank you!`);
        } catch (e2) {
            err.textContent = e2.message;
            err.hidden = false;
            if (e2.status === 402 && typeof e2.balance === 'number') setBalance(e2.balance);
        } finally {
            btn.disabled = false;
        }
    });
    paint();
}

/* ---------- Checkout (test mode) ---------- */
function openCheckout(purchase, done) {
    const dlg = dialogShell('Checkout', `
        <div class="order">
            <div class="order-row"><span>${coinImg()} ${num(purchase.coins)} Yelis</span><strong>${money(purchase.gross_cents)}</strong></div>
            ${eco().taxIncluded ? `<div class="order-row muted"><span>Includes tax</span><span>${money(purchase.tax_cents)}</span></div>` : ''}
        </div>
        ${testBanner()}
        <p class="hint">By buying you confirm you\u2019re allowed to make this purchase (18+, or with a parent or guardian\u2019s permission).</p>
        <button type="button" class="btn btn-primary btn-block" id="payBtn">${eco().mode === 'sandbox' ? 'Complete test payment' : 'Pay'}</button>
        <p class="form-error" id="payErr" role="alert" hidden></p>`);
    $('#payBtn', dlg).addEventListener('click', async (ev) => {
        ev.currentTarget.disabled = true;
        try {
            const r = await api(`/wallet/purchases/${purchase.id}/complete`, { method: 'POST' });
            setBalance(r.balance);
            dlg.close();
            toast(`+${num(r.coins)} Yelis added to your wallet.`);
            if (done) done();
        } catch (e) {
            $('#payErr', dlg).textContent = e.message;
            $('#payErr', dlg).hidden = false;
            ev.currentTarget.disabled = false;
        }
    });
}

/* ---------- Wallet page ---------- */
const LEDGER_TEXT = {
    purchase: (r) => `Bought ${r.ref}`,
    upgrade_points: (r) => `Upgrade points (${r.ref})`,
    donate_sent: (r) => `Donated ${r.ref}`,
    donate_received: (r) => `Received ${r.ref}`,
    payout_request: (r) => `Cash-out requested (${r.ref})`,
    payout_rejected: (r) => `Cash-out returned (${r.ref})`,
};
const dateOf = (ts) => new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

const BADGES = ['None', 'Bronze', 'Silver', 'Gold'];
const UPGRADE_ORDER = ['earnings', 'boost', 'badge', 'color'];
const NAME_SWATCHES = ['#ff6b6b', '#ffa94d', '#ffd43b', '#a9e34b', '#38d9a9', '#4dabf7', '#9775fa', '#f783ac']; // the API's JSON keys come back sorted
const upgradeValue = (track, v) => track === 'earnings' ? `${v}%` : track === 'boost' ? `${v}x` : track === 'badge' ? BADGES[v] : track === 'color' ? (v === 0 ? 'None' : v === 99 ? 'Any color' : `${v} colors`) : num(v);

function tabNav(tab) {
    return `<nav class="tabs" role="tablist" aria-label="Wallet sections">${[['buy', 'Buy Yelis'], ['upgrades', 'Upgrades'], ['cashout', 'Cash out'], ['history', 'History']]
        .map(([k, l]) => `<a role="tab" class="tab" href="#/wallet?tab=${k}" aria-selected="${k === tab}">${l}</a>`).join('')}</nav>`;
}

async function pageWallet(root, alive, params) {
    document.title = 'Wallet | Yeli';
    if (!state.me) {
        root.innerHTML = emptyState('Log in to open your wallet', 'Buy Yelis to support streamers, or cash out what you earn.', '<button type="button" class="btn btn-primary" data-auth="login">Log In</button>', 'heart');
        return;
    }
    const tab = ['buy', 'upgrades', 'cashout', 'history'].includes(params.get('tab')) ? params.get('tab') : 'buy';
    const [{ wallet: w, history, payouts }, up] = await Promise.all([api('/wallet'), tab === 'upgrades' ? api('/upgrades') : Promise.resolve(null)]);
    if (!alive()) return;
    setBalance(w.bought);
    const e = eco();
    const years = [0, 1, 2].map((i) => new Date().getFullYear() - i);
    const waiting = payouts.some((p) => p.status === 'requested' || p.status === 'approved');

    const sections = {
        buy: `
        <div class="pack-grid">${e.packs.map((p) => `
            <div class="pack">
                <div class="pack-coins">${coinImg(30)} ${num(p.coins)}</div>
                <div class="pack-price">${money(p.price_cents)}</div>
                <div class="pack-each">${money(Math.round((p.price_cents / p.coins) * 100))} per 100</div>
                <button type="button" class="btn btn-primary btn-block" data-buy="${esc(p.id)}">Buy</button>
            </div>`).join('')}</div>
        <p class="hint">${e.taxIncluded ? 'Prices include tax. ' : ''}Yelis you buy can be sent to streamers, used for premium stickers and for upgrade points. They can\u2019t be cashed out.</p>`,

        upgrades: up ? `
        <div class="points-bar">
            <div><span class="stat-label">Upgrade points</span><span class="stat-value">${num(up.points)}</span></div>
            <form id="pointsForm" class="points-form" novalidate>
                <label class="sr-only" for="ptN">Points</label>
                <select id="ptN" name="points">${[1, 5, 10, 25].map((n) => `<option value="${n}">${n} point${n > 1 ? 's' : ''} \u00b7 ${num(n * e.pointCost)} Yelis</option>`).join('')}</select>
                <label class="sr-only" for="ptSrc">Pay with</label>
                <select id="ptSrc" name="source">
                    <option value="bought">Pay with spendable Yelis (${num(up.wallet.bought)})</option>
                    <option value="earned">Pay with earned Yelis (${num(up.wallet.cashable)})</option>
                </select>
                <button type="submit" class="btn btn-primary">Buy points</button>
            </form>
        </div>
        <p class="form-error" id="ptErr" role="alert" hidden></p>
        <div class="upgrade-grid">${UPGRADE_ORDER.filter((k) => e.upgrades[k]).map((key) => [key, e.upgrades[key]]).map(([key, u]) => {
            const level = up.levels[key];
            const max = u.costs.length;
            const cost = u.costs[level];
            const can = level < max && up.points >= cost;
            return `<div class="upgrade">
                <div class="upgrade-head"><strong>${esc(u.name)}</strong><span class="muted">Level ${level}/${max}</span></div>
                <p class="muted">${esc(u.desc)}</p>
                <div class="steps" aria-hidden="true">${Array.from({ length: max }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('')}</div>
                <div class="upgrade-vals"><span>${esc(upgradeValue(key, u.values[level]))}</span>${level < max ? `<span class="arrow">\u2192</span><strong>${esc(upgradeValue(key, u.values[level + 1]))}</strong>` : '<strong>Max</strong>'}</div>
                <button type="button" class="btn ${can ? 'btn-primary' : 'btn-secondary'}" data-level="${key}" ${can ? '' : 'disabled'}>${level < max ? `Upgrade \u00b7 ${cost} point${cost > 1 ? 's' : ''}` : 'Maxed out'}</button>
            </div>`;
        }).join('')}</div>
        ${up.levels.color > 0 ? `<div class="panel color-panel"><strong>Your chat name color</strong>
            <div class="swatches" role="group" aria-label="Name color">
                ${(up.palette || NAME_SWATCHES).map((c) => `<button type="button" class="swatch${up.color === c ? ' on' : ''}" data-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join('')}
                <button type="button" class="obs-btn" data-color="">Default</button>
            </div>
            ${up.palette === null ? `<div class="field"><label for="clrAny">Any color</label><input id="clrAny" type="color" value="${esc(up.color || '#ffffff')}"></div>` : ''}</div>` : ''}
        <p class="hint">Points are bought with Yelis (${num(e.pointCost)} each). Earnings lifts your cash-out rate from ${e.payout.rates[0]}% up to ${e.payout.rates[e.payout.rates.length - 1]}%.</p>
        <div class="notice"><strong>Free points.</strong> When a viewer with an account keeps watching your stream for ${Math.round(state.config.freePoint.seconds / 360) / 10} hour without leaving, you earn 1 upgrade point (up to ${state.config.freePoint.perDay} a day, one per viewer per day, not from your own network). The studio shows the countdown.</div>` : '',

        cashout: `
        <div class="panel">
            <p class="muted">100 earned Yelis = <strong>${money(w.rate)}</strong> at your Earnings level (it goes up to ${money(e.payout.rates[e.payout.rates.length - 1])}: see Upgrades).
                Minimum ${num(e.payout.minCoins)} Yelis. New donations are held ${e.payout.holdDays} days. You have <strong>${num(w.cashable)}</strong> Yelis ready (${money(payoutQuote(w.cashable, w.rate).gross)}).</p>
            ${waiting ? '<p class="notice">You already have a cash-out waiting. Its status will update below once it\u2019s paid.</p>' : `
            <form id="payoutForm" class="props-form" novalidate>
                <div class="field-row">
                    <div class="field"><label for="poCoins">Yelis to cash out</label>
                        <input id="poCoins" name="coins" type="number" inputmode="numeric" min="${e.payout.minCoins}" max="${w.cashable}" step="1" value="${w.cashable >= e.payout.minCoins ? w.cashable : ''}" required></div>
                    <div class="field"><label for="poMethod">Pay me with</label>
                        <select id="poMethod" name="method"><option value="paypal">PayPal</option><option value="bank">Bank transfer</option><option value="other">Other</option></select></div>
                </div>
                <div class="field"><label for="poDest">Where to send it</label>
                    <input id="poDest" name="destination" maxlength="120" placeholder="PayPal email, bank alias or account" autocomplete="off" required>
                    <small>Only you and the site owner can see this.</small></div>
                <dl class="quote" id="poQuote"></dl>
                <p class="form-error" id="poErr" role="alert" hidden></p>
                <button type="submit" class="btn btn-primary" id="poBtn">Request cash-out</button>
            </form>`}
        </div>
        ${payouts.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Yelis</th><th>You receive</th><th>Status</th></tr></thead><tbody>
            ${payouts.map((p) => `<tr><td>${dateOf(p.created_at)}</td><td>${num(p.coins)}</td><td>${money(p.net_cents)}</td>
                <td><span class="badge badge-${esc(p.status)}">${esc(p.status)}</span>${p.test ? ' <span class="badge">test</span>' : ''}${p.note ? ` <small class="muted">${esc(p.note)}</small>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : ''}
        <h2 class="section-title sub">Taxes and statements</h2>
        <div class="panel"><p class="muted">What you earn from donations may be taxable income where you live, and you\u2019re responsible for reporting it. Download a yearly statement of what you received and cashed out. This isn\u2019t tax advice; ask an accountant if you\u2019re unsure.</p>
            <div class="row">${years.map((y) => `<a class="btn btn-secondary" href="/api/wallet/statement.csv?year=${y}" download>Statement ${y}</a>`).join('')}</div></div>`,

        history: history.length ? `<ul class="history">${history.map((r) => `<li><span>${esc((LEDGER_TEXT[r.kind] || (() => r.kind))(r))}<small class="muted"> ${dateOf(r.created_at)}</small></span>
            <strong class="${r.coins < 0 ? 'neg' : 'pos'}">${r.coins > 0 ? '+' : ''}${num(r.coins)}</strong></li>`).join('')}</ul>` : '<p class="muted">Nothing yet.</p>',
    };

    root.innerHTML = `
    <div class="page-head"><h1 class="page-title">Wallet</h1></div>
    ${testBanner()}
    <div class="wallet-cards">
        <div class="stat"><span class="stat-label">Yelis to spend</span><span class="stat-value">${coinImg(24)} ${num(w.bought)}</span></div>
        <div class="stat"><span class="stat-label">Earned</span><span class="stat-value">${coinImg(24)} ${num(w.earned)}</span><span class="stat-sub">${num(w.cashable)} ready \u00b7 ${num(w.on_hold)} on hold</span></div>
        <div class="stat"><span class="stat-label">Waiting for payment</span><span class="stat-value">${coinImg(24)} ${num(w.pending)}</span></div>
        <div class="stat"><span class="stat-label">Paid out</span><span class="stat-value">${coinImg(24)} ${num(w.paid_out)}</span></div>
    </div>
    ${tabNav(tab)}
    <section class="tab-body" role="tabpanel">${sections[tab]}</section>`;

    root.onclick = async (ev) => { // onclick, not addEventListener: the container is reused by every page
        const buy = ev.target.closest('[data-buy]');
        const lvl = ev.target.closest('[data-level]');
        const clr = ev.target.closest('[data-color]');
        if (clr) {
            try { const r = await api('/me/color', { method: 'POST', body: { color: clr.dataset.color } }); state.me = { ...state.me, ...r.user }; route(); }
            catch (err) { toast(err.message); }
            return;
        }
        if (buy) {
            buy.disabled = true;
            try { openCheckout((await api('/wallet/buy', { method: 'POST', body: { pack: buy.dataset.buy } })).purchase, () => route()); }
            catch (err) { toast(err.message); } finally { buy.disabled = false; }
        } else if (lvl && !lvl.disabled) {
            lvl.disabled = true;
            try { const r = await api('/upgrades/level', { method: 'POST', body: { track: lvl.dataset.level } }); toast(`${eco().upgrades[r.track].name} is now level ${r.level}.`); route(); }
            catch (err) { toast(err.message); lvl.disabled = false; }
        }
    };

    const any = $('#clrAny');
    if (any) any.addEventListener('change', async () => {
        try { const r = await api('/me/color', { method: 'POST', body: { color: any.value } }); state.me = { ...state.me, ...r.user }; toast('Color saved.'); route(); }
        catch (err) { toast(err.message); }
    });
    const pts = $('#pointsForm');
    if (pts) {
        pts.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const err = $('#ptErr');
            err.hidden = true;
            try {
                const r = await api('/upgrades/points', { method: 'POST', body: { points: Number(pts.points.value), source: pts.source.value } });
                if (pts.source.value === 'bought') setBalance(r.wallet);
                toast(`You now have ${num(r.points)} upgrade points.`);
                route();
            } catch (e2) { err.textContent = e2.message; err.hidden = false; }
        });
    }

    const form = $('#payoutForm');
    if (form) {
        const quote = $('#poQuote');
        const paint = () => {
            const n = Number(form.coins.value) || 0;
            const q = payoutQuote(n, w.rate);
            quote.innerHTML = n ? `<div><dt>Value</dt><dd>${money(q.gross)}</dd></div>
                ${q.withheld ? `<div><dt>Tax withheld</dt><dd>\u2212${money(q.withheld)}</dd></div>` : ''}
                ${q.fee ? `<div><dt>Transfer fee</dt><dd>\u2212${money(q.fee)}</dd></div>` : ''}
                <div class="quote-total"><dt>You receive</dt><dd>${money(q.net)}</dd></div>` : '';
        };
        form.addEventListener('input', paint);
        paint();
        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const err = $('#poErr');
            err.hidden = true;
            try {
                await api('/wallet/payout', { method: 'POST', body: { coins: Number(form.coins.value), method: form.method.value, destination: form.destination.value } });
                toast('Cash-out requested. The site owner will review it.');
                route();
            } catch (e2) { err.textContent = e2.message; err.hidden = false; }
        });
    }
}

/* ---------- Admin ---------- */
async function pageAdmin(root, alive) {
    document.title = 'Admin | Yeli';
    if (!state.me || !state.me.is_admin) {
        root.innerHTML = emptyState('Admins only', 'Set YELI_ADMINS to your username to open this page.', '<a class="btn btn-primary" href="#/">Back to Home</a>');
        return;
    }
    const [s, list] = await Promise.all([api('/admin/summary'), api('/admin/payouts?status=requested')]);
    const approved = await api('/admin/payouts?status=approved');
    if (!alive()) return;
    const cur = (c) => (c / 100).toLocaleString(undefined, { style: 'currency', currency: s.currency });
    const open = [...list.payouts, ...approved.payouts];

    root.innerHTML = `
    <div class="page-head"><h1 class="page-title">Admin</h1><p class="page-sub">Payments are in <strong>${esc(s.mode)}</strong> mode.</p></div>
    ${s.mode === 'sandbox' ? '<div class="notice notice-test">Test mode: these numbers are play money.</div>' : ''}
    <div class="wallet-cards">
        <div class="stat"><span class="stat-label">Sales (gross)</span><span class="stat-value">${cur(s.purchases.gross_cents)}</span><span class="stat-sub">${s.purchases.count} purchases \u00b7 ${num(s.purchases.coins)} Yelis</span></div>
        <div class="stat"><span class="stat-label">Tax to set aside</span><span class="stat-value">${cur(s.purchases.tax_cents)}</span></div>
        <div class="stat"><span class="stat-label">Processor fees (est.)</span><span class="stat-value">${cur(s.purchases.fee_cents)}</span></div>
        <div class="stat"><span class="stat-label">Net of tax and fees</span><span class="stat-value">${cur(s.purchases.net_cents)}</span></div>
        <div class="stat"><span class="stat-label">Owed to streamers</span><span class="stat-value">${cur(s.owed_to_streamers_cents)}</span><span class="stat-sub">${num(s.donated_coins)} Yelis donated</span></div>
        <div class="stat"><span class="stat-label">Estimated margin</span><span class="stat-value ${s.estimated_margin_cents < 0 ? 'neg' : 'pos'}">${cur(s.estimated_margin_cents)}</span><span class="stat-sub">if every donated Yeli is cashed out</span></div>
        <div class="stat"><span class="stat-label">Unspent in wallets</span><span class="stat-value">${num(s.coins_in_wallets)}</span><span class="stat-sub">Yelis still to be delivered</span></div>
        <div class="stat"><span class="stat-label">Paid out</span><span class="stat-value">${cur(s.paid_out.net_cents)}</span></div>
    </div>

    <section class="section"><h2 class="section-title">Cash-out requests</h2>
        ${open.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>User</th><th>Yelis</th><th>Send</th><th>To</th><th>Status</th><th></th></tr></thead><tbody>
        ${open.map((p) => `<tr data-id="${p.id}"><td>${esc(p.username)}${p.test ? ' <span class="badge">test</span>' : ''}</td><td>${num(p.coins)}</td><td>${cur(p.net_cents)}</td>
            <td>${esc(p.method)}: <code>${esc(p.destination)}</code></td><td><span class="badge badge-${esc(p.status)}">${esc(p.status)}</span></td>
            <td class="actions">${p.status === 'requested' ? '<button type="button" class="obs-btn" data-act="approve">Approve</button>' : ''}
                <button type="button" class="obs-btn" data-act="paid">Mark paid</button><button type="button" class="obs-btn" data-act="reject">Reject</button></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">No cash-outs waiting.</p>'}
        <p class="hint">Pay the money yourself (PayPal, bank transfer\u2026), then press <em>Mark paid</em>. Rejecting returns the Yelis to the streamer.</p>
    </section>

    <section class="section"><h2 class="section-title">Pack margins</h2>
        <div class="table-wrap"><table class="table"><thead><tr><th>Pack</th><th>Price</th><th>Tax</th><th>Fees</th><th>Net</th><th>Payout (50% / 80%)</th><th>Margin (50% / 80%)</th></tr></thead><tbody>
        ${s.pack_margins.map((m) => `<tr><td>${num(m.coins)} Yelis</td><td>${cur(m.gross_cents)}</td><td>${cur(m.tax_cents)}</td><td>${cur(m.fee_cents)}</td><td>${cur(m.net_cents)}</td>
            <td>${cur(m.payout_min_cents)} / ${cur(m.payout_max_cents)}</td>
            <td><span class="${m.margin_min_cents < 0 ? 'neg' : 'pos'}">${cur(m.margin_min_cents)}</span> / <span class="${m.margin_max_cents < 0 ? 'neg' : 'pos'}">${cur(m.margin_max_cents)}</span></td></tr>`).join('')}
        </tbody></table></div>
        <p class="hint">Margin = what you keep from a pack after tax and fees, if all its Yelis are cashed out. A negative number means that pack loses money at that Earnings level: raise the price or lower YELI_EARN_RATES.</p>
    </section>`;

    root.onclick = async (ev) => {
        const b = ev.target.closest('[data-act]');
        if (!b) return;
        const row = b.closest('tr');
        b.disabled = true;
        try {
            await api(`/admin/payouts/${row.dataset.id}`, { method: 'POST', body: { action: b.dataset.act } });
            route();
        } catch (e2) { toast(e2.message); b.disabled = false; }
    };
}
