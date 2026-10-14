"use strict";
/* ============================================================
   TipDrop — Token page (yoursite/#token)
   Everything comes from CONFIG.TOKEN in config.js; live numbers come from DexScreener.
   ============================================================ */
const TOKEN_ICONS = {
  x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.9 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z"/></svg>',
  tg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.4 4.3 2.9 11.5c-1.3.5-1.2 1.3-.2 1.6l4.7 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.4l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.3-.5-1.9-1.4-1.5ZM9.6 14.3l-.4 4.1-1.4-4.6 10.2-6.5-8.4 7Z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 2h-3.3v13.4a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9.2a6.3 6.3 0 1 0 5.3 6.2V8.6a7.9 7.9 0 0 0 4.6 1.5V6.8a4.6 4.6 0 0 1-4.6-4.8Z"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M16 13h2M3 10h18"/></svg>'
};

const compactUsd = n => {
  if (n == null || isNaN(n)) return '—';
  n = Number(n);
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
};
const priceUsd = p => {
  if (p == null || isNaN(p)) return '—';
  p = Number(p);
  if (p >= 1) return '$' + p.toFixed(4);
  const s = p.toPrecision(4);                          // keeps 4 meaningful digits: 0.0002704
  return '$' + Number(s).toFixed(Math.max(2, -Math.floor(Math.log10(p)) + 3));
};
const groupNum = n => Number(n).toLocaleString('en-US');

function donut(allocs) {
  const r = 70, c = 2 * Math.PI * r, gap = 2.2;
  let off = 0;
  const arcs = allocs.map(a => {
    const len = Math.max(0, (a.pct / 100) * c - gap);
    const seg = `<circle cx="100" cy="100" r="${r}" fill="none" stroke="${a.color}" stroke-width="26"
      stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"
      transform="rotate(-90 100 100)"><title>${esc(a.label)}: ${a.pct}%</title></circle>`;
    off += (a.pct / 100) * c;
    return seg;
  }).join('');
  return `<svg class="donut" viewBox="0 0 200 200" role="img" aria-label="Token distribution chart">
    <circle cx="100" cy="100" r="${r}" fill="none" stroke="var(--panel-2)" stroke-width="26"/>
    ${arcs}
    <text x="100" y="94" text-anchor="middle" class="donut-big">1B</text>
    <text x="100" y="116" text-anchor="middle" class="donut-small">${esc(CONFIG.TOKEN.symbol)} total</text>
  </svg>`;
}

const FAQ = () => {
  const T = CONFIG.TOKEN;
  return [
    ['What is TipDrop?',
      `TipDrop lets you send crypto as a link. You put USDT, USDC or coins into a link, send it in any chat, and the other person claims it by pasting their address. They never pay a fee. You can also make payment links to get paid. It works on BNB Chain, Solana, Base, Arbitrum, Polygon and Ethereum.`],
    [`What is ${T.symbol}?`,
      `${T.symbol} is the community token of TipDrop, on BNB Chain. The contract address is <code>${T.address}</code>. Always check this address before buying; anyone can create a token with the same name.`],
    [`What will ${T.symbol} be used for?`,
      `These features are planned and not live yet: tipping in ${T.symbol} with no claim fee, ${T.symbol} cashback for people who send tips, and holder perks such as personal tip pages. We’ll announce each one in our Telegram channel when it ships.`],
    [`How do I buy ${T.symbol}?`,
      `Open <a href="${T.buyUrl}" target="_blank" rel="noopener">PancakeSwap</a> with any BNB Chain wallet (MetaMask, Trust Wallet, Binance Web3 Wallet). It opens with USDT → ${T.symbol} already selected. Check the price impact before you confirm: the pool is still small, so big orders move the price.`],
    [`How do I see ${T.symbol} in my wallet?`,
      `Press “Add to wallet” at the top of this page, or add a custom token manually: network BNB Chain, address <code>${T.address}</code>, symbol ${T.symbol}, decimals ${T.decimals}.`],
    ['What is the total supply?',
      `${groupNum(T.totalSupply)} ${T.symbol}. You can check it on <a href="${T.explorerUrl}" target="_blank" rel="noopener">BscScan</a>, along with every wallet that holds ${T.symbol}.`],
    ['Where can I see live price, liquidity and holders?',
      `The numbers on this page come live from <a href="${T.chartUrl}" target="_blank" rel="noopener">DexScreener</a>. Holders and transfers are on <a href="${T.explorerUrl}" target="_blank" rel="noopener">BscScan</a>.`],
    [`Is ${T.symbol} an investment?`,
      `No. ${T.symbol} is a utility token for the TipDrop community, and nothing here is a promise of profit. Crypto prices can fall to zero. Only buy what you can afford to lose, and check the rules where you live.`],
    ['How do I contact the team?',
      `Join the <a href="https://t.me/TipDropGroup" target="_blank" rel="noopener">Telegram chat</a> or message us on <a href="https://x.com/TipDropPro" target="_blank" rel="noopener">X</a>. The team will never DM you first or ask for your seed phrase.`]
  ];
};

function viewToken() {
  setNav('token'); setWide(true);
  const T = CONFIG.TOKEN;
  const allocs = T.allocations;
  const total = allocs.reduce((s, a) => s + a.pct, 0);

  app.innerHTML = `
  <div class="stack token-page">
    <div class="tk-top">
    <section class="tk-hero">
      <img class="tk-logo" src="/logo.png" alt="" width="84" height="84">
      <div class="tk-title">
        <h1>${esc(T.name)} <span class="tk-sym">$${esc(T.symbol)}</span></h1>
        <p>The community token of TipDrop. <span class="tk-net"><i class="cdot" style="background:${chainOf(T.chain).color}"></i>${esc(chainOf(T.chain).name)}</span></p>
      </div>
    </section>

    <div class="row tk-cta">
      <a class="btn primary" href="${T.buyUrl}" target="_blank" rel="noopener">Buy on PancakeSwap ${TOKEN_ICONS.ext}</a>
      <a class="btn ghost" href="${T.chartUrl}" target="_blank" rel="noopener">Chart</a>
    </div>
    </div>

    <div class="tk-grid">

    <div class="card ga-contract">
      <span class="label">Contract address</span>
      <div class="addr"><code>${T.address}</code><button class="icon-btn" type="button" id="tkCopy" aria-label="Copy contract address">${ICON.copy}</button></div>
      <div class="row">
        <button class="btn ghost sm" type="button" id="tkAdd">${TOKEN_ICONS.wallet} Add to wallet</button>
        <a class="btn ghost sm" href="${T.explorerUrl}" target="_blank" rel="noopener">BscScan</a>
        <a class="btn ghost sm" href="${T.chartUrl}" target="_blank" rel="noopener">DexScreener</a>
      </div>
    </div>

    <div class="card ga-market">
      <div class="tk-head"><h3>Market</h3><span class="tk-live" id="tkUpdated">Loading…</span></div>
      <div class="stats">
        <div class="stat"><span>Price</span><b id="stPrice">—</b><em id="stChange"></em></div>
        <div class="stat"><span>Market cap</span><b id="stMcap">—</b></div>
        <div class="stat"><span>Liquidity</span><b id="stLiq">—</b></div>
        <div class="stat"><span>24h volume</span><b id="stVol">—</b></div>
      </div>
      <p class="fine">Live from DexScreener. TDP/USDT pool on PancakeSwap.</p>
    </div>

    <div class="card ga-tokenomics">
      <h2>Tokenomics</h2>
      <div class="tk-supply">
        <div><span>Total supply</span><b>${groupNum(T.totalSupply)} ${esc(T.symbol)}</b></div>
        <div><span>Network</span><b>${esc(chainOf(T.chain).name)} (BEP-20)</b></div>
      </div>
      <div class="tk-chart">
        ${donut(allocs)}
        <ul class="legend">
          ${allocs.map(a => `
            <li>
              <i style="background:${a.color}"></i>
              <span class="lg-name">${esc(a.label)}${a.wallet ? `<a class="lg-wallet" href="${chainOf(T.chain).explorer}/address/${esc(a.wallet)}" target="_blank" rel="noopener">${short(a.wallet)}</a>` : ''}</span>
              <b>${a.pct}%</b>
              <small>${groupNum(Math.round(T.totalSupply * a.pct / 100))}</small>
            </li>`).join('')}
        </ul>
      </div>
      ${total !== 100 ? `<p class="msg err">Allocations add up to ${total}%, not 100%. Fix them in config.js.</p>` : ''}
      <p class="fine">Live liquidity and holders: <a href="${T.chartUrl}" target="_blank" rel="noopener">DexScreener</a> · <a href="${T.explorerUrl}#balances" target="_blank" rel="noopener">BscScan holders</a></p>
    </div>

    <div class="card ga-community">
      <h2>Community</h2>
      <div class="socials">
        ${T.socials.map(s => `
          <a class="social" href="${s.url}" target="_blank" rel="noopener">
            <span class="social-ic">${TOKEN_ICONS[s.icon] || TOKEN_ICONS.ext}</span>
            <span class="social-txt"><b>${esc(s.label)}</b><small>${esc(s.handle)}</small></span>
          </a>`).join('')}
      </div>
    </div>
    </div>

    <section class="stack">
      <h2>FAQ</h2>
      <div class="faq">
        ${FAQ().map(([q, a], i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(q)}</summary><p>${a}</p></details>`).join('')}
      </div>
    </section>

    <p class="fine tk-disclaimer">Nothing on this page is financial advice. ${esc(T.symbol)} is not an investment product and comes with no promise of returns.</p>
  </div>`;

  $('#tkCopy').onclick = () => copy(T.address, 'Contract address copied');
  $('#tkAdd').onclick = async () => {
    const e = eth();
    if (!e) return toast('Open this page in your wallet app, or add the token manually (see FAQ).');
    try {
      await ensureChain(e, T.chain);
      const ok = await e.request({ method: 'wallet_watchAsset', params: { type: 'ERC20', options: { address: T.address, symbol: T.symbol, decimals: T.decimals, image: new URL('/logo.png', location.href).href } } });
      toast(ok === false ? 'Not added' : `${T.symbol} added to your wallet`);
    } catch (err) { toast(friendly(err)); }
  };

  async function loadStats() {
    try {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${T.chain}/${T.pair}`, { headers: { accept: 'application/json' } });
      const j = await r.json();
      const p = (j.pairs && j.pairs[0]) || j.pair;
      if (!p || !$('#stPrice')) throw new Error('no data');
      $('#stPrice').textContent = priceUsd(p.priceUsd);
      const ch = p.priceChange?.h24;
      const el = $('#stChange');
      if (ch != null) { el.textContent = (ch > 0 ? '+' : '') + Number(ch).toFixed(1) + '% 24h'; el.className = ch > 0 ? 'up' : ch < 0 ? 'down' : ''; }
      $('#stMcap').textContent = compactUsd(p.marketCap ?? p.fdv);
      $('#stLiq').textContent = compactUsd(p.liquidity?.usd);
      $('#stVol').textContent = compactUsd(p.volume?.h24);
      $('#tkUpdated').textContent = 'Live · updated ' + new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      $('#tkUpdated').classList.add('on');
    } catch {
      const u = $('#tkUpdated'); if (u) { u.textContent = 'Couldn’t load live data'; u.classList.remove('on'); }
    }
  }
  loadStats();
  state.timers.push(setInterval(loadStats, 30000));
}
