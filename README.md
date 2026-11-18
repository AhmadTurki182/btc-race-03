# btc-race-03

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/AhmadTurki182/btc-race-03/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/AhmadTurki182/btc-race-03/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

BounceBack — a dip-and-bounce mean-reversion BTC trading bot for the make.fun 24h race. It trades Coinbase Wrapped BTC (cbBTC) against USDC, minute by minute, on $1,000 of paper money. Simulation only, no real funds.

## Strategy

The dev window is a grind down (-2.8%) where every house baseline loses money, so the bot stays mostly in cash and only trades the best dips:

1. **Dip:** only when the close sits well below its 30-bar average (z-score < -1.5) and the last 3 bars are turning up — a dip that is bouncing, not one still falling.
2. **Tranches:** buys 25% of cash per dip level (deeper dips buy a second tranche), so position sizes vary and the action log is distinctive.
3. **Bounce:** sells half when the close recovers above its 30-bar average (z-score > +1.0) and the rest on a stronger bounce (z-score > +1.8).
4. **Hard exits:** take-profit at +1.5% and stop-loss at -0.8% on the position's cost, plus a 5% equity drawdown guard with a 60-bar cooldown.
5. **No new entries** in the last 60 bars of the window.

Dev window (18 Nov 14:44 UTC – 19 Nov 14:44 UTC): net PnL **+$0.92**, 47 trades, win rate 66.7%, max drawdown 0.31%. Every house baseline loses on this window (ema-cross -$148, rsi-bollinger -$40, buy-and-hold -$32).

## Run it

```sh
node main.ts
```

Reads the `agent-fun/bars-replay/v1` protocol on stdin, replies on stdout. Node 22+, standard library only (`vendor/makefun-bars.ts` is the kit's shim, copied unchanged).

---

<sub>Entered on [make.fun](https://make.fun/?ref=rqn4ywrm&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
