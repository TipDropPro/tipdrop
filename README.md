<p align="center">
  <img src="brand/logo-square-512.png" alt="TipDrop logo" width="120">
</p>

<h1 align="center">TipDrop</h1>

<p align="center">
  Send crypto as a link. Tips and payment requests on six networks. The receiver never pays a fee.
</p>

<p align="center">
  <a href="https://tipdrop.pro">Website</a> ·
  <a href="https://tipdrop.pro/#token">$TDP token</a> ·
  <a href="https://x.com/TipDropPro">X</a> ·
  <a href="https://t.me/TipDropPro">Telegram</a> ·
  <a href="mailto:support@tipdrop.pro">support@tipdrop.pro</a>
</p>

---

## What is TipDrop?

TipDrop is a non-custodial web app for sending cryptocurrency as a shareable link.

1. **Create a tip.** Choose a network, a token and an amount, and add an optional message.
2. **Fund it** from any wallet, or by scanning a QR code from any app or exchange.
3. **Share the link** in Telegram, WhatsApp or any chat.
4. **The recipient claims it** by pasting their wallet address or connecting a wallet. They don't need an account, and they don't pay a network fee.

TipDrop also supports **payment requests**: create a link with your address and an amount, and whoever opens it can pay you in one tap. Request payments go directly from the payer to the requester.

## Features

| Feature | Description |
|---|---|
| **Tip links** | Put USDT, USDC or a network's native coin into a link anyone can claim |
| **Payment requests** | Shareable "pay me" links with a fixed or open amount, payable by wallet or QR |
| **Free to claim** | The recipient never pays network fees |
| **Reclaim** | Senders can take back any tip that hasn't been claimed |
| **QR deposits** | Fund tips straight from an exchange withdrawal |
| **No sign-up** | No accounts, no email, no personal data |
| **Non-custodial** | Keys are generated in the user's browser and are never sent to a server |
| **Open source** | MIT-licensed; all code is in this repository |

## Supported networks and tokens

| Network | Tokens |
|---|---|
| BNB Chain | USDT, USDC, BNB |
| Solana | USDC, USDT, SOL |
| Base | USDC, ETH |
| Arbitrum | USDT, USDC, ETH |
| Polygon | USDT, USDC, POL |
| Ethereum | USDT, USDC, ETH |

Token contracts are the official issuer addresses (Circle for USDC, Tether for USDT), listed in [`public/js/config.js`](public/js/config.js).

## How it works

- Each tip is a **new wallet generated in the sender's browser** using the browser's secure random number generator.
- The tip's key is stored in the link **after the `#`**. Browsers never send this part of a URL to any server, so TipDrop never sees or stores user funds or keys.
- When a tip is claimed, the funds move straight from the tip's wallet to the recipient's address on-chain.
- An optional **fee service** pays the network fee for the claim. On EVM networks it tops up the tip with a small amount of gas. On Solana it acts as the transaction's fee payer. In return, a small fee in USDT/USDC is deducted from the tip, so the recipient needs no native coin at all.
- Payment requests contain only the requester's public address and amount. Payments go directly from payer to requester.

### Security

- No custody: the TipDrop server never holds keys or user funds.
- A strict Content Security Policy allows scripts only from the site itself and pinned library versions.
- The fee service uses a separate wallet with small balances and per-day and per-IP limits.
- Anyone who holds a tip link can claim it, the same as cash. Share links privately.

## $TDP token

**TDP** is the community token of TipDrop on **BNB Chain**.

| | |
|---|---|
| Name | TipDrop |
| Ticker | TDP |
| Network | BNB Smart Chain (BEP-20) |
| Contract | [`0xf46C57C84326240825DbD8Cb010DC22e4E2AE97b`](https://bscscan.com/token/0xf46C57C84326240825DbD8Cb010DC22e4E2AE97b) |
| Total supply | 1,000,000,000 TDP |
| Decimals | 18 |
| Main pool | [PancakeSwap TDP/USDT](https://pancakeswap.finance/swap?chain=bsc&inputCurrency=0x55d398326f99059fF775485246999027B3197955&outputCurrency=0xf46C57C84326240825DbD8Cb010DC22e4E2AE97b) |
| Charts | [DexScreener](https://dexscreener.com/bsc/0x35fc041144f73811c9fd6065b6e452acec9bfb22) · [GeckoTerminal](https://www.geckoterminal.com/bsc/pools/0x35fc041144f73811c9fd6065b6e452acec9bfb22) |

### Tokenomics

| Allocation | Share | Tokens |
|---|---|---|
| Community rewards | 27% | 270,000,000 |
| Ecosystem / treasury | 20% | 200,000,000 |
| Team (incl. initial liquidity) | 19% | 190,000,000 |
| Exchange reserve | 15% | 150,000,000 |
| Seed investor | 10% | 100,000,000 |
| Marketing & airdrops | 9% | 90,000,000 |

Live liquidity, holders and transfers are public on [DexScreener](https://dexscreener.com/bsc/0x35fc041144f73811c9fd6065b6e452acec9bfb22) and [BscScan](https://bscscan.com/token/0xf46C57C84326240825DbD8Cb010DC22e4E2AE97b#balances).

### Utility

Planned, not live yet:
- Tips in TDP with no claim fee
- TDP cashback for people who send tips
- Holder perks, such as personal tip pages

Each feature will be announced in the [Telegram channel](https://t.me/TipDropPro) when it ships.

> TDP is a utility token for the TipDrop community. Nothing in this repository is financial advice or a promise of returns.

## Roadmap

- [x] Tip links and claims on BNB Chain
- [x] Payment requests
- [x] Base, Arbitrum, Polygon, Ethereum and Solana support
- [x] Free claims via the fee service
- [x] TDP token launch and token page
- [ ] TDP tips with no claim fee
- [ ] TDP cashback for senders
- [ ] WalletConnect for mobile wallets on desktop
- [ ] Smart-contract tips with automatic refund after expiry

## Repository structure

```
public/              Website (HTML, CSS, JavaScript)
  js/app.js          Tips, claims, payment requests
  js/solana.js       Solana support
  js/token.js        $TDP token page
  js/config.js       Networks, tokens and token info
netlify/functions/   Fee services (EVM networks and Solana)
token/               Token contract source (draft with vesting)
brand/               Logo, token icons and banners
docs/DEPLOY.md       Deployment and operator guide
```

## Links

| | |
|---|---|
| Website | https://tipdrop.pro |
| Token page | https://tipdrop.pro/#token |
| X (Twitter) | https://x.com/TipDropPro |
| Telegram channel | https://t.me/TipDropPro |
| Telegram chat | https://t.me/TipDropGroup |
| TikTok | https://www.tiktok.com/@tipdropzz |
| GitHub | https://github.com/TipDropPro/tipdrop |
| Support | support@tipdrop.pro |
| Logo (SVG) | https://tipdrop.pro/logo.svg |

## Contact

Questions, partnerships or security reports: **support@tipdrop.pro**

The TipDrop team will never DM you first or ask for your seed phrase.

## License

[MIT](LICENSE)
