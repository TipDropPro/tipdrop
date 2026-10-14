/*
  TipDrop fee service ("fuel") — multi-chain
  ------------------------------------------
  Tips hold only tokens (USDT/USDC), but moving tokens costs a little gas in the chain's own coin
  (BNB, ETH or POL). When someone claims a tip, the page calls this function. It sends the tip just
  enough gas from your GAS wallet, and the claim pays you a fee in USDT/USDC that covers it.
  The fee follows real gas prices, so it never costs you money, even on Ethereum.

  GET  /api/fuel?chain=base            -> { enabled, chain, fee, feeTo, refundTo, minTip, nativeUsd }
  POST /api/fuel {address, chain}      -> { ok, feeTo, feeToken, fee, refundTo, hash? }

  Environment variables (Netlify → Site configuration → Environment variables):
    GAS_WALLET_KEY   required. Private key of a NEW wallet used only for gas.
                     The same wallet works on every chain; fund it on each chain you use
                     (BNB on BNB Chain, ETH on Base / Arbitrum / Ethereum, POL on Polygon).
    MIN_FEE          smallest fee per claim in USD (paid in USDT/USDC). Default 0.05
    FEE_RECEIVER     address that receives fees. Default: the gas wallet itself
    DAILY_LIMIT      max top-ups per day per chain. Default 300 (Ethereum: 30)
    PER_IP_LIMIT     max top-ups per day per visitor IP, all chains. Default 20
    MAX_FUEL_USD     most gas sent to one tip, in USD. Default 3 (Ethereum: 15)
    RPC_BSC, RPC_BASE, RPC_ARBITRUM, RPC_POLYGON, RPC_ETHEREUM   optional private RPC per chain
    PRICE_BNB, PRICE_ETH, PRICE_POL   backup prices if the price services are down
*/
import { ethers } from 'ethers';
import { getStore } from '@netlify/blobs';

// Keep tokens in sync with public/js/config.js
const CHAINS = {
  bsc: {
    id: 56, native: 'BNB', priceId: 'binancecoin', gasFloorGwei: '0.05', transferGas: 60000n,
    rpcs: ['https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed1.binance.org', 'https://bsc-rpc.publicnode.com'],
    minTip: '1',
    tokens: [
      { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
      { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 }
    ]
  },
  base: {
    id: 8453, native: 'ETH', priceId: 'ethereum', transferGas: 70000n, l1FeeBuffer: '0.000005',
    rpcs: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
    minTip: '1',
    tokens: [{ symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 }]
  },
  arbitrum: {
    id: 42161, native: 'ETH', priceId: 'ethereum', transferGas: 600000n, // Arbitrum gas units include its L1 cost
    rpcs: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'],
    minTip: '1',
    tokens: [
      { symbol: 'USDT', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
      { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 }
    ]
  },
  polygon: {
    id: 137, native: 'POL', priceId: 'polygon-ecosystem-token', transferGas: 70000n,
    rpcs: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'],
    minTip: '1',
    tokens: [
      { symbol: 'USDT', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
      { symbol: 'USDC', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 }
    ]
  },
  ethereum: {
    id: 1, native: 'ETH', priceId: 'ethereum', transferGas: 70000n, expensive: true,
    rpcs: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'],
    minTip: '20', dailyLimit: 30, maxFuelUsd: 15,
    tokens: [
      { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
      { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 }
    ]
  }
};
const ERC20 = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)'
];
const FALLBACK_PRICE = { binancecoin: 1000, ethereum: 5000, 'polygon-ecosystem-token': 1 }; // deliberately high: overcharging a cent beats losing money
const COINBASE_PAIR = { binancecoin: 'BNB-USD', ethereum: 'ETH-USD', 'polygon-ecosystem-token': 'POL-USD' };
const ENV_PRICE = { binancecoin: 'PRICE_BNB', ethereum: 'PRICE_ETH', 'polygon-ecosystem-token': 'PRICE_POL' };

const env = k => String(globalThis.Netlify?.env?.get(k) ?? process.env[k] ?? '').trim();
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

/* ---------- helpers ---------- */
const providers = {};
async function getProvider(key) {
  if (providers[key]) return providers[key];
  const c = CHAINS[key];
  const custom = env('RPC_' + key.toUpperCase());
  for (const url of custom ? [custom, ...c.rpcs] : c.rpcs) {
    try {
      const p = new ethers.JsonRpcProvider(url, c.id, { staticNetwork: true });
      await p.getBlockNumber();
      return (providers[key] = p);
    } catch { /* next */ }
  }
  throw new Error('rpc ' + key);
}

async function gasPriceOf(key, p) {
  const c = CHAINS[key];
  const fd = await p.getFeeData();
  let gp = fd.gasPrice ?? ethers.parseUnits('1', 'gwei');
  if (c.gasFloorGwei) { const f = ethers.parseUnits(c.gasFloorGwei, 'gwei'); if (gp < f) gp = f; }
  return key === 'bsc' ? gp : gp * 12n / 10n; // small bump so a rising base fee doesn't stall the claim
}

let priceCache = { at: 0, prices: {} };
async function priceOf(id) {
  if (Date.now() - priceCache.at < 60_000 && priceCache.prices[id]) return priceCache.prices[id];
  let price = 0;
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin,ethereum,polygon-ecosystem-token&vs_currencies=usd', { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    const prices = Object.fromEntries(Object.entries(j).map(([k, v]) => [k, Number(v.usd)]));
    priceCache = { at: Date.now(), prices };
    price = prices[id] || 0;
  } catch { /* try backup */ }
  if (!price) {
    try {
      const r = await fetch(`https://api.coinbase.com/v2/prices/${COINBASE_PAIR[id]}/spot`, { signal: AbortSignal.timeout(4000) });
      price = Number((await r.json())?.data?.amount) || 0;
    } catch { }
  }
  return price || Number(env(ENV_PRICE[id])) || FALLBACK_PRICE[id];
}

// native coin amount (wei) -> USD cents, rounded up
function toCents(wei, price) {
  const usd = Number(ethers.formatEther(wei)) * price;
  return Math.ceil(usd * 100);
}
const centsToStr = c => (c / 100).toFixed(2);

function feeCents(costWei, price) {
  const minCents = Math.round(Number(env('MIN_FEE') || '0.05') * 100);
  return Math.max(minCents, toCents(costWei, price));
}

/* ---------- handler ---------- */
export default async (req, context) => {
  const url = new URL(req.url);
  let gasWallet = null;
  const key = env('GAS_WALLET_KEY');
  try { if (key) gasWallet = new ethers.Wallet(key.startsWith('0x') ? key : '0x' + key); } catch { gasWallet = null; }
  const recv = env('FEE_RECEIVER');
  const feeTo = ethers.isAddress(recv) ? ethers.getAddress(recv) : gasWallet?.address;

  let body = {};
  if (req.method === 'POST') { try { body = await req.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); } }
  const chainKey = String((req.method === 'POST' ? body.chain : url.searchParams.get('chain')) || 'bsc').toLowerCase();
  const c = CHAINS[chainKey];
  if (!c) return json({ ok: false, enabled: false, error: 'Unknown chain.' }, 400);

  /* ---- quote ---- */
  if (req.method === 'GET') {
    if (!gasWallet) return json({ enabled: false });
    try {
      const p = await getProvider(chainKey);
      const [gp, price] = await Promise.all([gasPriceOf(chainKey, p), priceOf(c.priceId)]);
      const l1 = c.l1FeeBuffer ? ethers.parseEther(c.l1FeeBuffer) : 0n;
      const cost = (c.transferGas * gp + l1) * 2n; // tip transfer + fee transfer
      return json({
        enabled: true, chain: chainKey, fee: centsToStr(feeCents(cost, price)), feeTo, refundTo: gasWallet.address,
        minTip: c.minTip, nativeUsd: price, expensive: !!c.expensive
      });
    } catch (e) {
      console.error('quote error', chainKey, e);
      return json({ enabled: false, error: 'busy' });
    }
  }

  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  if (!gasWallet) return json({ ok: false, error: 'The fee service isn’t set up on this site.' }, 503);
  if (!ethers.isAddress(body.address)) return json({ ok: false, error: 'Bad tip address.' }, 400);
  const tip = ethers.getAddress(body.address);

  try {
    /* ---- limits (protect the gas wallet) ---- */
    const store = getStore('fuel');
    const day = new Date().toISOString().slice(0, 10);
    const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown';
    const dayKey = `day/${chainKey}/${day}`, ipKey = `ip/${day}/${ip}`;
    const [dayCount, ipCount] = (await Promise.all([store.get(dayKey), store.get(ipKey)])).map(v => Number(v || 0));
    const dailyLimit = Number(env('DAILY_LIMIT_' + chainKey.toUpperCase()) || (c.dailyLimit ?? (Number(env('DAILY_LIMIT')) || 300)));
    if (dayCount >= dailyLimit) return json({ ok: false, error: 'Free claim fees are used up for today on this network.' }, 429);
    if (ipCount >= Number(env('PER_IP_LIMIT') || 20)) return json({ ok: false, error: 'Too many claims from this connection today.' }, 429);

    /* ---- look at the tip ---- */
    const p = await getProvider(chainKey);
    const [bal, ...bals] = await Promise.all([
      p.getBalance(tip),
      ...c.tokens.map(t => new ethers.Contract(t.address, ERC20, p).balanceOf(tip))
    ]);
    const held = c.tokens.map((t, i) => ({ t, bal: bals[i] })).filter(x => x.bal > 0n);
    const eligible = held
      .filter(x => x.bal >= ethers.parseUnits(c.minTip, x.t.decimals))
      .sort((a, b) => (b.bal > a.bal ? 1 : b.bal < a.bal ? -1 : 0));
    if (!eligible.length) return json({ ok: false, error: `Free claim fees are for tips of at least ${c.minTip} USDT or USDC on this network.` }, 400);

    /* ---- how much gas the claim needs: every token transfer + the fee transfer + one spare ---- */
    const [gp, price] = await Promise.all([gasPriceOf(chainKey, p), priceOf(c.priceId)]);
    // use a real estimate when the node gives one (it works even though the tip has no gas yet)
    let estimated = 0n;
    for (const x of held) {
      try {
        const g = await new ethers.Contract(x.t.address, ERC20, p).transfer.estimateGas(feeTo, x.bal, { from: tip });
        const padded = g * 13n / 10n;
        if (padded > estimated) estimated = padded;
      } catch { /* fall back to the default below */ }
    }
    const perTransfer = estimated || c.transferGas;
    const l1 = c.l1FeeBuffer ? ethers.parseEther(c.l1FeeBuffer) : 0n;
    const perTx = perTransfer * gp + l1;
    const realTx = BigInt(held.length + 1);          // each token to the recipient + the fee transfer
    const need = (realTx + 1n) * perTx;              // + one spare; unused gas comes back to you
    const maxUsd = Number(env('MAX_FUEL_USD_' + chainKey.toUpperCase()) || c.maxFuelUsd || env('MAX_FUEL_USD') || 3);
    const capWei = ethers.parseEther((maxUsd / price).toFixed(18));
    if (need > capWei) return json({ ok: false, error: 'Network fees are unusually high right now. Try again later.' }, 503);

    /* ---- the fee: real gas cost in USD, at least MIN_FEE, taken from the biggest token ---- */
    const feeToken = eligible[0];
    const cents = feeCents(realTx * perTx, price);
    const fee = ethers.parseUnits(centsToStr(cents), feeToken.t.decimals);
    if (fee * 2n > feeToken.bal) return json({ ok: false, error: 'Network fees are too high for a tip this small right now.' }, 400);
    const answer = extra => json({ ok: true, feeTo, feeToken: feeToken.t.address, fee: fee.toString(), feeUsd: centsToStr(cents), refundTo: gasWallet.address, ...extra });

    if (bal >= need) return answer({ already: true });

    const send = need - bal;
    const signer = gasWallet.connect(p);
    const own = await p.getBalance(gasWallet.address);
    if (own < send + (21000n * gp + l1) * 2n) {
      console.error(`Gas wallet is low on ${chainKey}:`, ethers.formatEther(own), c.native, 'at', gasWallet.address);
      return json({ ok: false, error: 'The fee service is out of gas on this network right now.' }, 503);
    }

    const tx = await signer.sendTransaction({ to: tip, value: send, gasPrice: gp, gasLimit: 21000n });
    await Promise.all([store.set(dayKey, String(dayCount + 1)), store.set(ipKey, String(ipCount + 1))]);
    await tx.wait(1);
    return answer({ hash: tx.hash, sent: send.toString() });
  } catch (e) {
    console.error('fuel error', chainKey, e);
    return json({ ok: false, error: 'The fee service had a problem. Try again in a minute.' }, 500);
  }
};

export const config = { path: '/api/fuel' };
