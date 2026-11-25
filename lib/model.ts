// The token radar's value model, radar-2: one sealed snapshot in, one ranked board out.
//
// The board ranks every protocol that records no token and is still a launch candidate:
// the whole watchlist (the floor, never a ceiling) plus every pre-token protocol below the
// watchlist floor that is not a wrapped, staked, bridged or exchange product of a token
// that already trades. Protocols that already record a token are kept apart and shipped to
// the dashboard as the market's own values; they never enter the ranked board.
//
// Every number follows only from the snapshot's own figures; no protocol name is ever
// special-cased. For one protocol:
//
//   base              = tvl_usd x BASE_FRACTION
//   growthPct         = clamp(change_7d ?? 0, GROWTH_FLOOR, GROWTH_CAP)  (per cent)
//   growthMultiplier  = 1 + (growthPct / 100) x (growthPct < 0 ? GROWTH_WEIGHT_DOWN : GROWTH_WEIGHT_UP)
//   maturityMultiplier= MATURITY_FLOOR + MATURITY_RANGE x (1 - exp(-age_days / MATURITY_HALFLIFE_DAYS))
//                      (age_days unknown or absent: UNKNOWN_AGE_DAYS)
//   breadthMultiplier = 1 + BREADTH_STEP x min(max(chains.length - 1, 0), BREADTH_MAX_CHAINS)
//   implied_value_usd = max(1, round(base x growthMultiplier x maturityMultiplier x breadthMultiplier))
//
// A decline is weighted harder than a rise (0.75 vs 0.50) because shrinking TVL erodes the
// base the protocol would launch on; maturity saturates on an exponential curve so a decade
// of quiet operation is not worth more than a few seasons of it; breadth rewards protocols
// whose TVL spreads across several chains, since a multi-chain record reaches more buyers.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document: the frozen DefiLlama record the entry reads. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The radar-2 model's constants, named the same way the dashboard states them. */
export interface ModelConstants {
  base_fraction: number;
  growth_floor: number;
  growth_cap: number;
  growth_weight_up: number;
  growth_weight_down: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_halflife_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  base_fraction: 0.3,
  growth_floor: -80,
  growth_cap: 150,
  growth_weight_up: 0.5,
  growth_weight_down: 0.75,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_halflife_days: 540,
  unknown_age_days: 365,
  breadth_step: 0.03,
  breadth_max_chains: 5,
};

/** The model's version label: the dashboard names it and the rules can quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar may carry, by TVL. */
export const EARLY_ROWS = 400;

/** How many live-token protocols the dashboard's separate 'already traded' view carries, by market cap. */
export const LIVE_ROWS = 12;

/** Why a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** One row of board.json: the gate's row plus the model inputs the detail drawer shows. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  base: number;
  growthPct: number;
  growthMultiplier: number;
  maturityMultiplier: number;
  breadthMultiplier: number;
  implied_value_usd: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, never a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: ModelConstants;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Clamp `value` into [lo, hi]. */
export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Whole days from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The model's growth per cent: change_7d, missing as 0, clamped to the model's band. */
export function growthPct(change7d: number | null): number {
  return clamp(finite(change7d, 0), MODEL.growth_floor, MODEL.growth_cap);
}

/** The model's growth multiplier: declines weigh 0.75, rises 0.50, per rad. */
export function growthMultiplier(growth: number): number {
  const weight = growth < 0 ? MODEL.growth_weight_down : MODEL.growth_weight_up;
  return 1 + (growth / 100) * weight;
}

/** The model's maturity multiplier: an exponential curve toward MATURITY_FLOOR + MATURITY_RANGE. */
export function maturityMultiplier(age: number | null): number {
  const a = Math.max(0, age ?? MODEL.unknown_age_days);
  return MODEL.maturity_floor + MODEL.maturity_range * (1 - Math.exp(-a / MODEL.maturity_halflife_days));
}

/** The model's breadth multiplier: up to BREADTH_MAX_CHAINS extra chains past the first. */
export function breadthMultiplier(chainCount: number): number {
  return 1 + MODEL.breadth_step * Math.min(Math.max(chainCount - 1, 0), MODEL.breadth_max_chains);
}

/** The model's whole arithmetic for one protocol, every figure the drawer shows. */
export function modelFor(
  p: SnapshotProtocol,
  asOf: string,
): {
  base: number;
  growthPct: number;
  growthMultiplier: number;
  maturityMultiplier: number;
  breadthMultiplier: number;
  age: number | null;
  implied: number;
} {
  const base = p.tvl_usd * MODEL.base_fraction;
  const g = growthPct(p.change_7d);
  const gm = growthMultiplier(g);
  const age = ageDays(asOf, p.listed_at);
  const mm = maturityMultiplier(age);
  const bm = breadthMultiplier(p.chains.length);
  const implied = Math.max(1, Math.round(base * gm * mm * bm));
  return { base, growthPct: g, growthMultiplier: gm, maturityMultiplier: mm, breadthMultiplier: bm, age, implied };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The categories whose TVL is a wrapped, staked or bridged product of a token that already trades. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token and not a product of a traded token. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  const name = p.name ?? '';
  if (VERSIONED.test(name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(name)) return false;
  const lower = name.toLowerCase();
  return !EXCHANGE_PREFIXES.some((ex) => lower.startsWith(ex.toLowerCase()));
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/**
 * The protocols the board ranks, strongest first, ranks 1..n. The watchlist is the floor and
 * is taken whole; the early radar then adds the pre-token protocols below the floor with the
 * most TVL, never replacing a watchlist row. Ties in implied value break by slug ascending, so
 * the order is deterministic run to run.
 */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const m = modelFor(p, snapshot.as_of);
    return { p, m };
  });
  scored.sort((a, b) => b.m.implied - a.m.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const watch = new Set(snapshot.watchlist);
  return scored.map(({ p, m }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: m.age,
    watchlist: watch.has(p.slug),
    base: Math.round(m.base),
    growthPct: round4(m.growthPct),
    growthMultiplier: round4(m.growthMultiplier),
    maturityMultiplier: round4(m.maturityMultiplier),
    breadthMultiplier: round4(m.breadthMultiplier),
    implied_value_usd: m.implied,
    farm_steps: farmSteps(p, m.age),
  }));
}

// ------------------------------------------------------------------ farm plans
//
// Every plan is derived from the protocol's own record and says what each step costs and how
// long it takes. Numbers that are not snapshot figures are estimates and say so. The wording
// varies by category (the core action), by chain set (gas and where the position lives) and by
// TVL band and age (how big the position and how long the hold). No slogan survives.

/** The chain a position is opened on first: the protocol's first chain, or a neutral phrase. */
function primaryChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** "Ethereum, Arbitrum and Base plus 12 more" — the protocol's chain set, capped for a sentence. */
function chainsPhrase(p: SnapshotProtocol): string {
  if (p.chains.length === 0) return 'its chains';
  const head = p.chains.slice(0, 3).join(', ');
  const rest = p.chains.length - 3;
  return rest > 0 ? `${head} and ${rest} more` : head;
}

/** A TVL size band: the label a farmer reads, and a first-position size in US dollars. */
function band(p: SnapshotProtocol): { label: string; cap: number } {
  const tvl = p.tvl_usd;
  if (tvl >= 2_000_000_000) return { label: 'mega, above $2B', cap: 400 };
  if (tvl >= 500_000_000) return { label: 'large, $500M to $2B', cap: 300 };
  if (tvl >= 100_000_000) return { label: 'mid, $100M to $500M', cap: 200 };
  if (tvl >= 30_000_000) return { label: 'modest, $30M to $100M', cap: 120 };
  return { label: 'small, under $30M', cap: 60 };
}

/** How long a qualifying hold should run, from the protocol's age: young protocols need longer evidence. */
function holdDays(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A sentence about the protocol's age and what it means, from its listing date. */
function ageSentence(p: SnapshotProtocol, age: number | null): string {
  const name = p.name;
  if (age === null) {
    return `${name} does not record a listing date, so treat it as new: credible launch windows are widest for young names and narrowest for silent ones.`;
  }
  if (age < 90) {
    return `${name} has run only about ${age} days (listed ${p.listed_at}), so your use is early and any snapshot of the whole life of the protocol will include it.`;
  }
  if (age < 365) {
    const months = Math.max(1, Math.round(age / 30));
    return `${name} has run about ${months} months (listed ${p.listed_at}): old enough to be real, young enough that a launch is still plausible.`;
  }
  const years = Math.floor(age / 365);
  return `${name} has run ${years} year${years === 1 ? '' : 's'} (listed ${p.listed_at}): a long quiet record raises the odds that a token, when it comes, rewards the oldest active users first.`;
}

/** A gas note for the chain set, so the plan's costs feel real per chain: only the chains the plan names. */
function gasNote(p: SnapshotProtocol): string {
  const seen = p.chains.slice(0, 3);
  if (seen.includes('Solana')) return '; Solana gas is a few cents a transaction, a real advantage for weekly actions';
  if (seen.includes('Ethereum')) return '; Ethereum gas can spike above $20 at peak times, so send when the base fee is calm';
  if (seen.includes('Bitcoin')) return '; Bitcoin fees depend on mempool pressure, so batch actions into one send';
  if (seen.includes('Tron')) return '; Tron energy lets cheap stablecoin actions stay cheap';
  return '';
}

/** The category's core action: the one concrete move a farmer makes on this protocol. */
function coreAction(p: SnapshotProtocol, cap: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('collateral')) {
    return `Supply $${cap} of USDC to ${name}'s lending market on ${chain} and borrow roughly 20% against it, so the position touches both the supply and borrow sides`;
  }
  if (c.includes('cdp')) {
    return `Open a small CDP at ${name} on ${chain}: post $${cap} of collateral, mint about half its value in the stablecoin and keep the vault open`;
  }
  if (c.includes('dex')) {
    return `Provide $${cap} of liquidity to ${name}'s most active pool on ${chain} and keep the LP receipt in the same wallet`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis') || c.includes('option')) {
    return `Deposit $${cap} of USDC as margin with ${name} on ${chain} and open one small position you hold for a week`;
  }
  if (c.includes('yield') || c.includes('farm') || c.includes('index') || c.includes('liquidity manager')) {
    return `Deposit $${cap} into ${name}'s flagship vault on ${chain} and keep the vault receipt`;
  }
  if (c.includes('stak') || c.includes('restak') || c.includes('pooling')) {
    return `Stake $${cap} of the chain's native asset through ${name} on ${chain} and keep the receipt in a wallet you control`;
  }
  if (c.includes('rwa')) {
    return `Mint or buy $${cap} of ${name}'s tokenized asset on ${chain} and hold it to maturity or exit`;
  }
  if (c.includes('curator')) {
    return `Deposit $${cap} into one ${name} curated vault and leave it through at least one rebalance`;
  }
  if (c.includes('allocator') || c.includes('asset management')) {
    return `Allocate $${cap} to a live ${name} strategy on ${chain} and leave it running`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${cap} of USDC to ${chain} through ${name} and spend the bridged funds there once`;
  }
  if (c.includes('prediction')) {
    return `Fund $${cap} on ${name} and place one market position that settles within a month`;
  }
  if (c.includes('insurance')) {
    return `Buy a small $${cap} cover from ${name} on ${chain} sized to a position you actually hold`;
  }
  if (c.includes('launchpad')) {
    return `Commit $${cap} to ${name}'s next public sale or lock-up tranche on ${chain}`;
  }
  if (c.includes('chain')) {
    return `Use the ${name} chain with purpose: swap $${cap} into its native asset, provide liquidity on its flagship DEX and vote in its governance`;
  }
  if (c.includes('stable') || c.includes('reserve currency')) {
    return `Mint or buy $${cap} of ${name}'s stable asset on ${chain} and hold it for the qualifying period`;
  }
  if (c.includes('payment')) {
    return `Onboard with ${name} and push $${cap} of real payments through it over a month`;
  }
  if (c.includes('card')) {
    return `Open a ${name} card, load $${cap} and build a quarter of honest spending history`;
  }
  if (c.includes('privacy')) {
    return `Deposit and withdraw $${cap} through ${name} on ${chain} twice, to build a clean usage history`;
  }
  if (c.includes('incentive')) {
    return `Join ${name}'s incentive campaign: provide $${cap} of the listed asset and finish its stated tasks`;
  }
  if (c.includes('ai agent')) {
    return `Run $${cap} through ${name}'s agent service on ${chain} and complete one paid task`;
  }
  if (c.includes('otc')) {
    return `List one $${cap} bid or ask on ${name} and keep it live for a week`;
  }
  if (c.includes('locker')) {
    return `Lock $${cap} of a token you already hold through ${name} for the minimum lock period`;
  }
  if (c.includes('synthet')) {
    return `Open a $${cap} synthetic position on ${name} on ${chain}`;
  }
  if (c.includes('leveraged')) {
    return `Enter a $${cap} leveraged farm on ${name} at no more than 1.5x and set the liquidation price to the side before you size it`;
  }
  if (c.includes('btc')) {
    return `Mint or buy $${cap} of the Bitcoin-pegged asset through ${name} and hold it`;
  }
  return `Use ${name}'s core product on ${chain} with $${cap} and keep the position open`;
}

/**
 * A protocol's farm plan: five steps, each an action with its cost and its time, assembled only
 * from the protocol's own record. Every step stays within the gate's 20..600 trimmed characters.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = primaryChain(p);
  const { label, cap } = band(p);
  const hold = holdDays(age);
  const gas = cap >= 150 ? 8 : 4;
  const weekly = cap >= 150 ? 4 : 2;
  const tvl = p.tvl_usd >= 1_000_000_000 ? `$${(p.tvl_usd / 1_000_000_000).toFixed(2)}B` : `$${Math.round(p.tvl_usd / 1_000_000)}M`;
  const chains = chainsPhrase(p);
  const note = gasNote(p);
  const category = p.category ?? 'unlabeled';
  const steps = [
    `Start from the snapshot record: ${p.name} is a ${category} protocol DefiLlama lists as "${p.slug}", so open its DefiLlama page, follow only the docs and audit links it shows and bookmark them before you connect a wallet. Cost: no money, about 20 minutes of reading. Time: 20 minutes.`,
    `${p.name} holds about ${tvl} of TVL across ${chains} (${label}), so $${cap} is a sane first position. Fund a fresh wallet with $${cap} of USDC plus about $${gas} for gas${note}; keep the seed phrase offline and never reuse a hot wallet. Cost: $${cap} of capital plus $${gas} gas. Time: 15 minutes.`,
    `${coreAction(p, cap, chain)}. Do it on the protocol's own frontend, not through an aggregator, so the wallet is clearly associated with the protocol. Cost: $${cap} sits in the position; about $${gas} more in gas (estimate). Time: 30 minutes to set up.`,
    `${ageSentence(p, age)} Hold the position at least ${hold} days and make one small qualifying action a week (a top-up, a borrow, a swap or a vote). Cost: about $${weekly} a week in gas (estimate). Time: 10 minutes a week for ${hold} days.`,
    `When a points snapshot or token launch is announced, claim nothing from messages: open the protocol's own page, follow the link it publishes, and only then claim. Record the wallet, the dates and every transaction in a farm log. Cost: nothing to verify; gas only to claim (estimate $${gas}). Time: 15 minutes at announcement, 5 minutes for the log.`,
  ];
  return steps.map((s) => {
    const trimmed = s.trim();
    if (trimmed.length > 600) return `${trimmed.slice(0, 596).trimEnd()}...`;
    if (trimmed.length < 20) return `${trimmed} Hold the position and watch the protocol's own page.`;
    return trimmed;
  });
}

/** The live-token protocols, by market cap, for the dashboard's separate 'already traded' view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watch.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: MODEL,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: shape, coverage, ranks, order, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows; the gate takes 100 to 4000`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const protocolsBySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const seen = new Set<string>();
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `row ${i + 1} has rank ${r.rank}, not ${i + 1}`;
    if (typeof r.slug !== 'string' || r.slug.length === 0 || r.slug.length > 128 || /\s/.test(r.slug)) return `row ${i + 1} has an unusable slug "${r.slug}"`;
    if (seen.has(r.slug)) return `the slug ${r.slug} is ranked twice`;
    seen.add(r.slug);
    if (!known.has(r.slug)) return `row ${i + 1} names ${r.slug}, which the snapshot does not list`;
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has an empty name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
    // The arithmetic the drawer shows must re-derive exactly from the snapshot's record.
    const proto = protocolsBySlug.get(r.slug);
    if (proto !== undefined) {
      const m = modelFor(proto, snapshot.as_of);
      if (m.implied !== r.implied_value_usd) return `${r.slug}: the board's implied value $${r.implied_value_usd} is not the model's $${m.implied}`;
      if (m.age !== r.age_days) return `${r.slug}: the board's age ${r.age_days} is not the model's ${m.age}`;
      if (Math.abs(round4(m.growthPct) - r.growthPct) > 1e-9 || Math.abs(round4(m.growthMultiplier) - r.growthMultiplier) > 1e-9 || Math.abs(round4(m.maturityMultiplier) - r.maturityMultiplier) > 1e-9 || Math.abs(round4(m.breadthMultiplier) - r.breadthMultiplier) > 1e-9) {
        return `${r.slug}: a stored multiplier does not re-derive`;
      }
      if (Math.round(m.base) !== r.base) return `${r.slug}: the board's base $${r.base} is not the model's $${Math.round(m.base)}`;
    }
    const steps = r.farm_steps;
    if (!Array.isArray(steps) || steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      if (typeof s !== 'string') return `${r.slug} has a non-text farm step`;
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} trimmed characters`;
    }
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}