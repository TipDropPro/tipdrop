"use strict";
/* ============================================================
   TipDrop — Solana module
   Tips are fresh Solana keypairs (the 32-byte seed travels in the link as hex).
   USDC/USDT are SPL tokens; SOL tips pay their own tiny fee.
   The Solana library loads only when someone actually uses Solana.
   ============================================================ */
const SOL = (() => {
  // pinned on purpose: 1.95.6 and 1.95.7 were compromised in a 2024 supply-chain attack
  const LIB = 'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.95.8/lib/index.iife.min.js';
  const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  const BASE_FEE = 5000n;                 // lamports per signature
  const ATA_RENT = 2039280n;              // lamports to open a token account
  const RENT_MIN = 890880n;               // smallest balance a brand-new SOL account may hold
  const NATIVE_BUFFER = 10000n;           // added to SOL tips so the claim fee doesn't come out of the gift
  const FALLBACK_TOPUP = '0.0025';        // SOL a token tip carries when the site has no fee service

  let _ready = null, W = null, _conn = null;
  function ready() {
    if (W) return Promise.resolve();
    if (!_ready) _ready = new Promise((res, rej) => {
      if (window.solanaWeb3) { W = window.solanaWeb3; return res(); }
      const s = document.createElement('script');
      s.src = LIB; s.async = true;
      s.onload = () => { W = window.solanaWeb3; W ? res() : rej(new Error('Solana support didn’t load. Refresh the page.')); };
      s.onerror = () => { _ready = null; rej(new Error('Solana support didn’t load. Check your connection and refresh.')); };
      document.head.appendChild(s);
    });
    return _ready;
  }
  const ch = () => CONFIG.CHAINS.solana;

  async function conn() {
    await ready();
    if (_conn) return _conn;
    for (const url of ch().rpcs) {
      try {
        const c = new W.Connection(url, 'confirmed');
        await Promise.race([c.getLatestBlockhash(), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 7000))]);
        return (_conn = c);
      } catch { /* next */ }
    }
    throw new Error('Could not reach Solana. Check your connection and try again.');
  }

  /* ---------- keys and addresses ---------- */
  const pk = s => new W.PublicKey(String(s).trim());
  function isAddress(s) {
    if (!W) return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(s || '').trim());
    try { const v = String(s).trim(); return pk(v).toBase58() === v; } catch { return false; }
  }
  const hexToBytes = h => Uint8Array.from(String(h).replace(/^0x/, '').match(/../g).map(b => parseInt(b, 16)));
  const bytesToHex = b => '0x' + [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  function newTip() {
    const seed = new Uint8Array(32); crypto.getRandomValues(seed);
    const kp = W.Keypair.fromSeed(seed);
    return { address: kp.publicKey.toBase58(), pk: bytesToHex(seed) };
  }
  const keypair = hex => W.Keypair.fromSeed(hexToBytes(hex));
  const addressOf = hex => keypair(hex).publicKey.toBase58();
  const ata = (owner, mint) => W.PublicKey.findProgramAddressSync([pk(owner).toBytes(), pk(TOKEN_PROGRAM).toBytes(), pk(mint).toBytes()], pk(ATA_PROGRAM))[0];

  /* ---------- instructions (SPL token, built by hand: no extra library needed) ---------- */
  const u64 = n => { const b = new Uint8Array(8); let v = BigInt(n); for (let i = 0; i < 8; i++) { b[i] = Number(v & 255n); v >>= 8n; } return b; };
  const ixAtaIdempotent = (payer, owner, mint) => new W.TransactionInstruction({
    programId: pk(ATA_PROGRAM),
    keys: [
      { pubkey: pk(payer), isSigner: true, isWritable: true },
      { pubkey: ata(owner, mint), isSigner: false, isWritable: true },
      { pubkey: pk(owner), isSigner: false, isWritable: false },
      { pubkey: pk(mint), isSigner: false, isWritable: false },
      { pubkey: W.SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: pk(TOKEN_PROGRAM), isSigner: false, isWritable: false }
    ],
    data: Uint8Array.of(1)
  });
  const ixTransferChecked = (src, mint, dst, owner, amount, decimals) => new W.TransactionInstruction({
    programId: pk(TOKEN_PROGRAM),
    keys: [
      { pubkey: src, isSigner: false, isWritable: true },
      { pubkey: pk(mint), isSigner: false, isWritable: false },
      { pubkey: dst, isSigner: false, isWritable: true },
      { pubkey: pk(owner), isSigner: true, isWritable: false }
    ],
    data: Uint8Array.from([12, ...u64(amount), decimals])
  });
  const ixClose = (account, dest, owner) => new W.TransactionInstruction({
    programId: pk(TOKEN_PROGRAM),
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: pk(dest), isSigner: false, isWritable: true },
      { pubkey: pk(owner), isSigner: true, isWritable: false }
    ],
    data: Uint8Array.of(9)
  });
  const ixSol = (from, to, lamports) => W.SystemProgram.transfer({ fromPubkey: pk(from), toPubkey: pk(to), lamports: BigInt(lamports) });

  /* ---------- reading ---------- */
  const nativeToken = () => ({ ...ch().native, address: null, decimals: 9, native: true });
  async function balances(addr) {
    const c = await conn();
    const owner = pk(addr);
    const [lamports, accs] = await Promise.all([
      c.getBalance(owner),
      c.getParsedTokenAccountsByOwner(owner, { programId: pk(TOKEN_PROGRAM) })
    ]);
    const byMint = {};
    for (const a of accs.value) {
      const info = a.account.data.parsed.info;
      if (a.pubkey.toBase58() !== ata(addr, info.mint).toBase58()) continue; // only standard token accounts
      byMint[info.mint] = BigInt(info.tokenAmount.amount);
    }
    return [{ token: nativeToken(), bal: BigInt(lamports) }, ...ch().tokens.map(t => ({ token: t, bal: byMint[t.address] || 0n }))];
  }
  async function balanceOf(addr, token) {
    const all = await balances(addr);
    return token.native ? all[0].bal : (all.find(x => x.token.address === token.address)?.bal || 0n);
  }
  async function hadActivity(addr) {
    const c = await conn();
    return (await c.getSignaturesForAddress(pk(addr), { limit: 1 })).length > 0;
  }

  /* ---------- wallet (Phantom, Solflare, Backpack) ---------- */
  const provider = () => window.phantom?.solana || window.solflare || window.backpack?.solana || (window.solana?.connect ? window.solana : null);
  async function connect() {
    await ready();
    const p = provider();
    if (!p) throw new Error('No Solana wallet found in this browser. Open this page inside Phantom or Solflare, or paste an address instead.');
    const r = await p.connect();
    const key = r?.publicKey || p.publicKey;
    return key.toBase58();
  }
  async function sendWithWallet(ixs) {
    const p = provider();
    const me = await connect();
    const c = await conn();
    const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash();
    const tx = new W.Transaction({ feePayer: pk(me), blockhash, lastValidBlockHeight }).add(...ixs);
    let sig;
    if (p.signAndSendTransaction) { const r = await p.signAndSendTransaction(tx); sig = r?.signature || r; }
    else { const signed = await p.signTransaction(tx); sig = await c.sendRawTransaction(signed.serialize()); }
    const res = await c.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    if (res.value.err) throw new Error('The network rejected the payment. Nothing was sent.');
    return sig;
  }
  // pay `units` of `token` from the connected wallet to `to`
  async function payTo(to, token, units) {
    const me = await connect();
    const c = await conn();
    const mine = await balances(me);
    const sol = mine[0].bal;
    if (token.native) {
      if (sol < units + BASE_FEE) throw new Error(`Your wallet has ${fmt(sol, 9)} SOL. You need a bit more than ${fmt(units, 9)} SOL including the network fee.`);
      const info = await c.getAccountInfo(pk(to));
      if (!info && units < RENT_MIN) throw new Error('Solana needs at least 0.00089 SOL to arrive in a brand-new wallet. Send a little more.');
      return sendWithWallet([ixSol(me, to, units)]);
    }
    const have = mine.find(x => x.token.address === token.address)?.bal || 0n;
    if (have < units) throw new Error(`Your wallet has ${fmt(have, token.decimals)} ${token.symbol} on Solana. This needs ${fmt(units, token.decimals)}.`);
    const needRent = (await c.getAccountInfo(ata(to, token.address))) ? 0n : ATA_RENT;
    if (sol < BASE_FEE + needRent) throw new Error(`Your wallet needs a little SOL (about ${fmt(BASE_FEE + needRent, 9)}) to pay the network fee.`);
    return sendWithWallet([
      ixAtaIdempotent(me, to, token.address),
      ixTransferChecked(ata(me, token.address), token.address, ata(to, token.address), me, units, token.decimals)
    ]);
  }

  /* ---------- claiming ---------- */
  const b64ToBytes = s => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));

  // with the fee service: the server builds the claim, pays the fees and signs as fee payer; we add the tip's signature
  async function claimViaService(hex, to, log) {
    const kp = keypair(hex), c = await conn();
    const li = log('Preparing your claim…');
    const r = await fetch('/api/sol', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tip: kp.publicKey.toBase58(), to }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) { li.className = 'err'; li.textContent = j.error || 'The fee service didn’t answer.'; return null; }
    li.className = 'ok'; li.textContent = 'Network fee covered';
    const tx = W.Transaction.from(b64ToBytes(j.tx));
    if (tx.feePayer?.toBase58() === kp.publicKey.toBase58()) throw new Error('Unexpected claim from the fee service.');
    tx.partialSign(kp);
    const li2 = log(`Sending ${esc(j.summary || 'your tip')}…`);
    const sig = await c.sendRawTransaction(tx.serialize());
    const res = await c.confirmTransaction({ signature: sig, blockhash: j.blockhash, lastValidBlockHeight: j.lastValidBlockHeight }, 'confirmed');
    if (res.value.err) throw new Error('The network rejected the claim. Nothing was moved; try again.');
    li2.className = 'ok'; li2.innerHTML = `Sent ${esc(j.summary || 'your tip')} ${explorerTx('solana', sig)}`;
    return sig;
  }

  // without the fee service: the tip pays its own fees from SOL it carries
  async function claimSelf(hex, to, log) {
    const kp = keypair(hex), c = await conn(), tip = kp.publicKey.toBase58();
    const bals = await balances(tip);
    const held = bals.filter(x => !x.token.native && x.bal > 0n);
    let lamports = bals[0].bal;
    const ixs = [];
    let newAccounts = 0n, summary = [];
    for (const h of held) {
      const dst = ata(to, h.token.address);
      if (!(await c.getAccountInfo(dst))) newAccounts++;
      ixs.push(ixAtaIdempotent(tip, to, h.token.address));
      ixs.push(ixTransferChecked(ata(tip, h.token.address), h.token.address, dst, tip, h.bal, h.token.decimals));
      ixs.push(ixClose(ata(tip, h.token.address), to, tip)); // the tip's token-account deposit goes to the recipient too
      summary.push(`${fmt(h.bal, h.token.decimals)} ${h.token.symbol}`);
    }
    const cost = BASE_FEE + newAccounts * ATA_RENT;
    if (lamports < cost) { const e = new Error('NEED_GAS'); e.need = cost - lamports + BASE_FEE; throw e; }
    const rest = lamports - cost;
    if (rest > 0n) {
      const toInfo = await c.getAccountInfo(pk(to));
      if (toInfo || held.length || rest >= RENT_MIN) { ixs.push(ixSol(tip, to, rest)); summary.push(`${fmt(rest, 9)} SOL`); }
    }
    if (!ixs.length) throw new Error('There’s nothing left to claim in this link.');
    const li = log(`Sending ${esc(summary.join(' + '))}…`);
    const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash();
    const tx = new W.Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
    tx.sign(kp);
    const sig = await c.sendRawTransaction(tx.serialize());
    const res = await c.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    if (res.value.err) throw new Error('The network rejected the claim. Nothing was moved; try again.');
    li.className = 'ok'; li.innerHTML = `Sent ${esc(summary.join(' + '))} ${explorerTx('solana', sig)}`;
    return sig;
  }

  async function claim(hex, to, log) {
    await ready();
    log('Checking balances…');
    const tip = addressOf(hex);
    const bals = await balances(tip);
    const hasTokens = bals.some(x => !x.token.native && x.bal > 0n);
    if (hasTokens && await getFuelInfo('solana')) {
      const sig = await claimViaService(hex, to, log);
      if (sig) return { hashes: [sig] };
    }
    return { hashes: [await claimSelf(hex, to, log)] };
  }

  return {
    ready, isAddress, newTip, addressOf, balances, balanceOf, hadActivity, connect, payTo, claim,
    NATIVE_BUFFER, FALLBACK_TOPUP, ATA_RENT, BASE_FEE
  };
})();
