/* ============================================================
   CONFIG — edit this file to make the app yours.
   Loaded before app.js, so everything here is available there.
   If you change TOKENS of a chain, change them in netlify/functions/fuel.mjs too.
   ============================================================ */
const CONFIG = {
  APP_NAME: 'TipDrop',
  FUEL_URL: '/api/fuel',              // the fee service that pays gas so recipients pay nothing
  DEFAULT_CHAIN: 'bsc',
  CHAIN_ORDER: ['bsc', 'solana', 'base', 'arbitrum', 'polygon', 'ethereum'],

  CHAINS: {
    bsc: {
      name: 'BNB Chain', id: 56, hex: '0x38', color: '#F3BA2F',
      native: { symbol: 'BNB', name: 'BNB' },
      rpcs: ['https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed1.binance.org', 'https://bsc-rpc.publicnode.com'],
      explorer: 'https://bscscan.com',
      network: 'BNB Smart Chain (BEP-20)', exchangeNetwork: 'BSC (BEP20)',
      gasFloorGwei: '0.05',
      minTip: '1', minTipNative: '0.001',
      presets: ['5', '10', '30', '50'], presetsNative: ['0.01', '0.05', '0.1'],
      tokens: [
        { symbol: 'USDT', name: 'Tether USD', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, stable: true },
        { symbol: 'USDC', name: 'USD Coin',   address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18, stable: true }
      ]
    },
    solana: {
      type: 'solana', name: 'Solana', color: '#14F195',
      native: { symbol: 'SOL', name: 'Solana', decimals: 9 },
      rpcs: ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'],
      explorer: 'https://solscan.io',
      network: 'Solana (SPL)', exchangeNetwork: 'Solana (SOL)',
      minTip: '1', minTipNative: '0.01',
      presets: ['5', '10', '30', '50'], presetsNative: ['0.05', '0.1', '0.5'],
      tokens: [
        { symbol: 'USDC', name: 'USD Coin',   address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, stable: true },
        { symbol: 'USDT', name: 'Tether USD', address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6, stable: true }
      ]
    },
    base: {
      name: 'Base', id: 8453, hex: '0x2105', color: '#3B7BFF',
      native: { symbol: 'ETH', name: 'Ether' },
      rpcs: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
      explorer: 'https://basescan.org',
      network: 'Base', exchangeNetwork: 'Base',
      l1FeeBuffer: '0.000005',          // Base also charges a tiny Ethereum data fee per transaction
      minTip: '1', minTipNative: '0.0005',
      presets: ['5', '10', '30', '50'], presetsNative: ['0.002', '0.01', '0.02'],
      tokens: [
        { symbol: 'USDC', name: 'USD Coin', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, stable: true }
      ]
    },
    arbitrum: {
      name: 'Arbitrum', id: 42161, hex: '0xa4b1', color: '#28A0F0',
      native: { symbol: 'ETH', name: 'Ether' },
      rpcs: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'],
      explorer: 'https://arbiscan.io',
      network: 'Arbitrum One', exchangeNetwork: 'Arbitrum One',
      minTip: '1', minTipNative: '0.0005',
      presets: ['5', '10', '30', '50'], presetsNative: ['0.002', '0.01', '0.02'],
      tokens: [
        { symbol: 'USDT', name: 'Tether USD', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6, stable: true },
        { symbol: 'USDC', name: 'USD Coin',   address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, stable: true }
      ]
    },
    polygon: {
      name: 'Polygon', id: 137, hex: '0x89', color: '#8247E5',
      native: { symbol: 'POL', name: 'POL' },
      rpcs: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'],
      explorer: 'https://polygonscan.com',
      network: 'Polygon PoS', exchangeNetwork: 'Polygon',
      minTip: '1', minTipNative: '1',
      presets: ['5', '10', '30', '50'], presetsNative: ['10', '50', '100'],
      tokens: [
        { symbol: 'USDT', name: 'Tether USD', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6, stable: true },
        { symbol: 'USDC', name: 'USD Coin',   address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6, stable: true }
      ]
    },
    ethereum: {
      name: 'Ethereum', id: 1, hex: '0x1', color: '#9CA6C8',
      native: { symbol: 'ETH', name: 'Ether' },
      rpcs: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'],
      explorer: 'https://etherscan.io',
      network: 'Ethereum (ERC-20)', exchangeNetwork: 'Ethereum (ERC20)',
      expensive: true,                  // shows a fee warning and needs bigger tips
      minTip: '20', minTipNative: '0.005',
      presets: ['20', '50', '100', '250'], presetsNative: ['0.01', '0.05', '0.1'],
      tokens: [
        { symbol: 'USDT', name: 'Tether USD', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, stable: true },
        { symbol: 'USDC', name: 'USD Coin',   address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, stable: true }
      ]
    }
  },

  // Your token. Shown on the Token page (yoursite/#token).
  TOKEN: {
    name: 'TipDrop',
    symbol: 'TDP',
    address: '0xf46C57C84326240825DbD8Cb010DC22e4E2AE97b',
    decimals: 18,
    chain: 'bsc',
    totalSupply: 1000000000,
    pair: '0x35fc041144f73811c9fd6065b6e452acec9bfb22',   // PancakeSwap TDP/USDT pool, used for live price
    buyUrl: 'https://pancakeswap.finance/swap?chain=bsc&inputCurrency=0x55d398326f99059fF775485246999027B3197955&outputCurrency=0xf46C57C84326240825DbD8Cb010DC22e4E2AE97b',
    chartUrl: 'https://dexscreener.com/bsc/0x35fc041144f73811c9fd6065b6e452acec9bfb22',
    explorerUrl: 'https://bscscan.com/token/0xf46C57C84326240825DbD8Cb010DC22e4E2AE97b',
    socials: [
      { label: 'X (Twitter)', handle: '@TipDropPro', url: 'https://x.com/TipDropPro', icon: 'x' },
      { label: 'Telegram channel', handle: 't.me/TipDropPro', url: 'https://t.me/TipDropPro', icon: 'tg' },
      { label: 'Telegram chat', handle: 't.me/TipDropGroup', url: 'https://t.me/TipDropGroup', icon: 'chat' },
      { label: 'TikTok', handle: '@tipdropzz', url: 'https://www.tiktok.com/@tipdropzz', icon: 'tiktok' }
    ],
    // Tokenomics. Percentages must add up to 100. Add a wallet address to any line to show it publicly.
    allocations: [
      { label: 'Community rewards',      pct: 27, color: '#FF8A1F', wallet: '' },
      { label: 'Ecosystem / treasury',   pct: 20, color: '#F3BA2F', wallet: '' },
      { label: 'Team (incl. initial liquidity)', pct: 19, color: '#57E0A4', wallet: '' },
      { label: 'Exchange reserve',       pct: 15, color: '#7B6CFF', wallet: '' },
      { label: 'Seed investor',          pct: 10, color: '#3B9BFF', wallet: '' },
      { label: 'Marketing & airdrops',   pct: 9,  color: '#FF7180', wallet: '' }
    ]
  },

  ALLOW_NATIVE: true,                 // let people tip and request in BNB / ETH / POL too
  // Optional service fee on claimed tokens, in basis points (100 = 1%). Off by default.
  FEE_BPS: 0,
  FEE_ADDRESS: ''
};
