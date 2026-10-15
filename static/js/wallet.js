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

function payoutQuote(coins) {
    const p = eco().payout;
    const gross = Math.floor((coins * p.centsPer100) / 100);
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
            : `${channel} receives ${num(n)} Yelis, worth about ${money(payoutQuote(n).gross)} when cashed out.`;
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
    donate_sent: (r) => `Donated ${r.ref}`,
    donate_received: (r) => `Received ${r.ref}`,
    payout_request: (r) => `Cash-out requested (${r.ref})`,
    payout_rejected: (r) => `Cash-out returned (${r.ref})`,
};
const dateOf = (ts) => new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

async function pageWallet(root, alive) {
    document.title = 'Wallet | Yeli';
    if (!state.me) {
        root.innerHTML = emptyState('Log in to open your wallet', 'Buy Yelis to support streamers, or cash out what you earn.', '<button type="button" class="btn btn-primary" data-auth="login">Log In</button>', 'heart');
        return;
    }
    const { wallet: w, history, payouts } = await api('/wallet');
    if (!alive()) return;
    setBalance(w.bought);
    const e = eco();
    const years = [0, 1, 2].map((i) => new Date().getFullYear() - i);
    const waiting = payouts.some((p) => p.status === 'requested' || p.status === 'approved');

    root.innerHTML = `
    <div class="page-head"><h1 class="page-title">Wallet</h1>
        <p class="page-sub">Yelis are Yeli\u2019s coins. Buy them to support streamers; streamers can cash out what they receive.</p></div>
    ${testBanner()}
    <div class="wallet-cards">
        <div class="stat"><span class="stat-label">Yelis to spend</span><span class="stat-value">${coinImg(22)} ${num(w.bought)}</span></div>
        <div class="stat"><span class="stat-label">Earned</span><span class="stat-value">${coinImg(22)} ${num(w.earned)}</span>
            <span class="stat-sub">${num(w.cashable)} ready \u00b7 ${num(w.on_hold)} on hold</span></div>
        <div class="stat"><span class="stat-label">Waiting for payment</span><span class="stat-value">${coinImg(22)} ${num(w.pending)}</span></div>
        <div class="stat"><span class="stat-label">Paid out</span><span class="stat-value">${coinImg(22)} ${num(w.paid_out)}</span></div>
    </div>

    <section class="section"><h2 class="section-title">Buy Yelis</h2>
        <div class="pack-grid">${e.packs.map((p) => `
            <div class="pack">
                <div class="pack-coins">${coinImg(26)} ${num(p.coins)}</div>
                <div class="pack-price">${money(p.price_cents)}</div>
                <button type="button" class="btn btn-primary btn-block" data-buy="${esc(p.id)}">Buy</button>
            </div>`).join('')}</div>
        <p class="hint">${e.taxIncluded ? 'Prices include tax. ' : ''}Yelis you buy can be sent to streamers and used for premium stickers. They can\u2019t be cashed out.</p>
    </section>

    <section class="section"><h2 class="section-title">Cash out</h2>
        <div class="panel">
            <p class="muted">100 earned Yelis = ${money(e.payout.centsPer100)}. Minimum ${num(e.payout.minCoins)} Yelis. New donations are held ${e.payout.holdDays} days before you can cash them out.
                You have <strong>${num(w.cashable)}</strong> Yelis ready (${money(payoutQuote(w.cashable).gross)}).</p>
            ${waiting ? '<p class="notice">You already have a cash-out waiting. We\u2019ll update its status below once it\u2019s paid.</p>' : `
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
    </section>

    <section class="section"><h2 class="section-title">Taxes and statements</h2>
        <div class="panel"><p class="muted">What you earn from donations may be taxable income where you live, and you\u2019re responsible for reporting it. Download a yearly statement of everything you received and cashed out. This isn\u2019t tax advice; ask an accountant if you\u2019re unsure.</p>
            <div class="row">${years.map((y) => `<a class="btn btn-secondary" href="/api/wallet/statement.csv?year=${y}" download>Statement ${y}</a>`).join('')}</div></div>
    </section>

    <section class="section"><h2 class="section-title">History</h2>
        ${history.length ? `<ul class="history">${history.map((r) => `<li><span>${esc((LEDGER_TEXT[r.kind] || (() => r.kind))(r))}<small class="muted"> ${dateOf(r.created_at)}</small></span>
            <strong class="${r.coins < 0 ? 'neg' : 'pos'}">${r.coins > 0 ? '+' : ''}${num(r.coins)}</strong></li>`).join('')}</ul>` : '<p class="muted">Nothing yet.</p>'}
    </section>`;

    root.addEventListener('click', async (ev) => {
        const buy = ev.target.closest('[data-buy]');
        if (!buy) return;
        buy.disabled = true;
        try {
            const r = await api('/wallet/buy', { method: 'POST', body: { pack: buy.dataset.buy } });
            openCheckout(r.purchase, () => route());
        } catch (err) { toast(err.message); } finally { buy.disabled = false; }
    });

    const form = $('#payoutForm');
    if (form) {
        const quote = $('#poQuote');
        const paint = () => {
            const n = Number(form.coins.value) || 0;
            const q = payoutQuote(n);
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
        <div class="table-wrap"><table class="table"><thead><tr><th>Pack</th><th>Price</th><th>Tax</th><th>Fees</th><th>Net</th><th>Payout value</th><th>Margin</th></tr></thead><tbody>
        ${s.pack_margins.map((m) => `<tr><td>${num(m.coins)} Yelis</td><td>${cur(m.gross_cents)}</td><td>${cur(m.tax_cents)}</td><td>${cur(m.fee_cents)}</td><td>${cur(m.net_cents)}</td><td>${cur(m.payout_cents)}</td>
            <td class="${m.margin_cents < 0 ? 'neg' : 'pos'}">${cur(m.margin_cents)}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="hint">Margin = what you keep from a pack after tax and fees, if all its Yelis are cashed out. A negative number means that pack loses money: raise the price or lower YELI_PAYOUT_CENTS_PER_100.</p>
    </section>`;

    root.addEventListener('click', async (ev) => {
        const b = ev.target.closest('[data-act]');
        if (!b) return;
        const row = b.closest('tr');
        b.disabled = true;
        try {
            await api(`/admin/payouts/${row.dataset.id}`, { method: 'POST', body: { action: b.dataset.act } });
            route();
        } catch (e2) { toast(e2.message); b.disabled = false; }
    });
}
