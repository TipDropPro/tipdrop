# TipDrop

Crypto tips and payment requests as links, on **BNB Chain, Solana, Base, Arbitrum, Polygon and Ethereum**.

- **Send a tip.** Put USDT, USDC or the network's coin (BNB, SOL, ETH, POL) inside a link. The recipient opens it, pastes an address (or connects a wallet) and claims. **The recipient never pays anything.**
- **Request money.** Make a payment link with your amount and address. Whoever opens it pays you directly, from a wallet or by scanning a QR. Free, and the money never passes through TipDrop.

## Supported networks

| Network | Tokens | Claim fee | Notes |
|---|---|---|---|
| BNB Chain | USDT, USDC, BNB | about $0.05 | |
| Solana | USDC, USDT, SOL | $0.05 | Wallets: Phantom, Solflare, Backpack. The fee service pays fees directly inside the claim |
| Base | USDC, ETH | about $0.05 | Base has no official USDT, only look-alikes, so it's left out on purpose |
| Arbitrum | USDT, USDC, ETH | about $0.05 | |
| Polygon | USDT, USDC, POL | about $0.05 | |
| Ethereum | USDT, USDC, ETH | live, often $1–5 | The app warns about high fees; smallest tip is 20 USDT/USDC |

## Who pays what

- **Tip recipient: nothing, ever.** For USDT/USDC, the fee service pays the gas at claim time and is repaid from the tip. By default the sender ticks "Cover the fee", so they send e.g. 30.05 and the recipient gets exactly 30. For BNB/ETH/POL tips, a tiny amount is added on top to pay the claim.
- **Tip sender:** the tip, the claim fee (if they cover it), and their own wallet's normal network fee for sending.
- **Request creator: nothing.** The payer sends straight to their address.
- **Request payer:** the amount plus their own wallet's normal network fee.

The claim fee follows real gas prices (minimum $0.05), so the fee service never loses money, even on Ethereum. It shows up live on the send page.

## Project layout

```
public/                  the website
  index.html, 404.html
  css/app.css
  js/config.js           networks, tokens, minimum tips, name
  js/app.js              the app
  js/solana.js           Solana support (its library loads only when Solana is used)
  js/token.js            the $TDP token page (yoursite/#token)
  icons, og-image.png, site.webmanifest, robots.txt
netlify/functions/
  fuel.mjs               the fee service for BNB Chain, Base, Arbitrum, Polygon, Ethereum
  sol.mjs                the fee service for Solana
netlify.toml             Netlify settings + security headers
brand/                   logo, token icons and header banners (not deployed)
token/                   DropToken.sol, the one-file token + vesting contract draft (OpenZeppelin)
package.json             libraries the fee service needs
```

## Deploy (GitHub + Netlify, no terminal)

Netlify's drag-and-drop can't run server functions, so deploy from GitHub. It's all clicks, and every later update is automatic.

1. **Put the files on GitHub.** github.com → **New repository** (e.g. `tipdrop`, Private is fine) → **uploading an existing file** → drag in everything from inside the unzipped `tipdrop` folder → **Commit changes**. On a Mac `.gitignore` is hidden; it's fine to skip it.
2. **Connect it to Netlify.** **Add new project** → **Import an existing project** → GitHub → pick `tipdrop` → **Deploy**. Leave the settings as they are; `netlify.toml` sets them.
3. **Create a gas wallet.** A brand-new wallet, used only for this (never your main one). In MetaMask: Add account → Account details → Show private key. The same address works on every network.
4. **Fund it on each network you want free claims on:**

   | Network | Send to the gas wallet | Covers roughly |
   |---|---|---|
   | BNB Chain | 0.01 BNB | 500+ claims |
   | Base | 0.002 ETH | 1,000+ claims |
   | Arbitrum | 0.002 ETH | 1,000+ claims |
   | Polygon | 5 POL | 300+ claims |
   | Ethereum | 0.01–0.02 ETH | 10–30 claims |

   A network with no gas money still works; its fee service just answers "out of gas" and the app falls back to asking for a little coin.
5. **Give Netlify the key.** Site configuration → **Environment variables** → Add variable `GAS_WALLET_KEY` with the private key (mark it secret, scope: Functions). Then **Deploys → Trigger deploy**.
6. **Solana (optional).** Solana uses different keys, so it has its own fee wallet. In Phantom: Add account → Settings → Manage accounts → Show private key, and copy it. Send it about **0.05 SOL**. Add the Netlify variable `SOLANA_GAS_KEY` with that key, then redeploy. Check `https://your-site.netlify.app/api/sol` shows `"enabled":true`.
7. **Check it.** Open `https://your-site.netlify.app/api/fuel?chain=base`. You should see `"enabled":true` and a fee.

Updating later: replace files on GitHub; Netlify redeploys by itself.

## How Solana claims work

Solana lets one account pay the fees for someone else's transaction. When a USDC/USDT tip is claimed, the fee service builds the whole claim and signs it as the fee payer, and the page adds the tip's signature. In one transaction the recipient gets the tip, you get the $0.05 fee, and the tip's token-account deposit (~0.002 SOL) goes back to your fee wallet, which pays for opening the recipient's account if they've never held that token. So the Solana fee wallet stays roughly even and the recipient needs no SOL at all.

One Solana quirk: sending USDC from a wallet to a brand-new address costs the sender about 0.002 SOL (~$0.30) once, to open that address's token account. Phantom adds it automatically; exchanges cover it themselves.

## Where the fees go

Claim fees go to your gas wallet (or `FEE_RECEIVER`). Unused gas comes back to the gas wallet after each claim. Every so often, swap some collected USDT/USDC back to BNB/ETH/POL on each network to keep it topped up. Watch the balances on bscscan.com, basescan.org, arbiscan.io, polygonscan.com and etherscan.io.

## Fee service settings (Netlify environment variables)

| Variable | Default | What it does |
|---|---|---|
| `GAS_WALLET_KEY` | required | Private key of the gas wallet |
| `MIN_FEE` | `0.05` | Smallest claim fee in USD |
| `FEE_RECEIVER` | gas wallet | Where claim fees go |
| `DAILY_LIMIT` | `300` | Max free-gas claims per day, per network (Ethereum: 30) |
| `DAILY_LIMIT_ETHEREUM` etc. | | Override the limit for one network |
| `PER_IP_LIMIT` | `20` | Max free-gas claims per day from one visitor |
| `MAX_FUEL_USD` | `3` | Most gas sent to one tip, in USD (Ethereum: 15) |
| `SOLANA_GAS_KEY` | required for Solana | Secret key of the Solana fee wallet (Phantom export, or the `[1,2,…]` key-file array) |
| `SOLANA_FEE_RECEIVER` | Solana fee wallet | Where Solana claim fees go |
| `DAILY_LIMIT_SOLANA` | `300` | Max Solana claims per day |
| `RPC_BSC`, `RPC_BASE`, `RPC_ARBITRUM`, `RPC_POLYGON`, `RPC_ETHEREUM`, `RPC_SOLANA` | public nodes | Your own RPC per network (Alchemy, QuickNode, Ankr); recommended once you have traffic |
| `PRICE_BNB`, `PRICE_ETH`, `PRICE_POL` | | Backup coin prices if CoinGecko and Coinbase are both down |

## Links

Everything a link needs lives after `#`, which browsers never send to any server:
- Tip: `https://yoursite/#k=<key>&c=base&t=USDC&a=30&m=message&f=name` (Solana: `c=solana`)
- Request: `https://yoursite/#pay=0xYourAddress&c=base&t=USDC&a=50&m=Logo%20design`

Old links without `c=` are BNB Chain links and keep working.

## Safety notes

- **Keep the gas wallet small.** It's a hot wallet on a server. If the key might have leaked, move its funds and make a new one.
- **Limits matter.** Someone could ask for free gas and then move tokens without paying the fee using their own code. It costs them a deposit each time and you a few cents (more on Ethereum), and the daily limits cap the total.
- **Test with small amounts on each network first.** A $1 tip on BNB Chain, Solana, Base, Arbitrum and Polygon; claim it; take one back; pay a $1 request.
- **The link is the money.** Anyone who has a tip link can claim it. Send links privately.
- **My links lives in one browser.** Clearing browser data deletes the list.
- `netlify.toml` sets a strict Content Security Policy. If you add analytics, add its domain to `script-src`.
- If you charge fees or sell your own token, check the rules in your country first.

## Next steps

1. **Smart-contract version**: makes the claim fee impossible to skip and adds automatic refunds after 30 days.
2. **WalletConnect** so people can pay from a phone wallet while on desktop.

## Token page

`yoursite/#token` shows the TDP token: buy and chart buttons, the contract address with copy and "Add to wallet", live price / market cap / liquidity / 24h volume from DexScreener (refreshes every 30 s), tokenomics with a chart, community links, and an FAQ.

Everything on it comes from `TOKEN` in `public/js/config.js`: name, ticker, addresses, links, and allocations. To show a wallet address next to an allocation, fill in its `wallet` field. FAQ texts live in `public/js/token.js`.

## Token links

- Contract (BNB Chain): `0xf46C57C84326240825DbD8Cb010DC22e4E2AE97b`
- PancakeSwap pair: `0x35fc041144f73811c9fd6065b6e452acec9bfb22`
- X: https://x.com/TipDropPro · Telegram: https://t.me/TipDropPro · Chat: https://t.me/TipDropGroup · TikTok: https://www.tiktok.com/@tipdropzz

`token/DropToken.sol` is the vesting version we drafted; the live TDP token was deployed separately.
