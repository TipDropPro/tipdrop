/*
  TipDrop fee service for Solana
  ------------------------------
  Solana lets one account pay the fees for a transaction signed by another. So when someone
  claims a USDC/USDT tip, this function builds the whole claim and signs it as the fee payer;
  the page adds the tip's own signature and sends it. The recipient needs no SOL at all.

  Per claim the service:
    pays     ~0.000005 SOL network fee, and opens the recipient's token account if needed (~0.002 SOL)
    gets     the tip's own token-account deposit back (~0.002 SOL), plus the fee in USDC/USDT
  so it stays roughly even on SOL and earns the fee.

  GET  /api/sol                 -> { enabled, fee, feeTo, minTip }
  POST /api/sol {tip, to}       -> { ok, tx (base64, signed by the service), blockhash, lastValidBlockHeight, summary }

  Environment variables:
    SOLANA_GAS_KEY   required for Solana. Secret key of a NEW Solana wallet used only for fees
                     (the base58 "private key" Phantom exports, or the [1,2,…] array from a key file).
                     Keep about 0.05 SOL in it.
    MIN_FEE          fee per claim in USD, taken in USDC/USDT. Default 0.05
    SOLANA_FEE_RECEIVER  Solana address that receives fees. Default: the fee wallet itself
    DAILY_LIMIT_SOLANA   max claims per day. Default 300
    PER_IP_LIMIT     max claims per day per visitor IP (shared with the other networks). Default 20
    RPC_SOLANA       optional private Solana RPC (Helius, QuickNode…), recommended for real traffic
*/
import * as web3 from '@solana/web3.js';
import { getStore } from '@netlify/blobs';

const { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram } = web3;

// Keep in sync with public/js/config.js
const TOKENS = [
  { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  { symbol: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 }
];
const MIN_TIP = 1; // in tokens
const RPCS = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const RENT_MIN = 890880n;

const env = k => String(globalThis.Netlify?.env?.get(k) ?? process.env[k] ?? '').trim();
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

/* ---------- keys ---------- */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Decode(s) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error('bad base58'); n = n * 58n + BigInt(i); }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of s) { if (c === '1') bytes.unshift(0); else break; }
  return Uint8Array.from(bytes);
}
function loadGasKey() {
  const raw = env('SOLANA_GAS_KEY');
  if (!raw) return null;
  try {
    const bytes = raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw)) : base58Decode(raw);
    return bytes.length === 64 ? Keypair.fromSecretKey(bytes) : Keypair.fromSeed(bytes.slice(0, 32));
  } catch { return null; }
}
const isAddress = s => { try { return new PublicKey(String(s)).toBase58() === String(s); } catch { return false; } };

/* ---------- chain helpers ---------- */
let _conn = null;
async function conn() {
  if (_conn) return _conn;
  const custom = env('RPC_SOLANA');
  for (const url of custom ? [custom, ...RPCS] : RPCS) {
    try { const c = new Connection(url, 'confirmed'); await c.getLatestBlockhash(); return (_conn = c); } catch { /* next */ }
  }
  throw new Error('rpc solana');
}
const ata = (owner, mint) => PublicKey.findProgramAddressSync([owner.toBytes(), TOKEN_PROGRAM.toBytes(), mint.toBytes()], ATA_PROGRAM)[0];
const u64 = n => { const b = new Uint8Array(8); let v = BigInt(n); for (let i = 0; i < 8; i++) { b[i] = Number(v & 255n); v >>= 8n; } return b; };
const ixAtaIdempotent = (payer, owner, mint) => new TransactionInstruction({
  programId: ATA_PROGRAM,
  keys: [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: ata(owner, mint), isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false }
  ],
  data: Buffer.from([1])
});
const ixTransferChecked = (src, mint, dst, owner, amount, decimals) => new TransactionInstruction({
  programId: TOKEN_PROGRAM,
  keys: [
    { pubkey: src, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: dst, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: true, isWritable: false }
  ],
  data: Buffer.from([12, ...u64(amount), decimals])
});
const ixClose = (account, dest, owner) => new TransactionInstruction({
  programId: TOKEN_PROGRAM,
  keys: [
    { pubkey: account, isSigner: false, isWritable: true },
    { pubkey: dest, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: true, isWritable: false }
  ],
  data: Buffer.from([9])
});
const fmt = (v, d) => { const s = v.toString().padStart(d + 1, '0'); return (s.slice(0, -d) + '.' + s.slice(-d)).replace(/\.?0+$/, ''); };

/* ---------- handler ---------- */
export default async (req, context) => {
  const gas = loadGasKey();
  const recv = env('SOLANA_FEE_RECEIVER');
  const feeOwner = gas ? (isAddress(recv) ? new PublicKey(recv) : gas.publicKey) : null;
  const minFee = Number(env('MIN_FEE') || '0.05');

  if (req.method === 'GET') {
    if (!gas) return json({ enabled: false });
    return json({ enabled: true, chain: 'solana', fee: minFee.toFixed(2), feeTo: feeOwner.toBase58(), minTip: String(MIN_TIP) });
  }
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  if (!gas) return json({ ok: false, error: 'The Solana fee service isn’t set up on this site.' }, 503);

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!isAddress(body?.tip) || !isAddress(body?.to)) return json({ ok: false, error: 'Enter a valid Solana address.' }, 400);
  if (body.tip === body.to) return json({ ok: false, error: 'That’s the tip’s own address. Enter your wallet address.' }, 400);
  const tip = new PublicKey(body.tip), to = new PublicKey(body.to);

  try {
    /* ---- limits ---- */
    const store = getStore('fuel');
    const day = new Date().toISOString().slice(0, 10);
    const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown';
    const dayKey = `day/solana/${day}`, ipKey = `ip/${day}/${ip}`;
    const [dayCount, ipCount] = (await Promise.all([store.get(dayKey), store.get(ipKey)])).map(v => Number(v || 0));
    if (dayCount >= Number(env('DAILY_LIMIT_SOLANA') || 300)) return json({ ok: false, error: 'Free claims are used up for today on Solana.' }, 429);
    if (ipCount >= Number(env('PER_IP_LIMIT') || 20)) return json({ ok: false, error: 'Too many claims from this connection today.' }, 429);

    /* ---- what's in the tip ---- */
    const c = await conn();
    const [lamports, accs] = await Promise.all([c.getBalance(tip), c.getParsedTokenAccountsByOwner(tip, { programId: TOKEN_PROGRAM })]);
    const held = [];
    for (const t of TOKENS) {
      const mint = new PublicKey(t.mint);
      const acc = accs.value.find(a => a.pubkey.equals(ata(tip, mint)));
      const bal = acc ? BigInt(acc.account.data.parsed.info.tokenAmount.amount) : 0n;
      if (bal > 0n) held.push({ ...t, mintKey: mint, bal });
    }
    held.sort((a, b) => (b.bal > a.bal ? 1 : -1));
    if (!held.length || held[0].bal < BigInt(MIN_TIP) * 10n ** BigInt(held[0].decimals))
      return json({ ok: false, error: `Free claims are for tips of at least ${MIN_TIP} USDC or USDT.` }, 400);

    /* ---- the fee, taken from the biggest token ---- */
    const feeTok = held[0];
    const fee = BigInt(Math.round(minFee * 10 ** feeTok.decimals));
    if (fee * 2n > feeTok.bal) return json({ ok: false, error: 'This tip is too small to claim for free.' }, 400);

    /* ---- build the claim ---- */
    const ixs = [];
    const summary = [];
    for (const h of held) {
      const src = ata(tip, h.mintKey);
      const sendAmt = h === feeTok ? h.bal - fee : h.bal;
      ixs.push(ixAtaIdempotent(gas.publicKey, to, h.mintKey));
      ixs.push(ixTransferChecked(src, h.mintKey, ata(to, h.mintKey), tip, sendAmt, h.decimals));
      if (h === feeTok) {
        ixs.push(ixAtaIdempotent(gas.publicKey, feeOwner, h.mintKey));
        ixs.push(ixTransferChecked(src, h.mintKey, ata(feeOwner, h.mintKey), tip, fee, h.decimals));
      }
      ixs.push(ixClose(src, gas.publicKey, tip)); // the tip's token-account deposit pays back the service
      summary.push(`${fmt(sendAmt, h.decimals)} ${h.symbol}`);
    }
    // any SOL sitting in the tip goes to the recipient (or to the service if it's too little to open a new wallet)
    if (lamports > 0) {
      const toInfo = await c.getAccountInfo(to);
      const dest = toInfo || BigInt(lamports) >= RENT_MIN ? to : gas.publicKey;
      ixs.push(SystemProgram.transfer({ fromPubkey: tip, toPubkey: dest, lamports: BigInt(lamports) }));
      if (dest === to) summary.push(`${fmt(BigInt(lamports), 9)} SOL`);
    }

    const own = await c.getBalance(gas.publicKey);
    if (own < 3 * 2039280 + 20000) {
      console.error('Solana fee wallet is low:', own / 1e9, 'SOL at', gas.publicKey.toBase58());
      return json({ ok: false, error: 'The Solana fee service is out of SOL right now.' }, 503);
    }

    const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash();
    const tx = new Transaction({ feePayer: gas.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
    tx.partialSign(gas);
    await Promise.all([store.set(dayKey, String(dayCount + 1)), store.set(ipKey, String(ipCount + 1))]);
    return json({
      ok: true,
      tx: Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64'),
      blockhash, lastValidBlockHeight,
      fee: fee.toString(), feeUsd: minFee.toFixed(2),
      summary: summary.join(' + ')
    });
  } catch (e) {
    console.error('sol error', e);
    return json({ ok: false, error: 'The fee service had a problem. Try again in a minute.' }, 500);
  }
};

export const config = { path: '/api/sol' };
