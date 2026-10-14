// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*
  TipDrop token — one-click launch
  --------------------------------
  Deploy this ONE contract and everything is set up automatically:
    - 1,000,000,000 tokens are created, once. There is no way to create more.
    - No owner, no tax, no blacklist, no pause.
    - Each allocation goes into its own OpenZeppelin VestingWallet that unlocks on schedule.
      Nobody manages the unlocks: when tokens have unlocked, the receiver (or anyone) calls
      release(tokenAddress) on that vesting wallet and they're sent to the receiver.

  Allocation (of 1,000,000,000):
    Liquidity pool        1%   10,000,000   sent to liquidityWallet at deploy (you add it to PancakeSwap with $10k)
    Marketing (launch)    2%   20,000,000   sent to marketing at deploy (airdrops, giveaways)
    Marketing (vested)    7%   70,000,000   unlocks evenly over 12 months
    Seed investor        10%  100,000,000   6-month cliff, then evenly over 12 months
    Team                 15%  150,000,000   12-month cliff, then evenly over 24 months
    Community rewards    30%  300,000,000   unlocks evenly over 36 months (TipDrop cashback)
    Ecosystem / treasury 20%  200,000,000   unlocks evenly over 24 months
    Exchange reserve     15%  150,000,000   fully locked for 6 months, then all available (for a CEX listing)

  Change NAME / SYMBOL below before deploying.
*/

import "@openzeppelin/contracts@5.0.2/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts@5.0.2/finance/VestingWallet.sol";

contract DropToken is ERC20 {
    uint256 private constant UNIT = 1e18;
    uint64 private constant MONTH = 30 days;

    // the vesting wallets, public so anyone can check them on the block explorer
    address public immutable seedVesting;
    address public immutable teamVesting;
    address public immutable communityVesting;
    address public immutable treasuryVesting;
    address public immutable marketingVesting;
    address public immutable exchangeReserveLock;

    constructor(
        address liquidityWallet, // receives the 1% for the PancakeSwap pool
        address seedInvestor,    // your father's wallet
        address team,            // team wallet (ideally a Safe multisig)
        address community,       // wallet the TipDrop app pays cashback from
        address treasury,        // ecosystem / treasury wallet (ideally a Safe multisig)
        address marketing,       // marketing wallet
        address exchangeReserve  // receives the exchange reserve after 6 months
    ) ERC20("TipDrop", "DROP") {
        uint64 t = uint64(block.timestamp);

        // available right away
        _mint(liquidityWallet, 10_000_000 * UNIT);
        _mint(marketing, 20_000_000 * UNIT);

        // VestingWallet(receiver, start, duration): nothing before `start`, then unlocks evenly until start + duration
        seedVesting         = _vest(seedInvestor,    t + 6 * MONTH,  12 * MONTH, 100_000_000 * UNIT);
        teamVesting         = _vest(team,            t + 12 * MONTH, 24 * MONTH, 150_000_000 * UNIT);
        communityVesting    = _vest(community,       t,              36 * MONTH, 300_000_000 * UNIT);
        treasuryVesting     = _vest(treasury,        t,              24 * MONTH, 200_000_000 * UNIT);
        marketingVesting    = _vest(marketing,       t,              12 * MONTH,  70_000_000 * UNIT);
        exchangeReserveLock = _vest(exchangeReserve, t + 6 * MONTH,  0,          150_000_000 * UNIT); // duration 0 = simple time lock

        require(totalSupply() == 1_000_000_000 * UNIT, "supply mismatch");
    }

    function _vest(address receiver, uint64 start, uint64 duration, uint256 amount) private returns (address wallet) {
        require(receiver != address(0), "missing wallet address");
        wallet = address(new VestingWallet(receiver, start, duration));
        _mint(wallet, amount);
    }
}
