"use strict";
/* TipDrop v1.3 — multi-chain tips and payment requests (BNB Chain, Base, Arbitrum, Polygon, Ethereum) */

const ERC20 = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];
const STORE_KEY = 'tipdrop.tips.v1';
const REQ_KEY = 'tipdrop.requests.v1';
const CHAIN_KEY = 'tipdrop.chain';
const FALLBACK_TRANSFER_GAS = { arbitrum: 600000n };

/* ============================================================
   helpers
   ============================================================ */
const app = document.getElementById('app');
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const baseUrl = () => location.href.split('#')[0];
const norm = (u, d) => ethers.formatUnits(u, d).replace(/\.0$/, '');

function fmt(units, decimals, max = 6) {
  const s = ethers.formatUnits(units, decimals);
  const [i, f = ''] = s.split('.');
  const frac = f.slice(0, max).replace(/0+$/, '');
  if (!frac && units > 0n && BigInt(i) === 0n) return '<0.' + '0'.repeat(max - 1) + '1';
  return BigInt(i).toLocaleString('en-US') + (frac ? '.' + frac : '');
}
function fmtPlain(str) { try { return fmt(ethers.parseUnits(String(str), 18), 18); } catch { return esc(str); } }
const usd = n => '$' + (Number(n) < 0.01 ? '0.01' : Number(n).toFixed(2));

const ICON = {
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3 2 20h20L12 3Z" stroke-linejoin="round"/><path d="M12 10v4M12 17.2v.1"/></svg>'
};

function toast(text) {
  const t = $('#toast'); t.textContent = text; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
async function copy(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(label); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(label); } catch { toast('Select the text and copy it manually'); }
    ta.remove();
  }
}
function busy(btn, on, text) {
  if (on) { if (!btn.disabled) btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>' + esc(text || 'Working…'); }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}
function friendly(e) {
  const m = e?.shortMessage || e?.reason || e?.info?.error?.message || e?.error?.message || e?.message || String(e);
  if (e?.code === 'ACTION_REJECTED' || e?.code === 4001 || /user rejected|user denied|rejected the request/i.test(m)) return 'You cancelled the request in your wallet.';
  if (/insufficient funds/i.test(m)) return 'Not enough coins to pay the network fee.';
  if (/could not coalesce|failed to fetch|network error/i.test(m)) return 'Could not reach the network. Check your connection and try again.';
  return m.length > 200 ? m.slice(0, 200) + '…' : m;
}
function qrSvg(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

/* ============================================================
   chains and tokens
   ============================================================ */
const chainOf = k => (CONFIG.CHAINS[k] ? { key: k, ...CONFIG.CHAINS[k] } : null);
const chainList = () => CONFIG.CHAIN_ORDER.filter(k => CONFIG.CHAINS[k]).map(chainOf);
const nativeOf = k => ({ ...chainOf(k).native, address: null, decimals: chainOf(k).native.decimals ?? 18, native: true });
const isSol = k => chainOf(k)?.type === 'solana';
const addrValid = (k, a) => (isSol(k) ? SOL.isAddress(a) : ethers.isAddress(a));
const addrNorm = (k, a) => (isSol(k) ? String(a).trim() : ethers.getAddress(a));
const addrPlaceholder = k => (isSol(k) ? 'Solana address' : '0x…');
const addrError = k => (isSol(k) ? 'Enter a valid Solana address.' : 'Enter a valid address. It starts with 0x and has 42 characters.');
const connectFor = k => (isSol(k) ? SOL.connect() : connect());
const tokensOf = k => CONFIG.ALLOW_NATIVE ? [...chainOf(k).tokens, nativeOf(k)] : [...chainOf(k).tokens];
function findToken(k, s) {
  const ch = chainOf(k); if (!ch || !s) return null;
  const v = String(s);
  if (v.toUpperCase() === ch.native.symbol.toUpperCase() || v.toUpperCase() === 'NATIVE') return nativeOf(k);
  return ch.tokens.find(t => t.symbol.toUpperCase() === v.toUpperCase() || t.address.toLowerCase() === v.toLowerCase()) || null;
}
async function resolveToken(k, s) {
  const known = findToken(k, s);
  if (known) return known;
  if (isSol(k)) throw new Error('This link uses a token this app doesn’t recognise.');
  if (!ethers.isAddress(s)) throw new Error('This link uses a token this app doesn’t recognise.');
  const c = new ethers.Contract(s, ERC20, await rpc(k));
  const [symbol, decimals] = await Promise.all([c.symbol(), c.decimals()]);
  return { symbol: String(symbol).slice(0, 12), name: String(symbol), address: ethers.getAddress(s), decimals: Number(decimals), custom: true };
}
const tokenParam = (k, tk) => tk.native ? chainOf(k).native.symbol : (findToken(k, tk.address) ? tk.symbol : tk.address);
const explorerTx = (k, h) => `<a href="${chainOf(k).explorer}/tx/${h}" target="_blank" rel="noopener">${short(h)}</a>`;
function rememberChain(k) { try { localStorage.setItem(CHAIN_KEY, k); } catch { } }
function lastChain() { let k = null; try { k = localStorage.getItem(CHAIN_KEY); } catch { } return chainOf(k) ? k : CONFIG.DEFAULT_CHAIN; }

/* ============================================================
   chain access
   ============================================================ */
const _providers = {};
async function rpc(k) {
  if (_providers[k]) return _providers[k];
  const ch = chainOf(k);
  for (const url of ch.rpcs) {
    try {
      const p = new ethers.JsonRpcProvider(url, ch.id, { staticNetwork: true });
      await Promise.race([p.getBlockNumber(), sleep(7000).then(() => { throw new Error('timeout'); })]);
      return (_providers[k] = p);
    } catch { /* try next */ }
  }
  throw new Error(`Could not reach ${ch.name}. Check your connection and try again.`);
}
async function gasPriceOf(k, p) {
  const ch = chainOf(k);
  const fd = await p.getFeeData();
  let gp = fd.gasPrice ?? ethers.parseUnits('1', 'gwei');
  if (ch.gasFloorGwei) { const f = ethers.parseUnits(ch.gasFloorGwei, 'gwei'); if (gp < f) gp = f; }
  return k === 'bsc' ? gp : gp * 12n / 10n;
}
const l1Of = k => ethers.parseEther(chainOf(k).l1FeeBuffer || '0');

async function balancesOf(k, addr, extra) {
  if (isSol(k)) return SOL.balances(addr);
  const p = await rpc(k);
  const list = [nativeOf(k), ...chainOf(k).tokens];
  if (extra && !extra.native && !list.some(t => t.address && t.address.toLowerCase() === extra.address.toLowerCase())) list.push(extra);
  return Promise.all(list.map(async token => ({
    token,
    bal: token.native ? await p.getBalance(addr) : await new ethers.Contract(token.address, ERC20, p).balanceOf(addr)
  })));
}

/* ============================================================
   wallet (MetaMask, Trust Wallet, Coinbase Wallet, Binance Wallet… any injected wallet)
   ============================================================ */
const state = { account: null, timers: [] };
const eth = () => window.ethereum || null;

async function ensureChain(e, k) {
  const ch = chainOf(k);
  const cur = await e.request({ method: 'eth_chainId' });
  if (String(cur).toLowerCase() === ch.hex) return;
  try {
    await e.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ch.hex }] });
  } catch (err) {
    const code = err?.code ?? err?.data?.originalError?.code;
    if (code !== 4902) throw err;
    await e.request({ method: 'wallet_addEthereumChain', params: [{
      chainId: ch.hex, chainName: ch.name,
      nativeCurrency: { name: ch.native.name, symbol: ch.native.symbol, decimals: 18 },
      rpcUrls: [ch.rpcs[0]], blockExplorerUrls: [ch.explorer]
    }] });
  }
}
async function connect(k) {
  const e = eth();
  if (!e) throw new Error('No wallet found in this browser. Open this page inside MetaMask, Trust Wallet, Coinbase Wallet or Binance Wallet, or paste an address instead.');
  const accs = await e.request({ method: 'eth_requestAccounts' });
  if (k) await ensureChain(e, k);
  state.account = ethers.getAddress(accs[0]);
  renderWallet();
  return state.account;
}
async function getSigner(k) {
  await connect(k);
  const bp = new ethers.BrowserProvider(eth(), 'any');
  return bp.getSigner();
}
function renderWallet() {
  const b = $('#walletBtn');
  b.innerHTML = state.account ? `<span class="dot"></span>${short(state.account)}` : 'Connect';
  b.title = state.account || 'Connect your wallet';
}
$('#walletBtn').addEventListener('click', async () => {
  if (state.account) { copy(state.account, 'Address copied'); return; }
  try { await connect(); toast('Wallet connected'); } catch (e) { toast(friendly(e)); }
});
if (eth()) {
  eth().request({ method: 'eth_accounts' }).then(a => { if (a && a[0]) { state.account = ethers.getAddress(a[0]); renderWallet(); } }).catch(() => { });
  eth().on?.('accountsChanged', a => { state.account = a && a[0] ? ethers.getAddress(a[0]) : null; renderWallet(); });
}

/* ============================================================
   fee service (pays gas so recipients pay nothing)
   ============================================================ */
const _fuel = {};
function getFuelInfo(k) {
  const hit = _fuel[k];
  if (hit && Date.now() - hit.at < 60000) return hit.p;
  const p = fetch(isSol(k) ? '/api/sol' : `${CONFIG.FUEL_URL}?chain=${encodeURIComponent(k)}`, { headers: { accept: 'application/json' } })
    .then(r => (r.ok ? r.json() : null))
    .then(j => (j && j.enabled ? j : null))
    .catch(() => null);
  _fuel[k] = { at: Date.now(), p };
  return p;
}
async function requestFuel(k, address) {
  const r = await fetch(CONFIG.FUEL_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address, chain: k }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || 'The fee service didn’t answer.');
  return j;
}
// what the sender adds so the recipient gets the full amount
function coverFor(k, fuel) {
  if (!fuel) return null;
  const c = Math.ceil(Number(fuel.fee) * (chainOf(k).expensive ? 1.3 : 1) * 100) / 100;
  return c.toFixed(2);
}

/* ============================================================
   storage of what you created (this device only)
   ============================================================ */
function loadTips() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; } }
function saveTips(a) { try { localStorage.setItem(STORE_KEY, JSON.stringify(a)); return true; } catch { return false; } }
function upsertTip(t) { const a = loadTips(); const i = a.findIndex(x => x.id === t.id); if (i >= 0) a[i] = t; else a.unshift(t); const ok = saveTips(a); updateCount(); return ok; }
function removeTip(id) { saveTips(loadTips().filter(x => x.id !== id)); updateCount(); }
function loadReqs() { try { return JSON.parse(localStorage.getItem(REQ_KEY) || '[]'); } catch { return []; } }
function saveReqs(a) { try { localStorage.setItem(REQ_KEY, JSON.stringify(a)); return true; } catch { return false; } }
function updateCount() { const n = loadTips().length + loadReqs().length; const c = $('#tipCount'); c.hidden = !n; c.textContent = n; }

/* ============================================================
   links: everything after # stays in the browser, never sent to a server
   ============================================================ */
function linkFor(t) {
  const k = t.chain || 'bsc';
  const q = new URLSearchParams();
  q.set('k', t.pk.replace(/^0x/, ''));
  if (k !== 'bsc') q.set('c', k);
  q.set('t', tokenParam(k, t.token));
  if (t.amount) q.set('a', t.amount);
  if (t.note) q.set('m', t.note);
  if (t.from) q.set('f', t.from);
  return baseUrl() + '#' + q.toString();
}
function parseLink(hash) {
  const q = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const k = q.get('k');
  if (!k || !/^[0-9a-fA-F]{64}$/.test(k)) return null;
  const c = (q.get('c') || 'bsc').toLowerCase();
  if (!chainOf(c)) return null;
  return { pk: '0x' + k, c, t: q.get('t') || 'USDT', a: (q.get('a') || '').slice(0, 40), m: (q.get('m') || '').slice(0, 200), f: (q.get('f') || '').slice(0, 40) };
}
function reqLinkFor(r) {
  const q = new URLSearchParams();
  q.set('pay', r.to);
  q.set('c', r.chain || 'bsc');
  q.set('t', r.token.native ? chainOf(r.chain || 'bsc').native.symbol : r.token.symbol);
  if (r.amount) q.set('a', r.amount);
  if (r.note) q.set('m', r.note);
  if (r.from) q.set('f', r.from);
  return baseUrl() + '#' + q.toString();
}
function parseReq(hash) {
  const q = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const to = q.get('pay');
  const c = (q.get('c') || 'bsc').toLowerCase();
  if (!to || !chainOf(c) || !addrValid(c, to)) return null;
  const a = (q.get('a') || '').trim();
  return { to: addrNorm(c, to), c, t: q.get('t') || 'USDT', a: /^\d+(\.\d+)?$/.test(a) ? a : '', m: (q.get('m') || '').slice(0, 200), f: (q.get('f') || '').slice(0, 40) };
}

/* ============================================================
   UI pieces
   ============================================================ */
function ticket({ amount, symbol, from, note, kicker = 'Tip', id, dim = false, pop = false, usd: showUsd = false, chain = 'bsc' }) {
  const ch = chainOf(chain);
  return `
  <div class="ticket${dim ? ' dim' : ''}${pop ? ' pop' : ''}">
    <div class="t-top">
      <div class="t-head"><span class="t-kicker">${esc(kicker)}</span><span class="t-net"><i class="cdot" style="background:${ch.color}"></i>${esc(ch.name)}</span></div>
      <div class="t-amount"><b>${amount}</b><span>${esc(symbol)}</span></div>
      ${showUsd ? `<div class="t-usd">≈ $${amount}</div>` : ''}
    </div>
    <div class="t-bot">
      ${from ? `<div class="t-from">From <b>${esc(from)}</b></div>` : ''}
      <p class="t-note${note ? '' : ' empty'}">${note ? esc(note) : 'No message'}</p>
      ${id ? `<div class="t-id">${esc(short(id))}</div>` : ''}
    </div>
  </div>`;
}
function chainPicker(name, selected) {
  return `<div class="chains" role="radiogroup" aria-label="Network">
    ${chainList().map(ch => `<label class="chain-opt"><input type="radio" name="${name}" value="${ch.key}" ${ch.key === selected ? 'checked' : ''}><span><i class="cdot" style="background:${ch.color}"></i>${esc(ch.name)}${ch.expensive ? '<em>high fees</em>' : ''}</span></label>`).join('')}
  </div>`;
}
function tokenPicker(name, k, selectedSymbol) {
  const tokens = tokensOf(k);
  const sel = tokens.find(t => t.symbol === selectedSymbol) ? selectedSymbol : tokens[0].symbol;
  return tokens.map(t => `<label><input type="radio" name="${name}" value="${esc(t.symbol)}" ${t.symbol === sel ? 'checked' : ''}><span>${esc(t.symbol)}</span></label>`).join('');
}
function setNav(v) { setWide(false); $$('.nav button').forEach(b => b.setAttribute('aria-current', b.dataset.nav === v ? 'page' : 'false')); }
// wide = two-column layout on PC (phones stay one column)
function setWide(on) { app.classList.toggle('wide', !!on); }
function stopTimers() { state.timers.forEach(clearInterval); state.timers = []; }
function go(hash) {
  if ((location.hash || '#') === (hash || '#')) route();
  else location.hash = hash;
}
$$('.nav button').forEach(b => b.addEventListener('click', () => go({ mytips: '#mytips', request: '#request', token: '#token' }[b.dataset.nav] || '#')));
$('#brandLink').addEventListener('click', e => { e.preventDefault(); go('#'); });

function modeSwitch(active) {
  const item = (mode, title, sub, icon) => `
    <button type="button" class="mode${active === mode ? ' on' : ''}" data-mode="${mode}" aria-pressed="${active === mode}">
      <span class="mode-ic" aria-hidden="true">${icon}</span>
      <span class="mode-txt"><b>${title}</b><small>${sub}</small></span>
    </button>`;
  return `<div class="modes" role="group" aria-label="What do you want to do?">
    ${item('send', 'Send a tip', 'Put money in a link', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>')}
    ${item('request', 'Request money', 'Get paid with a link', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 7 7 17M15 17H7V9"/></svg>')}
  </div>`;
}
app.addEventListener('click', e => {
  const m = e.target.closest('[data-mode]');
  if (m && !m.classList.contains('on')) go(m.dataset.mode === 'request' ? '#request' : '#');
});
function bindTabs(root = document) {
  $$('[data-tab]', root).forEach(b => b.onclick = () => {
    $$('[data-tab]', root).forEach(x => x.setAttribute('aria-selected', String(x === b)));
    $$('[data-pane]', root).forEach(p => p.hidden = p.dataset.pane !== b.dataset.tab);
  });
}

/* ============================================================
   VIEW: create a tip
   ============================================================ */
function viewCreate() {
  setNav('create'); setWide(true);
  const k0 = lastChain();
  app.innerHTML = `
  <div class="stack home">
    ${modeSwitch('send')}
    <section class="hero">
      <h1>Send a tip <em>as a link.</em></h1>
      <p>Put USDT, USDC or coins inside a link and send it to anyone. They paste their address and the money is theirs. They never pay a fee.</p>
    </section>

    <form class="card home-form" id="createForm" novalidate>
      <div class="field"><span class="label">Network</span>${chainPicker('chain', k0)}</div>
      <p class="warn" id="ethWarn" hidden></p>
      <div class="field">
        <span class="label" id="tokLbl">Token</span>
        <div class="seg" role="radiogroup" aria-labelledby="tokLbl" id="tokSeg">${tokenPicker('tok', k0)}</div>
      </div>

      <div class="field">
        <label class="label" for="amount">They receive</label>
        <div class="amount-wrap">
          <input id="amount" inputmode="decimal" autocomplete="off" value="${esc(chainOf(k0).presets[2] || chainOf(k0).presets[0])}" aria-describedby="amtHint">
          <span class="sym" id="amtSym"></span>
        </div>
        <div class="chips" id="chips"></div>
      </div>

      <label class="check" id="coverRow" hidden>
        <input type="checkbox" id="cover" checked>
        <span><b>Cover the <span id="feeAmt"></span> claim fee</b> so they get the full amount. You’ll send <b id="coverTotal"></b>.</span>
      </label>

      <div class="field">
        <label class="label" for="note">Message <span style="font-weight:400">· optional</span></label>
        <textarea class="input" id="note" maxlength="140" placeholder="Thanks for fixing my landing page, you're a legend"></textarea>
      </div>
      <div class="field">
        <label class="label" for="from">Your name <span style="font-weight:400">· optional</span></label>
        <input class="input" id="from" maxlength="32" placeholder="Alex" autocomplete="nickname">
      </div>

      <p class="msg err" id="createErr" hidden></p>
      <button class="btn primary wide" id="createBtn" type="submit">Create tip link</button>
      <p class="fine" id="amtHint"></p>
    </form>

    <ol class="how home-how">
      <li><i>Step 1</i><b>Pick amount</b>USDT, USDC or coins, on six networks including Solana.</li>
      <li><i>Step 2</i><b>Fund it</b>Pay from your wallet or scan a QR from any app or exchange.</li>
      <li><i>Step 3</i><b>Share link</b>They paste an address and claim, free. Unclaimed? Take it back.</li>
    </ol>
  </div>`;

  const form = $('#createForm'), err = $('#createErr');
  const showErr = m => { err.textContent = m; err.hidden = !m; };
  let fuel = null, fuelFor = null, lastChainKey = k0, lastNative = false;
  const chainKey = () => form.querySelector('input[name=chain]:checked').value;
  const selected = () => findToken(chainKey(), form.querySelector('input[name=tok]:checked').value);

  function refresh() {
    const k = chainKey(), ch = chainOf(k), t = selected();
    $('#amtSym').textContent = t.symbol;
    $('#chips').innerHTML = (t.native ? ch.presetsNative : ch.presets).map(p => `<button type="button" class="chip" data-amt="${p}">${p}</button>`).join('');
    $$('.chip', form).forEach(c => c.onclick = () => { $('#amount').value = c.dataset.amt; refresh(); $('#amount').focus(); });
    const f = fuelFor === k ? fuel : null;
    const cover = coverFor(k, f);
    const showCover = !!cover && !t.native;
    $('#coverRow').hidden = !showCover;
    if (showCover) {
      $('#feeAmt').textContent = `${cover} ${t.symbol}`;
      let total = '…';
      try { total = fmt(ethers.parseUnits($('#amount').value || '0', t.decimals) + ethers.parseUnits(cover, t.decimals), t.decimals); } catch { }
      $('#coverTotal').textContent = `${total} ${t.symbol}`;
    }
    const w = $('#ethWarn');
    w.hidden = !ch.expensive;
    if (ch.expensive) {
      w.innerHTML = `${ICON.warn}<span><b>Ethereum fees are high.</b> ${f ? `Claiming costs about ${usd(f.fee)} right now${t.native ? ', taken from what you add on top' : ' (covered by the fee above)'}.` : 'Claiming can cost $1 or more.'} The same tip on Base or Arbitrum costs cents. Smallest Ethereum tip: ${t.native ? ch.minTipNative + ' ' + t.symbol : ch.minTip + ' ' + t.symbol}.</span>`;
    }
    $('#amtHint').textContent = t.native
      ? `${ch.name}. A small network fee is added on top so they receive the full amount. Smallest tip: ${ch.minTipNative} ${t.symbol}.`
      : `${ch.name}. Only ${t.symbol} goes into the tip, they don’t need any ${ch.native.symbol}. Smallest tip: ${ch.minTip} ${t.symbol}.`;
  }
  function chainChanged() {
    const k = chainKey(), prevSym = form.querySelector('input[name=tok]:checked')?.value;
    if (isSol(k)) SOL.ready().catch(() => { });
    rememberChain(k);
    $('#tokSeg').innerHTML = tokenPicker('tok', k, prevSym);
    if (chainOf(k).expensive !== chainOf(lastChainKey).expensive || selected().native) $('#amount').value = (selected().native ? chainOf(k).presetsNative[0] : chainOf(k).presets[1] || chainOf(k).presets[0]);
    lastChainKey = k; lastNative = !!selected().native;
    refresh();
    getFuelInfo(k).then(f => { if (chainKey() === k) { fuel = f; fuelFor = k; refresh(); } });
  }
  form.addEventListener('change', e => {
    if (e.target.name === 'chain') chainChanged();
    else if (e.target.name === 'tok') {
      const t = selected();
      if (t.native !== lastNative) $('#amount').value = t.native ? chainOf(chainKey()).presetsNative[0] : chainOf(chainKey()).presets[1];
      lastNative = t.native; refresh();
    }
  });
  $('#amount').addEventListener('input', e => { e.target.value = e.target.value.replace(',', '.').replace(/[^\d.]/g, ''); refresh(); });
  refresh();
  getFuelInfo(k0).then(f => { if (chainKey() === k0) { fuel = f; fuelFor = k0; refresh(); } });

  form.addEventListener('submit', async e => {
    e.preventDefault(); showErr('');
    const btn = $('#createBtn');
    const raw = $('#amount').value.trim();
    busy(btn, true, 'Preparing…');
    try {
      const k = chainKey(), ch = chainOf(k), token = selected();
      const min = token.native ? ch.minTipNative : ch.minTip;
      if (!/^\d+(\.\d+)?$/.test(raw) || Number(raw) <= 0) throw new Error('Enter an amount greater than zero.');
      if (Number(raw) < Number(min)) throw new Error(`The smallest tip on ${ch.name} is ${min} ${token.symbol}.`);
      let units;
      try { units = ethers.parseUnits(raw, token.decimals); } catch { throw new Error(`${token.symbol} supports up to ${token.decimals} decimal places.`); }

      let deposit = units, gasTopup = null;
      if (token.native) {
        // enough for the claim transfer even if gas prices triple; leftovers go to the recipient
        if (isSol(k)) deposit += SOL.NATIVE_BUFFER;
        else { const p = await rpc(k), gp = await gasPriceOf(k, p); deposit += (21000n * gp + l1Of(k)) * 3n; }
      } else {
        const f = await getFuelInfo(k);
        const cover = coverFor(k, f);
        if (cover && $('#cover').checked) deposit += ethers.parseUnits(cover, token.decimals);
        if (!f) { // no fee service on this site: the tip must carry its own gas
          if (isSol(k)) gasTopup = SOL.FALLBACK_TOPUP;
          else { const p = await rpc(k), gp = await gasPriceOf(k, p); gasTopup = norm(((FALLBACK_TRANSFER_GAS[k] || 70000n) * gp + l1Of(k)) * 3n, 18); }
        }
      }

      // a brand-new wallet for this tip, generated locally with the browser's secure randomness
      let w;
      if (isSol(k)) { await SOL.ready(); w = SOL.newTip(); }
      else { const x = ethers.Wallet.createRandom(); w = { address: x.address, pk: x.privateKey }; }
      const tip = {
        id: w.address, pk: w.pk, address: w.address, chain: k,
        token: { symbol: token.symbol, address: token.address, decimals: token.decimals, native: !!token.native, stable: !!token.stable },
        amount: norm(units, token.decimals), deposit: norm(deposit, token.decimals), gasTopup,
        note: $('#note').value.trim(), from: $('#from').value.trim(),
        createdAt: Date.now()
      };
      tip.link = linkFor(tip);
      const saved = upsertTip(tip);
      viewFund(tip, saved);
    } catch (ex) { showErr(friendly(ex)); busy(btn, false); }
  });
}

/* ============================================================
   VIEW: fund a tip
   ============================================================ */
function viewFund(tip, saved = true) {
  stopTimers(); setNav('create');
  const k = tip.chain || 'bsc', ch = chainOf(k);
  const sym = tip.token.symbol, dec = tip.token.decimals, isNative = !!tip.token.native;
  const amt = fmtPlain(tip.amount);
  const depUnits = ethers.parseUnits(tip.deposit || tip.amount, dec);
  const dep = fmt(depUnits, dec);
  const extra = depUnits - ethers.parseUnits(tip.amount, dec);
  const topupTxt = tip.gasTopup ? fmtPlain(tip.gasTopup) : null;

  app.innerHTML = `
  <div class="stack">
    <button class="back" type="button" id="backBtn">← Start over</button>
    ${ticket({ amount: amt, symbol: sym, from: tip.from, note: tip.note, kicker: 'Waiting for deposit', id: tip.address, usd: tip.token.stable, pop: true, chain: k })}

    ${saved ? '' : `<p class="warn red">${ICON.warn}<span>Your browser blocked saving. Copy the backup link below before you send any money, or you could lose access to this tip.</span></p>`}

    <div class="card">
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected="true" data-tab="wallet" type="button">Pay with wallet</button>
        <button role="tab" aria-selected="false" data-tab="qr" type="button">Scan QR</button>
      </div>

      <div data-pane="wallet" class="stack">
        <p class="fine" style="font-size:14px">${topupTxt ? `Two confirmations in your wallet: the ${dep} ${esc(sym)} tip, then ${topupTxt} ${ch.native.symbol} so the recipient can claim for free.` : `One confirmation in your wallet, on ${esc(ch.name)}.`}</p>
        <button class="btn primary wide" id="payBtn" type="button">Pay ${dep} ${esc(sym)}</button>
        <p class="msg" id="payMsg" hidden></p>
      </div>

      <div data-pane="qr" class="stack" hidden>
        <div class="qr-row">
          <div class="qr" aria-label="QR code of the deposit address">${qrSvg(tip.address)}</div>
          <div class="qr-side">
            <span class="label">Deposit address</span>
            <div class="addr"><code>${tip.address}</code><button class="icon-btn" type="button" data-copy="${tip.address}" aria-label="Copy address">${ICON.copy}</button></div>
          </div>
        </div>
        <ul class="sendlist">
          <li><span>Send exactly</span><b>${dep} ${esc(sym)}</b></li>
          ${extra > 0n ? `<li><span>Includes the claim fee</span><b>${fmt(extra, dec)} ${esc(sym)}</b></li>` : ''}
          ${topupTxt ? `<li><span>Plus, for the claim fee</span><b>${topupTxt} ${ch.native.symbol}</b></li>` : ''}
          <li><span>Network</span><b>${esc(ch.network)}</b></li>
        </ul>
        <p class="warn">${ICON.warn}<span>Send only ${esc(sym)}, on <b>${esc(ch.name)}</b>. From an exchange, withdraw ${esc(sym)} and choose <b>${esc(ch.exchangeNetwork)}</b> as the network. If the exchange takes its fee from the amount, add it on top.</span></p>
      </div>
    </div>

    <div class="card">
      <h3>Deposit status</h3>
      <ul class="status">
        <li id="stTok" class="wait"><span class="pip"></span>${esc(sym)} tip<span class="state">Waiting…</span></li>
        ${topupTxt ? `<li id="stGas" class="wait"><span class="pip"></span>Claim fee (${ch.native.symbol})<span class="state">Waiting…</span></li>` : ''}
      </ul>
      <button class="btn primary wide" id="toLink" type="button" disabled>Get the link</button>
      <p class="fine" id="partialNote" hidden></p>
    </div>

    <details class="backup">
      <summary>Back up this tip’s link</summary>
      <div class="stack">
        <p class="fine">This link controls the money. Keep it until the tip is claimed. You can also find it later in My links on this device.</p>
        <div class="linkbox">${esc(tip.link)}</div>
        <button class="btn ghost sm" type="button" data-copy="${esc(tip.link)}">Copy backup link</button>
      </div>
    </details>
  </div>`;

  $('#backBtn').onclick = () => go('#');
  $$('[data-copy]').forEach(b => b.onclick = () => copy(b.dataset.copy));
  bindTabs();

  const needGas = !!topupTxt;
  const coinDec = nativeOf(k).decimals;
  const minGas = needGas ? ethers.parseUnits(tip.gasTopup, coinDec) / 3n : 0n;
  let funded = false;

  async function check() {
    try {
      let bal, tokBal;
      if (isSol(k)) {
        const all = await SOL.balances(tip.address);
        bal = all[0].bal;
        tokBal = isNative ? bal : (all.find(x => x.token.address === tip.token.address)?.bal || 0n);
      } else {
        const p = await rpc(k);
        bal = (isNative || needGas) ? await p.getBalance(tip.address) : 0n;
        tokBal = isNative ? bal : await new ethers.Contract(tip.token.address, ERC20, p).balanceOf(tip.address);
      }
      const sTok = $('#stTok'), sGas = $('#stGas'), btn = $('#toLink'), pn = $('#partialNote');
      if (!sTok) return;
      const tokOk = tokBal >= depUnits, tokSome = tokBal > 0n;
      sTok.className = tokOk ? 'ok' : 'wait';
      sTok.querySelector('.state').textContent = tokOk ? `Received ${fmt(tokBal, dec)}` : tokSome ? `${fmt(tokBal, dec)} of ${dep}` : 'Waiting…';
      let gasOk = true;
      if (needGas) {
        gasOk = bal >= minGas;
        sGas.className = gasOk ? 'ok' : 'wait';
        sGas.querySelector('.state').textContent = gasOk ? `Received ${fmt(bal, coinDec)}` : 'Waiting…';
      }
      btn.disabled = !tokSome;
      if (tokSome && (!tokOk || !gasOk)) {
        pn.hidden = false;
        pn.textContent = !tokOk ? 'Less than the full amount has arrived so far. The link will contain whatever is deposited.'
          : `The claim fee hasn’t arrived. Without it the recipient will need to add a little ${ch.native.symbol} to claim.`;
      } else pn.hidden = true;
      if (tokOk && gasOk && !funded) {
        funded = true; tip.fundedAt = Date.now(); upsertTip(tip);
        stopTimers(); setTimeout(() => viewReady(tip), 700);
      }
    } catch (e) { /* network hiccup: next poll retries */ }
  }
  check();
  state.timers.push(setInterval(check, 5000));
  $('#toLink').onclick = () => { stopTimers(); viewReady(tip); };

  $('#payBtn').onclick = async () => {
    const btn = $('#payBtn'), msg = $('#payMsg');
    const say = (t, cls = '') => { msg.hidden = false; msg.className = 'msg ' + cls; msg.innerHTML = t; };
    busy(btn, true, 'Open your wallet…');
    try {
      if (isSol(k)) {
        say(`${needGas ? 'Step 1 of 2: c' : 'C'}onfirm ${dep} ${esc(sym)} in your wallet…`);
        const sig = await SOL.payTo(tip.address, tip.token.native ? nativeOf(k) : tip.token, depUnits);
        say(`Sent ${explorerTx(k, sig)}.`);
        if (needGas) {
          say('Step 2 of 2: confirm the claim fee in your wallet…');
          const sig2 = await SOL.payTo(tip.address, nativeOf(k), ethers.parseUnits(tip.gasTopup, coinDec));
          say(`Step 2 sent ${explorerTx(k, sig2)}.`);
        }
        say('Payment received.', 'ok');
        check(); busy(btn, false); return;
      }
      const s = await getSigner(k);
      const me = await s.getAddress();
      const myCoin = await s.provider.getBalance(me);
      if (isNative) {
        if (myCoin <= depUnits) throw new Error(`Your wallet has ${fmt(myCoin, 18)} ${sym} on ${ch.name}. You need a bit more than ${dep} ${sym} including the network fee.`);
        say(`Confirm ${dep} ${esc(sym)} in your wallet…`);
        const tx = await s.sendTransaction({ to: tip.address, value: depUnits });
        say(`Sent ${explorerTx(k, tx.hash)}. Waiting for the network…`);
        await tx.wait();
      } else {
        const c = new ethers.Contract(tip.token.address, ERC20, s);
        const have = await c.balanceOf(me);
        if (have < depUnits) throw new Error(`Your wallet has ${fmt(have, dec)} ${sym} on ${ch.name}. This tip needs ${dep}.`);
        if (myCoin === 0n) throw new Error(`Your wallet needs a little ${ch.native.symbol} on ${ch.name} to pay its own network fee for sending.`);
        say(`${needGas ? 'Step 1 of 2: c' : 'C'}onfirm ${dep} ${esc(sym)} in your wallet…`);
        const tx1 = await c.transfer(tip.address, depUnits);
        say(`Sent ${explorerTx(k, tx1.hash)}. Waiting for the network…`);
        await tx1.wait();
        if (needGas) {
          say('Step 2 of 2: confirm the claim fee in your wallet…');
          const tx2 = await s.sendTransaction({ to: tip.address, value: ethers.parseEther(tip.gasTopup) });
          say(`Step 2 sent ${explorerTx(k, tx2.hash)}. Waiting for the network…`);
          await tx2.wait();
        }
      }
      say('Payment received.', 'ok');
      check();
    } catch (e) { say(esc(friendly(e)), 'err'); }
    busy(btn, false);
  };
}

/* ============================================================
   VIEW: tip link ready
   ============================================================ */
function viewReady(tip) {
  stopTimers(); setNav('create');
  const k = tip.chain || 'bsc', amt = fmtPlain(tip.amount);
  const text = `${tip.from ? tip.from + ' sent you' : 'You got'} a ${amt} ${tip.token.symbol} tip. Claim it here, no fees:`;
  app.innerHTML = `
  <div class="stack">
    ${ticket({ amount: amt, symbol: tip.token.symbol, from: tip.from, note: tip.note, kicker: 'Ready to claim', id: tip.address, usd: tip.token.stable, pop: true, chain: k })}
    <div class="card">
      <h2>Your tip link is ready</h2>
      <div class="linkbox">${esc(tip.link)}</div>
      <button class="btn primary wide" type="button" id="copyLink">Copy link</button>
      <div class="share">
        <a class="btn ghost sm" target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(tip.link)}&text=${encodeURIComponent(text)}">Telegram</a>
        <a class="btn ghost sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text + ' ' + tip.link)}">WhatsApp</a>
        <button class="btn ghost sm" type="button" id="showQr">QR code</button>
      </div>
      <div class="qr" id="linkQr" style="width:220px;align-self:center" hidden></div>
      <p class="warn">${ICON.warn}<span>Anyone who has this link can claim the money, so send it privately. If nobody claims it, you can take it back from My links.</span></p>
    </div>
    <div class="row">
      <button class="btn ghost" type="button" id="another">Send another tip</button>
      <button class="btn ghost" type="button" id="mine">My links</button>
    </div>
  </div>`;
  $('#copyLink').onclick = () => copy(tip.link, 'Link copied');
  $('#showQr').onclick = () => { const q = $('#linkQr'); if (!q.innerHTML) q.innerHTML = qrSvg(tip.link); q.hidden = !q.hidden; };
  $('#another').onclick = () => go('#');
  $('#mine').onclick = () => go('#mytips');
}

/* ============================================================
   VIEW: claim a tip
   ============================================================ */
async function viewClaim(l) {
  setNav('');
  const k = l.c, ch = chainOf(k);
  if (isSol(k)) {
    try { await SOL.ready(); }
    catch (e) { app.innerHTML = `<div class="stack"><div class="card"><h2>Couldn’t load</h2><p class="msg err">${esc(friendly(e))}</p></div></div>`; return; }
  }
  let tipAddr;
  try { tipAddr = isSol(k) ? SOL.addressOf(l.pk) : new ethers.Wallet(l.pk).address; } catch { return viewBroken(); }
  const mine = loadTips().find(x => x.address === tipAddr);

  app.innerHTML = `
  <div class="stack">
    ${ticket({ amount: l.a ? fmtPlain(l.a) : '…', symbol: findToken(k, l.t)?.symbol || '', from: l.f, note: l.m, kicker: 'Checking…', id: tipAddr, dim: true, chain: k })}
    <div class="card"><div class="skeleton" style="width:60%"></div><div class="skeleton"></div><div class="skeleton" style="width:40%"></div></div>
  </div>`;

  let token, bals, nonce, fuel;
  try {
    token = await resolveToken(k, l.t);
    const nonceP = isSol(k) ? SOL.hadActivity(tipAddr).then(x => (x ? 1 : 0)) : rpc(k).then(p => p.getTransactionCount(tipAddr));
    [bals, nonce, fuel] = await Promise.all([balancesOf(k, tipAddr, token), nonceP, getFuelInfo(k)]);
  } catch (e) {
    app.innerHTML = `<div class="stack"><div class="card"><h2>Couldn’t load this tip</h2><p class="msg err">${esc(friendly(e))}</p><button class="btn primary" id="retry" type="button">Try again</button></div></div>`;
    $('#retry').onclick = () => viewClaim(l);
    return;
  }

  const main = bals.find(b => (b.token.native && token.native) || (b.token.address && token.address && b.token.address.toLowerCase() === token.address.toLowerCase()));
  const coin = bals.find(b => b.token.native).bal;
  const nonZero = bals.filter(b => b.bal > 0n);
  const tokensInside = nonZero.filter(b => !b.token.native);
  const hasValue = tokensInside.length > 0 || coin > (isSol(k) ? 10000n : 21000n * ethers.parseUnits('0.1', 'gwei'));
  const lacksGas = tokensInside.length > 0 && coin === 0n;

  let showUnits = main && main.bal > 0n ? main.bal : null;
  let feeTxt = '';
  if (showUnits && !token.native && lacksGas && fuel) {
    const fee = ethers.parseUnits(fuel.fee, token.decimals);
    if (showUnits >= ethers.parseUnits(fuel.minTip || '1', token.decimals) && showUnits > fee * 2n) { showUnits -= fee; feeTxt = fuel.fee; }
  }
  if (showUnits && token.native && l.a) { // a coin tip carries a little extra for gas; show the promised amount
    const promised = ethers.parseUnits(l.a, token.decimals);
    if (showUnits > promised) showUnits = promised;
  }
  const showAmt = showUnits ? fmt(showUnits, token.decimals) : (l.a ? fmtPlain(l.a) : '0');

  const tk = ticket({
    amount: showAmt, symbol: token.symbol, from: l.f, note: l.m, id: tipAddr, chain: k,
    kicker: hasValue ? (mine ? 'Your tip · not claimed yet' : 'You received a tip') : (nonce > 0 ? 'Already claimed' : 'Not funded yet'),
    dim: !hasValue, pop: hasValue, usd: !!token.stable && !!showUnits
  });

  if (!hasValue) {
    app.innerHTML = `
    <div class="stack">${tk}
      <div class="card">
        ${nonce > 0
          ? `<h2>This tip has already been claimed</h2><p class="fine" style="font-size:14px">The money was moved out of this link. If that wasn’t you, ask the sender whether they took it back.</p>`
          : `<h2>This tip isn’t funded yet</h2><p class="fine" style="font-size:14px">The sender hasn’t finished paying. Ask them to complete it, then check again.</p>
             <button class="btn ghost" type="button" id="refresh">Check again</button>`}
        <a class="btn primary" href="#" id="sendOwn">Send a tip of your own</a>
      </div>
    </div>`;
    $('#refresh') && ($('#refresh').onclick = () => viewClaim(l));
    $('#sendOwn').onclick = e => { e.preventDefault(); history.replaceState(null, '', baseUrl()); route(); };
    return;
  }

  let feeNote = CONFIG.FEE_BPS > 0 && ethers.isAddress(CONFIG.FEE_ADDRESS) ? `<p class="fine">A ${(CONFIG.FEE_BPS / 100).toFixed(2).replace(/\.?0+$/, '')}% service fee is taken from tokens on claim.</p>` : '';
  if (lacksGas && fuel) feeNote += `<p class="fine">You pay nothing. The network fee is covered${feeTxt ? ` by ${esc(feeTxt)} ${esc(token.symbol)} the tip already includes` : ''}.</p>`;

  app.innerHTML = `
  <div class="stack">
    ${tk}
    <div class="card" id="claimCard">
      <h2>${mine ? 'Take this tip back' : 'Claim your tip'}</h2>
      ${mine ? `<p class="fine" style="font-size:14px">You created this tip on this device. Claiming it sends the money back to the address you choose.</p>` : ''}
      <div class="field">
        <label class="label" for="toAddr">Your ${esc(ch.name)} address</label>
        <div class="addr-in">
          <input class="input mono" id="toAddr" placeholder="${addrPlaceholder(k)}" autocomplete="off" spellcheck="false" value="${isSol(k) ? '' : esc(state.account || '')}">
          <button class="btn ghost sm" type="button" id="useWallet">Use wallet</button>
        </div>
        <p class="fine">Any wallet works: ${isSol(k) ? 'Phantom, Solflare, Backpack, Trust Wallet' : 'MetaMask, Trust Wallet, Coinbase Wallet, Binance Wallet'}. Using an exchange deposit address? Pick the ${esc(token.symbol)} address for the <b>${esc(ch.exchangeNetwork)}</b> network.</p>
      </div>
      ${feeNote}
      <button class="btn primary wide" id="claimBtn" type="button">Claim ${showAmt} ${esc(token.symbol)}</button>
      <ul class="log" id="claimLog" aria-live="polite"></ul>
      <div id="gasBox" hidden></div>
    </div>
  </div>`;

  const input = $('#toAddr');
  $('#useWallet').onclick = async () => { try { input.value = await connectFor(k); } catch (e) { toast(friendly(e)); } };
  const log = (html, cls = '') => { const li = document.createElement('li'); li.className = cls; li.innerHTML = html; $('#claimLog').appendChild(li); return li; };

  $('#claimBtn').onclick = async () => {
    const btn = $('#claimBtn'); $('#claimLog').innerHTML = ''; $('#gasBox').hidden = true;
    let to = input.value.trim();
    if (!addrValid(k, to)) { log(addrError(k), 'err'); input.focus(); return; }
    to = addrNorm(k, to);
    if (to === tipAddr) { log('That’s the tip’s own address. Enter your wallet address.', 'err'); return; }
    busy(btn, true, 'Claiming…');
    try {
      await (isSol(k) ? SOL.claim(l.pk, to, log) : claimAll(k, l.pk, to, token, log));
      if (mine) { mine.claimedAt = Date.now(); upsertTip(mine); }
      history.replaceState(null, '', baseUrl());
      showClaimed(to, l);
    } catch (e) {
      busy(btn, false);
      if (e.message === 'NEED_GAS') return showGasBox(k, tipAddr, e.need, () => $('#claimBtn').click());
      log(esc(friendly(e)), 'err');
    }
  };
}

async function claimAll(k, pk, to, mainToken, log) {
  const ch = chainOf(k);
  const p = await rpc(k);
  const w = new ethers.Wallet(pk, p);
  const gasPrice = await gasPriceOf(k, p);
  const l1 = l1Of(k);

  log('Checking balances…');
  const bals = await balancesOf(k, w.address, mainToken);
  const held = bals.filter(x => !x.token.native && x.bal > 0n);
  let coin = bals.find(x => x.token.native).bal;
  const serviceOn = CONFIG.FEE_BPS > 0 && ethers.isAddress(CONFIG.FEE_ADDRESS);

  // gas estimate per token transfer (works even with zero coins in the tip)
  for (const b of held) {
    b.c = new ethers.Contract(b.token.address, ERC20, w);
    try { b.gas = (await b.c.transfer.estimateGas(to, b.bal)) * 13n / 10n; }
    catch { b.gas = FALLBACK_TRANSFER_GAS[k] || 90000n; }
  }
  const costOf = n => held.reduce((s, b) => s + (b.gas * gasPrice + l1) * n, 0n);

  // not enough gas in the tip to move the tokens? ask the fee service to cover it
  let fuel = null;
  const baseTx = 1n + (serviceOn ? 1n : 0n);
  if (held.length && coin < costOf(baseTx)) {
    const info = await getFuelInfo(k);
    if (!info) { const err = new Error('NEED_GAS'); err.need = costOf(baseTx) - coin; throw err; }
    const li = log('Covering the network fee for you…');
    try { fuel = await requestFuel(k, w.address); }
    catch (e) { li.className = 'err'; li.textContent = friendly(e); const err = new Error('NEED_GAS'); err.need = costOf(baseTx) - coin; throw err; }
    li.className = 'ok'; li.textContent = 'Network fee covered';
    coin = await p.getBalance(w.address);
  }

  // build the transfer plan
  const plan = [];
  for (const b of held) {
    const sym = esc(b.token.symbol), dec = b.token.decimals;
    let rest = b.bal;
    const extra = [];
    if (serviceOn) {
      const fee = b.bal * BigInt(CONFIG.FEE_BPS) / 10000n;
      if (fee > 0n) { rest -= fee; extra.push({ to: CONFIG.FEE_ADDRESS, amt: fee, label: `service fee (${fmt(fee, dec)} ${sym})` }); }
    }
    if (fuel && fuel.feeToken && b.token.address.toLowerCase() === fuel.feeToken.toLowerCase() && ethers.isAddress(fuel.feeTo)) {
      const fee = BigInt(fuel.fee || '0');
      if (fee > 0n && rest > fee) { rest -= fee; extra.push({ to: fuel.feeTo, amt: fee, label: `network fee (${fmt(fee, dec)} ${sym})` }); }
    }
    plan.push({ c: b.c, to, amt: rest, gas: b.gas, label: `${fmt(rest, dec)} ${sym}` });
    extra.forEach(x => plan.push({ c: b.c, gas: b.gas, ...x }));
  }
  let need = plan.reduce((s, x) => s + x.gas * gasPrice + l1, 0n);
  if (coin < need && fuel) { // gas price moved since the top-up: ask once more
    try { fuel = { ...fuel, ...(await requestFuel(k, w.address)) }; coin = await p.getBalance(w.address); } catch { }
  }
  if (coin < need) { const err = new Error('NEED_GAS'); err.need = need - coin; throw err; }

  let nonce = await p.getTransactionCount(w.address, 'pending');
  const hashes = [];
  for (const x of plan) {
    const li = log(`Sending ${x.label}…`);
    const tx = await x.c.transfer(x.to, x.amt, { gasLimit: x.gas, gasPrice, nonce: nonce++ });
    await tx.wait();
    li.className = 'ok'; li.innerHTML = `Sent ${x.label} ${explorerTx(k, tx.hash)}`;
    hashes.push(tx.hash);
  }

  // leftover coins: unused fee-service gas goes back to the service; otherwise it goes to the recipient
  coin = await p.getBalance(w.address);
  const sweepTo = fuel && ethers.isAddress(fuel.refundTo) ? fuel.refundTo : to;
  let gl = 21000n;
  try { gl = await p.estimateGas({ from: w.address, to: sweepTo, value: 1n }); } catch { }
  const cost = gl * gasPrice + l1;
  if (coin > cost * 2n) {
    const value = coin - cost;
    const li = log(fuel ? 'Returning unused network fee…' : `Sending ${fmt(value, 18)} ${ch.native.symbol}…`);
    try {
      const tx = await w.sendTransaction({ to: sweepTo, value, gasLimit: gl, gasPrice, nonce: nonce++ });
      await tx.wait();
      li.className = 'ok'; li.innerHTML = fuel ? `Returned unused network fee ${explorerTx(k, tx.hash)}` : `Sent ${fmt(value, 18)} ${ch.native.symbol} ${explorerTx(k, tx.hash)}`;
      if (!fuel) hashes.push(tx.hash);
    } catch (e) {
      if (!fuel && !hashes.length) throw e;
      li.remove(); // the tip itself is already delivered; a little leftover gas staying behind is harmless
    }
  }
  if (!hashes.length) throw new Error('There’s nothing left to claim in this link.');
  return { hashes };
}

function showGasBox(k, tipAddr, need, retry) {
  const ch = chainOf(k), box = $('#gasBox'), dec = nativeOf(k).decimals;
  let amount = need * 15n / 10n;
  if (isSol(k) && amount < 900000n) amount = 900000n; // a new Solana account must receive at least ~0.0009 SOL
  box.hidden = false;
  box.innerHTML = `
    <div class="stack">
      <p class="warn">${ICON.warn}<span>This tip doesn’t have enough ${ch.native.symbol} to pay its own network fee, and this site’s fee service isn’t available. Add a little ${ch.native.symbol} from any wallet and claim again.</span></p>
      <button class="btn ghost wide" type="button" id="addGas">Add ${fmt(amount, dec)} ${ch.native.symbol} from my wallet</button>
      <p class="fine">Or send at least ${fmt(amount, dec)} ${ch.native.symbol} on ${esc(ch.name)} to <code style="font-family:var(--mono);word-break:break-all">${tipAddr}</code>, then press Claim again.</p>
    </div>`;
  $('#addGas').onclick = async () => {
    const b = $('#addGas'); busy(b, true, 'Confirm in wallet…');
    try {
      if (isSol(k)) await SOL.payTo(tipAddr, nativeOf(k), amount);
      else {
        const s = await getSigner(k);
        const tx = await s.sendTransaction({ to: tipAddr, value: amount });
        busy(b, true, 'Waiting for network…');
        await tx.wait();
      }
      box.hidden = true; toast('Fee added. Claiming…'); retry();
    } catch (e) { busy(b, false); toast(friendly(e)); }
  };
}

function showClaimed(to, l) {
  const card = $('#claimCard');
  const items = $('#claimLog').innerHTML;
  card.classList.add('success');
  card.innerHTML = `
    <span class="badge">Claimed</span>
    <p class="big">It’s yours.</p>
    <p class="fine" style="font-size:14px">Sent to <code style="font-family:var(--mono)">${short(to)}</code> on ${esc(chainOf(l.c).name)}. It should show up in your wallet within a minute.</p>
    <ul class="log" style="text-align:left;align-self:stretch">${items}</ul>
    <button class="btn primary wide" type="button" id="payItFwd">${l.f ? 'Send a tip back to ' + esc(l.f) : 'Send a tip of your own'}</button>`;
  $('.ticket').classList.remove('dim');
  $('.t-kicker').textContent = 'Claimed';
  $('#payItFwd').onclick = () => route();
  confetti();
}

function viewBroken() {
  app.innerHTML = `<div class="stack"><div class="card"><h2>This link looks broken</h2><p class="fine" style="font-size:14px">Part of it may have been cut off when it was copied. Ask the sender to send it again.</p><button class="btn primary" id="home" type="button">Go to ${esc(CONFIG.APP_NAME)}</button></div></div>`;
  $('#home').onclick = () => { history.replaceState(null, '', baseUrl()); route(); };
}

/* ============================================================
   PAYMENT REQUESTS
   The link carries the requester's address, so the payer sends money
   straight to them. No middle wallet, nothing for the requester to pay.
   ============================================================ */
function viewRequest() {
  setNav('request'); setWide(true);
  const k0 = lastChain();
  app.innerHTML = `
  <div class="stack home">
    ${modeSwitch('request')}
    <section class="hero">
      <h1>Ask to be <em>paid.</em></h1>
      <p>Make a payment link with your amount and address. Whoever opens it pays you in one tap, or by scanning a QR. The money goes straight to your wallet, and you pay nothing.</p>
    </section>

    <form class="card home-form" id="reqForm" novalidate>
      <div class="field"><span class="label">Network</span>${chainPicker('rchain', k0)}</div>
      <p class="warn" id="rEthWarn" hidden>${ICON.warn}<span><b>Ethereum fees are high</b> for the person paying you, often $1 or more. Base, Arbitrum or Polygon cost cents.</span></p>
      <div class="field">
        <span class="label" id="rTokLbl">Token</span>
        <div class="seg" role="radiogroup" aria-labelledby="rTokLbl" id="rTokSeg">${tokenPicker('rtok', k0)}</div>
      </div>

      <div class="field">
        <label class="label" for="rAmount">Amount <span style="font-weight:400">· leave empty to let them choose</span></label>
        <div class="amount-wrap">
          <input id="rAmount" inputmode="decimal" autocomplete="off" value="50" placeholder="Any">
          <span class="sym" id="rSym"></span>
        </div>
      </div>

      <div class="field">
        <label class="label" for="rTo">Pay to (your wallet address)</label>
        <div class="addr-in">
          <input class="input mono" id="rTo" placeholder="${addrPlaceholder(k0)}" autocomplete="off" spellcheck="false" value="${isSol(k0) ? '' : esc(state.account || '')}">
          <button class="btn ghost sm" type="button" id="rUseWallet">Use wallet</button>
        </div>
        <p class="fine" id="rToHint"></p>
      </div>

      <div class="field">
        <label class="label" for="rNote">What it’s for <span style="font-weight:400">· optional</span></label>
        <textarea class="input" id="rNote" maxlength="140" placeholder="Logo design, 2 revisions"></textarea>
      </div>
      <div class="field">
        <label class="label" for="rFrom">Your name <span style="font-weight:400">· optional</span></label>
        <input class="input" id="rFrom" maxlength="32" placeholder="Alex" autocomplete="nickname">
      </div>

      <p class="msg err" id="reqErr" hidden></p>
      <button class="btn primary wide" type="submit" id="reqBtn">Create payment link</button>
      <p class="fine">Free. Payments go directly from them to you, ${esc(CONFIG.APP_NAME)} never holds the money.</p>
    </form>
  </div>`;

  const form = $('#reqForm'), err = $('#reqErr');
  const showErr = m => { err.textContent = m; err.hidden = !m; };
  const chainKey = () => form.querySelector('input[name=rchain]:checked').value;
  const selected = () => findToken(chainKey(), form.querySelector('input[name=rtok]:checked').value);
  function refresh() {
    const k = chainKey(), ch = chainOf(k), t = selected();
    $('#rSym').textContent = t.symbol;
    $('#rEthWarn').hidden = !ch.expensive;
    $('#rTo').placeholder = addrPlaceholder(k);
    const v = $('#rTo').value.trim();
    if (v && !addrValid(k, v)) $('#rTo').value = '';
    if (isSol(k)) SOL.ready().catch(() => { });
    $('#rToHint').innerHTML = `Any wallet address works. Using an exchange deposit address? Copy the ${esc(t.symbol)} address for the <b>${esc(ch.exchangeNetwork)}</b> network, or the money may not arrive.`;
  }
  form.addEventListener('change', e => {
    if (e.target.name === 'rchain') { const prev = form.querySelector('input[name=rtok]:checked')?.value; rememberChain(chainKey()); $('#rTokSeg').innerHTML = tokenPicker('rtok', chainKey(), prev); }
    refresh();
  });
  refresh();
  $('#rAmount').addEventListener('input', e => { e.target.value = e.target.value.replace(',', '.').replace(/[^\d.]/g, ''); });
  $('#rUseWallet').onclick = async () => { try { $('#rTo').value = await connectFor(chainKey()); } catch (e) { toast(friendly(e)); } };

  form.addEventListener('submit', async e => {
    e.preventDefault(); showErr('');
    try {
      const k = chainKey(), token = selected();
      if (isSol(k)) await SOL.ready();
      const raw = $('#rAmount').value.trim();
      let amount = '';
      if (raw) {
        if (!/^\d+(\.\d+)?$/.test(raw) || Number(raw) <= 0) throw new Error('Enter an amount greater than zero, or leave it empty.');
        try { amount = norm(ethers.parseUnits(raw, token.decimals), token.decimals); } catch { throw new Error(`${token.symbol} supports up to ${token.decimals} decimal places.`); }
      }
      const toRaw = $('#rTo').value.trim();
      if (!addrValid(k, toRaw)) throw new Error(addrError(k));
      const r = {
        id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        to: addrNorm(k, toRaw), chain: k,
        token: { symbol: token.symbol, address: token.address, decimals: token.decimals, native: !!token.native, stable: !!token.stable },
        amount, note: $('#rNote').value.trim(), from: $('#rFrom').value.trim(), createdAt: Date.now()
      };
      r.link = reqLinkFor(r);
      const all = loadReqs(); all.unshift(r); saveReqs(all.slice(0, 100)); updateCount();
      viewRequestReady(r);
    } catch (ex) { showErr(friendly(ex)); }
  });
}

function viewRequestReady(r) {
  setNav('request');
  const k = r.chain || 'bsc';
  const amt = r.amount ? fmtPlain(r.amount) : 'Any';
  const text = `${r.from ? r.from + ' sent' : 'Here’s'} a payment request${r.amount ? ` for ${amt} ${r.token.symbol}` : ''} on ${chainOf(k).name}. Pay here:`;
  app.innerHTML = `
  <div class="stack">
    ${ticket({ amount: amt, symbol: r.amount ? r.token.symbol : r.token.symbol + ' · their choice', from: r.from, note: r.note, kicker: 'Payment request', id: r.to, usd: r.token.stable && !!r.amount, pop: true, chain: k })}
    <div class="card">
      <h2>Your payment link is ready</h2>
      <div class="linkbox">${esc(r.link)}</div>
      <button class="btn primary wide" type="button" id="copyLink">Copy link</button>
      <div class="share">
        <a class="btn ghost sm" target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(r.link)}&text=${encodeURIComponent(text)}">Telegram</a>
        <a class="btn ghost sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text + ' ' + r.link)}">WhatsApp</a>
        <button class="btn ghost sm" type="button" id="showQr">QR code</button>
      </div>
      <div class="qr" id="linkQr" style="width:220px;align-self:center" hidden></div>
      <p class="fine">Payments arrive at <code style="font-family:var(--mono)">${short(r.to)}</code> on ${esc(chainOf(k).name)}. The link can be paid more than once, so you can reuse it as a tip jar.</p>
    </div>
    <div class="row">
      <button class="btn ghost" type="button" id="another">New request</button>
      <button class="btn ghost" type="button" id="mine">My links</button>
    </div>
  </div>`;
  $('#copyLink').onclick = () => copy(r.link, 'Link copied');
  $('#showQr').onclick = () => { const q = $('#linkQr'); if (!q.innerHTML) q.innerHTML = qrSvg(r.link); q.hidden = !q.hidden; };
  $('#another').onclick = () => go('#request');
  $('#mine').onclick = () => go('#mytips');
}

async function viewPay(rq) {
  setNav('');
  const k = rq.c, ch = chainOf(k);
  if (isSol(k)) { try { await SOL.ready(); } catch (e) { app.innerHTML = `<div class="stack"><div class="card"><h2>Couldn’t load</h2><p class="msg err">${esc(friendly(e))}</p></div></div>`; return; } }
  let token;
  try { token = findToken(k, rq.t) || await resolveToken(k, rq.t); } catch { return viewBroken(); }
  const sym = token.symbol, dec = token.decimals;
  const fixed = !!rq.a;
  const isMe = state.account && state.account === rq.to;

  app.innerHTML = `
  <div class="stack">
    ${ticket({ amount: fixed ? fmtPlain(rq.a) : 'Any', symbol: fixed ? sym : sym + ' · you choose', from: rq.f, note: rq.m, kicker: 'Payment request', id: rq.to, usd: token.stable && fixed, pop: true, chain: k })}

    ${isMe ? `<p class="warn">${ICON.warn}<span>This is your own payment link. Share it with the person who should pay you.</span></p>` : ''}
    ${ch.expensive ? `<p class="warn">${ICON.warn}<span><b>Ethereum network fees are high.</b> Your wallet will show the exact fee before you confirm.</span></p>` : ''}

    <div class="card" id="payCard">
      <h2>${rq.f ? `Pay ${esc(rq.f)}` : 'Pay this request'}</h2>
      ${fixed ? '' : `
      <div class="field">
        <label class="label" for="pAmount">Amount</label>
        <div class="amount-wrap"><input id="pAmount" inputmode="decimal" autocomplete="off" placeholder="0"><span class="sym">${esc(sym)}</span></div>
      </div>`}
      <div class="field">
        <span class="label">Paying to, on ${esc(ch.name)}</span>
        <div class="addr"><code>${rq.to}</code><button class="icon-btn" type="button" data-copy="${rq.to}" aria-label="Copy address">${ICON.copy}</button></div>
      </div>

      <div class="tabs" role="tablist">
        <button role="tab" aria-selected="true" data-tab="wallet" type="button">Pay with wallet</button>
        <button role="tab" aria-selected="false" data-tab="qr" type="button">Scan QR</button>
      </div>

      <div data-pane="wallet" class="stack">
        <button class="btn primary wide" id="payNow" type="button">${fixed ? `Pay ${fmtPlain(rq.a)} ${esc(sym)}` : 'Pay'}</button>
        <ul class="log" id="payLog" aria-live="polite"></ul>
      </div>

      <div data-pane="qr" class="stack" hidden>
        <div class="qr-row">
          <div class="qr" aria-label="QR code of the address to pay">${qrSvg(rq.to)}</div>
          <div class="qr-side">
            <ul class="sendlist">
              <li><span>Send</span><b>${fixed ? `${fmtPlain(rq.a)} ${esc(sym)}` : `any amount of ${esc(sym)}`}</b></li>
              <li><span>Network</span><b>${esc(ch.name)}</b></li>
            </ul>
          </div>
        </div>
        <p class="warn">${ICON.warn}<span>Send only ${esc(sym)} on ${esc(ch.name)}. From an exchange, choose <b>${esc(ch.exchangeNetwork)}</b> as the network.</span></p>
        <ul class="status"><li id="seen" class="wait"><span class="pip"></span>Watching for your payment<span class="state">Waiting…</span></li></ul>
      </div>
      <p class="fine">Payments go straight to this address and can’t be reversed. Make sure you know who you’re paying.</p>
    </div>
  </div>`;

  $$('[data-copy]').forEach(b => b.onclick = () => copy(b.dataset.copy, 'Address copied'));
  bindTabs();

  const readBal = async () => {
    if (isSol(k)) return SOL.balanceOf(rq.to, token);
    const p = await rpc(k);
    return token.native ? p.getBalance(rq.to) : new ethers.Contract(token.address, ERC20, p).balanceOf(rq.to);
  };
  const amountUnits = () => {
    const raw = fixed ? rq.a : ($('#pAmount')?.value || '').replace(',', '.').trim();
    if (!/^\d+(\.\d+)?$/.test(raw) || Number(raw) <= 0) throw new Error('Enter how much you want to pay.');
    try { return ethers.parseUnits(raw, dec); } catch { throw new Error(`${sym} supports up to ${dec} decimal places.`); }
  };

  // watch the requester's balance so QR payments (e.g. from an exchange) are noticed
  let baseline = null;
  readBal().then(b => { baseline = b; }).catch(() => { });
  state.timers.push(setInterval(async () => {
    if (baseline === null) return;
    try {
      const b = await readBal();
      const seen = $('#seen'); if (!seen) return;
      const diff = b - baseline;
      let need = 1n; try { need = amountUnits(); } catch { }
      if (diff > 0n && diff >= need * 99n / 100n) {
        seen.className = 'ok'; seen.querySelector('.state').textContent = `Received ${fmt(diff, dec)} ${sym}`;
        stopTimers(); paid(null, diff);
      } else if (diff > 0n) seen.querySelector('.state').textContent = `${fmt(diff, dec)} ${sym} arrived`;
    } catch { }
  }, 5000));

  function paid(hash, units) {
    const card = $('#payCard');
    card.classList.add('success');
    card.innerHTML = `
      <span class="badge">Paid</span>
      <p class="big">Sent. Thank you.</p>
      <p class="fine" style="font-size:14px">${fmt(units, dec)} ${esc(sym)} went to <code style="font-family:var(--mono)">${short(rq.to)}</code> on ${esc(ch.name)}${hash ? `. ${explorerTx(k, hash)}` : ''}</p>
      <button class="btn ghost wide" type="button" id="ownReq">Create your own payment link</button>`;
    $('.t-kicker').textContent = 'Paid';
    $('#ownReq').onclick = () => { history.replaceState(null, '', baseUrl() + '#request'); route(); };
    confetti();
  }

  $('#payNow').onclick = async () => {
    const btn = $('#payNow'), log = $('#payLog'); log.innerHTML = '';
    const say = (html, cls = '') => { const li = document.createElement('li'); li.className = cls; li.innerHTML = html; log.appendChild(li); return li; };
    let units;
    try { units = amountUnits(); } catch (e) { say(esc(e.message), 'err'); return; }
    busy(btn, true, 'Open your wallet…');
    try {
      if (isSol(k)) {
        say(`Confirm ${fmt(units, dec)} ${esc(sym)} in your wallet…`);
        const sig = await SOL.payTo(rq.to, token, units);
        stopTimers();
        return paid(sig, units);
      }
      const s = await getSigner(k);
      const me = await s.getAddress();
      if (me === rq.to) throw new Error('That’s the same wallet you’re paying. Switch to another account.');
      const myCoin = await s.provider.getBalance(me);
      let tx;
      if (token.native) {
        if (myCoin <= units) throw new Error(`Your wallet has ${fmt(myCoin, 18)} ${sym} on ${ch.name}. You need a bit more than ${fmt(units, 18)} ${sym} including the network fee.`);
        say(`Confirm ${fmt(units, dec)} ${esc(sym)} in your wallet…`);
        tx = await s.sendTransaction({ to: rq.to, value: units });
      } else {
        const c = new ethers.Contract(token.address, ERC20, s);
        const have = await c.balanceOf(me);
        if (have < units) throw new Error(`Your wallet has ${fmt(have, dec)} ${sym} on ${ch.name}.`);
        if (myCoin === 0n) throw new Error(`Your wallet needs a little ${ch.native.symbol} on ${ch.name} to pay the network fee.`);
        say(`Confirm ${fmt(units, dec)} ${esc(sym)} in your wallet…`);
        tx = await c.transfer(rq.to, units);
      }
      say(`Sent ${explorerTx(k, tx.hash)}. Waiting for the network…`);
      await tx.wait();
      stopTimers();
      paid(tx.hash, units);
    } catch (e) { say(esc(friendly(e)), 'err'); busy(btn, false); }
  };
}

/* ============================================================
   VIEW: my tips and payment links
   ============================================================ */
function viewMyTips() {
  setNav('mytips');
  const tips = loadTips(), reqs = loadReqs();
  if (!tips.length && !reqs.length) {
    app.innerHTML = `<div class="stack"><h2>My links</h2><div class="card empty-state"><b>Nothing here yet</b>Tips and payment links you create on this device show up here, so you can copy them again or take back unclaimed money.<br><br>
      <div class="row"><button class="btn primary" id="first" type="button">Send a tip</button><button class="btn ghost" id="firstReq" type="button">Request money</button></div></div></div>`;
    $('#first').onclick = () => go('#');
    $('#firstReq').onclick = () => go('#request');
    return;
  }
  const when = ts => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const net = k => { const ch = chainOf(k || 'bsc'); return `<i class="cdot" style="background:${ch.color}"></i>${esc(ch.name)}`; };
  app.innerHTML = `
  <div class="stack">
    <h2>My links</h2>
    <p class="fine" style="font-size:14px">Saved on this device only. Clearing browser data removes this list, so keep links for unclaimed tips somewhere safe.</p>

    ${tips.length ? `<h3>Tips you sent</h3>
    <div class="tip-list">
      ${tips.map(t => `
        <div class="tip-item" data-id="${esc(t.id)}">
          <div class="top">
            <div class="amt">${fmtPlain(t.amount)}<small>${esc(t.token.symbol)}</small></div>
            <span class="pill" data-pill>Checking…</span>
          </div>
          <div class="meta">${net(t.chain)} · ${t.from ? 'From ' + esc(t.from) + ' · ' : ''}${when(t.createdAt)}${t.note ? '<br>“' + esc(t.note) + '”' : ''}</div>
          <div class="row">
            <button class="btn ghost sm" type="button" data-act="copy">Copy link</button>
            <button class="btn ghost sm" type="button" data-act="open">Open</button>
            <button class="btn ghost sm" type="button" data-act="remove">Remove</button>
          </div>
          <div data-confirm hidden></div>
        </div>`).join('')}
    </div>` : ''}

    ${reqs.length ? `<h3>Payment links</h3>
    <div class="tip-list">
      ${reqs.map(r => `
        <div class="tip-item" data-rid="${esc(r.id)}">
          <div class="top">
            <div class="amt">${r.amount ? fmtPlain(r.amount) : 'Any'}<small>${esc(r.token.symbol)}</small></div>
            <span class="pill new">Request</span>
          </div>
          <div class="meta">${net(r.chain)} · To ${short(r.to)} · ${when(r.createdAt)}${r.note ? '<br>“' + esc(r.note) + '”' : ''}</div>
          <div class="row">
            <button class="btn ghost sm" type="button" data-ract="copy">Copy link</button>
            <button class="btn ghost sm" type="button" data-ract="open">Open</button>
            <button class="btn ghost sm" type="button" data-ract="remove">Remove</button>
          </div>
        </div>`).join('')}
    </div>` : ''}
  </div>`;

  tips.forEach(async t => {
    const el = app.querySelector(`[data-id="${CSS.escape(t.id)}"]`);
    if (!el) return;
    const k = t.chain || 'bsc';
    const pill = $('[data-pill]', el);
    let status = 'unknown';
    try {
      let val, nonce;
      if (isSol(k)) {
        const all = await SOL.balances(t.address);
        val = t.token.native ? all[0].bal > 20000n : (all.find(x => x.token.address === t.token.address)?.bal || 0n) > 0n;
        nonce = val ? 1 : ((await SOL.hadActivity(t.address)) ? 1 : 0);
      } else {
        const p = await rpc(k);
        const [coin, n, tb] = await Promise.all([
          p.getBalance(t.address), p.getTransactionCount(t.address),
          t.token.native ? Promise.resolve(0n) : new ethers.Contract(t.token.address, ERC20, p).balanceOf(t.address)
        ]);
        const gasP = await gasPriceOf(k, p);
        val = t.token.native ? coin > (21000n * gasP + l1Of(k)) * 2n : tb > 0n;
        nonce = n;
      }
      status = val ? 'live' : nonce > 0 ? 'done' : 'new';
      pill.className = 'pill ' + status;
      pill.textContent = { live: 'Waiting for claim', done: 'Claimed', new: 'Not funded' }[status];
    } catch { pill.textContent = 'Offline'; }
    el.dataset.status = status;
    $('[data-act="open"]', el).textContent = status === 'live' ? 'Take back' : status === 'new' ? 'Finish funding' : 'Open';
  });

  $$('[data-id]').forEach(el => {
    const t = tips.find(x => x.id === el.dataset.id);
    $('[data-act="copy"]', el).onclick = () => copy(t.link || linkFor(t), 'Link copied');
    $('[data-act="open"]', el).onclick = () => {
      if (el.dataset.status === 'new') return viewFund(t);
      location.hash = (t.link || linkFor(t)).split('#')[1];
    };
    $('[data-act="remove"]', el).onclick = () => {
      const box = $('[data-confirm]', el);
      const risky = el.dataset.status === 'live' || el.dataset.status === 'unknown';
      box.hidden = false;
      box.innerHTML = `<div class="confirm"><span>${risky ? 'This tip may still hold money. If you remove it without saving the link, nobody can get the money back.' : 'Remove this tip from the list?'}</span>
        <div class="row"><button class="btn ghost sm" type="button" data-no>Keep it</button><button class="btn ghost sm" type="button" data-yes style="color:var(--rose)">Remove</button></div></div>`;
      $('[data-no]', box).onclick = () => { box.hidden = true; };
      $('[data-yes]', box).onclick = () => { removeTip(t.id); viewMyTips(); };
    };
  });

  $$('[data-rid]').forEach(el => {
    const r = reqs.find(x => x.id === el.dataset.rid);
    $('[data-ract="copy"]', el).onclick = () => copy(r.link || reqLinkFor(r), 'Link copied');
    $('[data-ract="open"]', el).onclick = () => viewRequestReady(r);
    $('[data-ract="remove"]', el).onclick = () => { saveReqs(loadReqs().filter(x => x.id !== r.id)); updateCount(); viewMyTips(); };
  });
}

/* ============================================================
   confetti
   ============================================================ */
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = $('#confetti'), ctx = c.getContext('2d');
  const dpr = devicePixelRatio || 1;
  c.width = innerWidth * dpr; c.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cols = ['#F3BA2F', '#FFD66B', '#57E0A4', '#7B6CFF', '#EEEBE3'];
  const ps = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2, y: innerHeight * .35,
    vx: (Math.random() - .5) * 14, vy: Math.random() * -14 - 4,
    s: Math.random() * 7 + 4, r: Math.random() * 6, vr: (Math.random() - .5) * .4,
    c: cols[Math.floor(Math.random() * cols.length)]
  }));
  let f = 0;
  (function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ps.forEach(p => {
      p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
    });
    if (++f < 170) requestAnimationFrame(tick); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })();
}

/* ============================================================
   router
   ============================================================ */
function route() {
  stopTimers(); setWide(false);
  const l = parseLink(location.hash);
  if (l) return viewClaim(l);
  if (/[#&]k=/.test(location.hash)) return viewBroken();
  const rq = parseReq(location.hash);
  if (rq) return viewPay(rq);
  if (/[#&]pay=/.test(location.hash)) return viewBroken();
  if (location.hash === '#mytips') return viewMyTips();
  if (location.hash === '#request') return viewRequest();
  if (location.hash === '#token' && CONFIG.TOKEN) return viewToken();
  viewCreate();
}
window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
document.title = CONFIG.APP_NAME;
$('#brandName').textContent = CONFIG.APP_NAME;
updateCount();
if (typeof ethers === 'undefined' || typeof qrcode === 'undefined') {
  app.innerHTML = '<div class="card"><h2>Couldn’t load</h2><p class="fine" style="font-size:14px">Some files didn’t load. Check your connection and refresh the page.</p></div>';
} else route();
