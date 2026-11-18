// BTC race bot: dip-and-bounce mean reversion (long only).
//
// Strategy (from first principles, 1-minute bars of cbBTC/USDC):
// - BTC chops sideways with frequent 0.5%+ swings in both directions, even
//   inside a downtrend. A full round trip costs ~26 bps, so the bot only
//   trades moves big enough to clear that.
// - It buys the dip: when the close sits well below its 20-bar average
//   (z-score < -1), it buys a tranche. Deeper dips buy more tranches.
// - It sells the bounce: when the close recovers above its 20-bar average
//   (z-score > +0.5), it sells half; a stronger bounce sells the rest.
// - Hard exits: a take-profit and a stop-loss on the position's cost, so
//   a dip that keeps falling is cut instead of ridden down.
// - Position sizes vary by signal strength (25% tranches, scaled by how
//   deep the dip is), so the action log is distinctive, not a single
//   buy-and-hold or a couple of identical fills.
// - Drawdown guard: if equity falls 5% below its peak, sell all and sit
//   out for a cooldown. No new entries in the last 60 bars.
//
// Deterministic: decisions come only from the bars fed in; no network,
// no wall clock, no randomness, no files. Pure float math.

import { BPS, runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// --- strategy parameters ---
const MA_WINDOW = 30; // moving-average / std lookback (bars)
const BUY_Z1 = -1.5; // first dip tranche: z-score below this
const BUY_Z2 = -2.2; // second dip tranche: z-score below this
const BUY_FRAC1_BPS = 2500; // first tranche: this share of cash
const BUY_FRAC2_BPS = 2500; // second tranche: this share of cash
const SELL_Z1 = 1.0; // first bounce: z-score above this -> sell half
const SELL_Z2 = 1.8; // second bounce: z-score above this -> sell rest
const SELL_FRAC1_BPS = 5000; // first bounce sells this share of the position
const TP_BPS = 150; // take-profit: sell all at this gain over cost
const STOP_BPS = 80; // stop-loss: sell all at this loss under cost
const DD_GUARD_BPS = 500; // drawdown guard: sell all at this equity drawdown
const COOLDOWN_BARS = 60; // sit out this long after the guard trips
const END_BLACKOUT = 60; // no new entries in the last N bars of the window
const WINDOW_BARS = 1440; // the window is 24h of 1-minute bars
const MAX_SLIP_BPS = 200; // max slippage vs latest close for every order
const BOUNCE_BARS = 3; // buy only if the close is up over the last N bars

const closes: number[] = [];
let peakEquity: bigint | null = null;
let cooldownUntil = -1;
let tranchesBought = 0; // how many dip tranches are open (0, 1, 2)

function maStd(): { mean: number; std: number } {
  const w = closes.slice(-MA_WINDOW);
  const mean = w.reduce((a, x) => a + x, 0) / w.length;
  const variance = w.reduce((a, x) => a + (x - mean) * (x - mean), 0) / w.length;
  return { mean, std: Math.sqrt(variance) };
}

await runBars({
  onBatch(state: BarsState, batch): OrderInput[] {
    const closeBig = state.close(SYMBOL);
    if (closeBig === null) return [];
    const close = Number(closeBig);
    closes.push(close);

    const equity = state.equity;
    if (peakEquity === null || equity > peakEquity) peakEquity = equity;

    const holding = state.positions.get(SYMBOL);
    const qty = holding ? holding.qty : 0n;
    const cost = holding ? holding.cost : 0n;
    const orders: OrderInput[] = [];

    // --- drawdown guard: sell all, sit out ---
    if (peakEquity !== null && equity * 10000n < peakEquity * BigInt(10000 - DD_GUARD_BPS)) {
      if (qty > 0n) {
        orders.push({ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIP_BPS });
        tranchesBought = 0;
      }
      cooldownUntil = batch.seq + COOLDOWN_BARS;
      return orders;
    }
    if (batch.seq < cooldownUntil) return [];

    if (closes.length < MA_WINDOW) return [];

    const { mean, std } = maStd();
    if (std === 0) return [];
    const z = (close - mean) / std;

    // --- holding: hard exits first (take-profit / stop-loss) ---
    if (qty > 0n && cost > 0n) {
      const value = state.value(SYMBOL, qty);
      if (value * 10000n >= cost * BigInt(10000 + TP_BPS)) {
        orders.push({ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIP_BPS });
        tranchesBought = 0;
        return orders;
      }
      if (value * 10000n <= cost * BigInt(10000 - STOP_BPS)) {
        orders.push({ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIP_BPS });
        tranchesBought = 0;
        return orders;
      }
      // --- bounce: sell tranches on recovery ---
      if (z >= SELL_Z2) {
        orders.push({ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIP_BPS });
        tranchesBought = 0;
        return orders;
      }
      if (z >= SELL_Z1) {
        const sellQty = (qty * BigInt(SELL_FRAC1_BPS)) / BigInt(BPS);
        if (sellQty > 0n) {
          orders.push({ side: 'sell', symbol: SYMBOL, qty: sellQty, max_slippage_bps: MAX_SLIP_BPS });
          if (tranchesBought > 0) tranchesBought -= 1;
        }
        return orders;
      }
    }

    // --- flat / partial: buy the dip in tranches ---
    // Only buy into a bounce: the close must be up over the last
    // BOUNCE_BARS bars, so we catch a dip that is turning, not one
    // still falling.
    if (batch.seq >= WINDOW_BARS - END_BLACKOUT) return [];
    const bouncing =
      closes.length > BOUNCE_BARS && close > closes[closes.length - 1 - BOUNCE_BARS];
    if (!bouncing) return [];
    if (z <= BUY_Z2 && tranchesBought < 2) {
      const notional = (state.cash * BigInt(BUY_FRAC2_BPS)) / BigInt(BPS);
      if (notional >= 1_000_000n && notional <= state.cash) {
        orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIP_BPS });
        tranchesBought += 1;
      }
    } else if (z <= BUY_Z1 && tranchesBought < 1) {
      const notional = (state.cash * BigInt(BUY_FRAC1_BPS)) / BigInt(BPS);
      if (notional >= 1_000_000n && notional <= state.cash) {
        orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIP_BPS });
        tranchesBought += 1;
      }
    }
    return orders;
  },
});
