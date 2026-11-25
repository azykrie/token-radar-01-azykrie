# token-radar-01-azykrie

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/azykrie/token-radar-01-azykrie/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/azykrie/token-radar-01-azykrie/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for the protocols that record no token yet. It reads the sealed DefiLlama
snapshot, covers the whole 40-protocol watchlist, adds the 138 early pre-token protocols below the
$50M floor, and ranks all 178 by an implied value the radar-2 model derives from each protocol's own
TVL, 7-day growth, age and chain breadth — with a concrete farm plan for every row that says what
each step costs and how long it takes.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=w54ezzed&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>