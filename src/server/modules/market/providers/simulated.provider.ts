import type { HistoricalBar, HistoryRange, MarketDataProvider, NormalizedQuote } from "../types";

// DEVELOPMENT / DEMO ONLY — "Simulated Market Data".
//
// A convincing, dependency-free demo market so the whole app — watchlists,
// the attention engine, "since your last visit" — can be exercised end to
// end with `MARKET_DATA_PROVIDER=simulated` and no external API key. It
// implements the exact same `MarketDataProvider` interface as
// `TwelveDataProvider` and is resolved by the same `provider-factory.ts`,
// so it goes through the identical pipeline (rate limiter, timeout,
// PriceObservation persistence, stale/unavailable fallback in
// `service.ts`) as a real provider — nothing downstream of the provider
// boundary knows or cares that the numbers are synthetic.
//
// Never used to hardcode fake data into React components: the UI only
// ever calls `/api/attention` and `/api/watchlists/**`, exactly as it
// does against a real provider. Every price, sparkline point, and volume
// figure the UI shows came from this provider by way of the same
// PriceObservation/attention pipeline a real provider would use — see
// PROJECT_SPEC.md's "never fabricate market data" principle, which this
// provider is the one deliberate, clearly-labeled exception to (the
// label itself — "Simulated Market Data" — is rendered in the UI so it's
// never mistaken for a live feed).
//
// Behavior:
// - A curated table of 15 recognizable symbols (10 NSE, 5 NASDAQ) each
//   get a realistic starting price, company name, currency/exchange, a
//   baseline daily volume, and a movement PROFILE (trend-up, trend-down,
//   stable, or volatile) so different symbols visibly behave differently
//   over repeated visits, not just move by the same random amount.
// - Any symbol outside that table (a user can add an arbitrary ticker —
//   see README.md "Demo flow") still gets a stable, hash-derived starting
//   price and a balanced "mixed" profile, preserving the no-validation
//   demo flow from earlier iterations.
// - Each call nudges the symbol's price with one of three movement
//   tiers — normal (~0.05%-0.5%), moderate (~1%-2.5%), or occasional
//   significant (~4%-7%) — with tier probabilities and directional bias
//   driven by the symbol's profile, so a trend-up stock drifts upward
//   most of the time while still occasionally dipping, a volatile stock
//   swings both ways more often, and a stable stock rarely moves far.
// - Volume is generated around the symbol's baseline, with a multiplier
//   applied on larger moves (a real market's "volume follows volatility"
//   pattern) so "most active" and "volume anomaly" are real, computed
//   figures rather than a second, disconnected random number.
// - Deterministic/seeded: each symbol's PRNG is seeded once from a hash
//   of its name (not reseeded from the wall clock), and the seed advances
//   with every call. Restarting the process and repeating the same visit
//   pattern reproduces the same sequence of moves — reproducible for a
//   demo walkthrough, while still changing on every call within a run.
// - No network I/O, no artificial provider failures — this provider
//   demonstrates the app's own reliability logic (stale/unavailable
//   fallback) via a real outage or misconfiguration, not fault
//   injection. See the module README for how to exercise that path.

type MovementProfile = "trend-up" | "trend-down" | "stable" | "volatile" | "mixed";

interface SymbolProfile {
  name: string;
  currency: string;
  exchange: string;
  basePrice: number;
  baseVolume: number;
  profile: MovementProfile;
}

// Base prices/volumes are illustrative, hand-picked to look plausible —
// not sourced from any live feed. Indian large-caps in INR on NSE, US
// large-caps in USD on NASDAQ, deliberately spanning a few sectors so the
// demo watchlist doesn't read as one homogeneous basket.
const SYMBOL_TABLE: Record<string, SymbolProfile> = {
  RELIANCE: { name: "Reliance Industries Ltd.", currency: "INR", exchange: "NSE", basePrice: 2950, baseVolume: 6_200_000, profile: "trend-up" },
  TCS: { name: "Tata Consultancy Services Ltd.", currency: "INR", exchange: "NSE", basePrice: 3850, baseVolume: 1_800_000, profile: "stable" },
  INFY: { name: "Infosys Ltd.", currency: "INR", exchange: "NSE", basePrice: 1650, baseVolume: 4_500_000, profile: "trend-up" },
  HDFCBANK: { name: "HDFC Bank Ltd.", currency: "INR", exchange: "NSE", basePrice: 1680, baseVolume: 5_100_000, profile: "stable" },
  ICICIBANK: { name: "ICICI Bank Ltd.", currency: "INR", exchange: "NSE", basePrice: 1195, baseVolume: 7_300_000, profile: "trend-up" },
  SBIN: { name: "State Bank of India", currency: "INR", exchange: "NSE", basePrice: 825, baseVolume: 9_800_000, profile: "volatile" },
  ITC: { name: "ITC Ltd.", currency: "INR", exchange: "NSE", basePrice: 465, baseVolume: 6_900_000, profile: "stable" },
  BHARTIARTL: { name: "Bharti Airtel Ltd.", currency: "INR", exchange: "NSE", basePrice: 1580, baseVolume: 3_400_000, profile: "trend-up" },
  LT: { name: "Larsen & Toubro Ltd.", currency: "INR", exchange: "NSE", basePrice: 3600, baseVolume: 2_100_000, profile: "stable" },
  MARUTI: { name: "Maruti Suzuki India Ltd.", currency: "INR", exchange: "NSE", basePrice: 12800, baseVolume: 650_000, profile: "trend-down" },
  AAPL: { name: "Apple Inc.", currency: "USD", exchange: "NASDAQ", basePrice: 228.5, baseVolume: 52_000_000, profile: "trend-up" },
  MSFT: { name: "Microsoft Corporation", currency: "USD", exchange: "NASDAQ", basePrice: 425.8, baseVolume: 21_000_000, profile: "stable" },
  NVDA: { name: "NVIDIA Corporation", currency: "USD", exchange: "NASDAQ", basePrice: 138.2, baseVolume: 235_000_000, profile: "volatile" },
  TSLA: { name: "Tesla, Inc.", currency: "USD", exchange: "NASDAQ", basePrice: 262.4, baseVolume: 98_000_000, profile: "volatile" },
  AMZN: { name: "Amazon.com, Inc.", currency: "USD", exchange: "NASDAQ", basePrice: 186.9, baseVolume: 41_000_000, profile: "trend-up" },
};

// Tier weights and directional bias per profile. `up` is the probability
// a move is positive; tier weights are [normal, moderate, significant]
// and must sum to 1.
const PROFILE_BEHAVIOR: Record<
  MovementProfile,
  { tiers: [number, number, number]; up: number }
> = {
  "trend-up": { tiers: [0.65, 0.25, 0.1], up: 0.68 },
  "trend-down": { tiers: [0.65, 0.25, 0.1], up: 0.32 },
  stable: { tiers: [0.85, 0.13, 0.02], up: 0.5 },
  volatile: { tiers: [0.4, 0.35, 0.25], up: 0.5 },
  mixed: { tiers: [0.72, 0.2, 0.08], up: 0.5 },
};

// Movement tiers as absolute percentage ranges, matching the brief's
// "normal / moderate / occasional significant" bands.
const NORMAL_RANGE: [number, number] = [0.05, 0.5];
const MODERATE_RANGE: [number, number] = [1.0, 2.5];
const SIGNIFICANT_RANGE: [number, number] = [4.0, 7.0];

interface SimulatedState {
  price: number;
  seed: number;
}

const state = new Map<string, SimulatedState>();

function hashSymbol(symbol: string): number {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// Deterministic starting price in a plausible equity range (10-2010) for
// a symbol outside the curated table, derived purely from the symbol so
// restarting the dev server doesn't make prices look random/unbelievable
// on first load.
function fallbackStartingPrice(symbol: string): number {
  const hash = hashSymbol(symbol);
  return 10 + (hash % 200000) / 100;
}

// mulberry32-style PRNG. The seed is advanced and persisted per symbol
// (not reseeded from Date.now()), so a given symbol's sequence of moves
// is a deterministic function of how many times it's been fetched this
// process's lifetime — reproducible across restarts given the same visit
// pattern, per the brief's "deterministic/random-seeded" preference.
function nextRandom(stateRef: SimulatedState): number {
  stateRef.seed = (stateRef.seed + 0x6d2b79f5) >>> 0;
  let t = stateRef.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function pickInRange(rand: number, [min, max]: [number, number]): number {
  return min + rand * (max - min);
}

function pickTier(rand: number, tiers: [number, number, number]): 0 | 1 | 2 {
  if (rand < tiers[0]) return 0;
  if (rand < tiers[0] + tiers[1]) return 1;
  return 2;
}

export class SimulatedMarketDataProvider implements MarketDataProvider {
  readonly name = "simulated";

  async fetchQuote(symbol: string, _signal: AbortSignal): Promise<NormalizedQuote> {
    const key = symbol.toUpperCase();
    const meta = SYMBOL_TABLE[key];
    const behavior = PROFILE_BEHAVIOR[meta?.profile ?? "mixed"];

    let entry = state.get(key);
    if (!entry) {
      entry = {
        price: meta?.basePrice ?? fallbackStartingPrice(key),
        seed: hashSymbol(key),
      };
      state.set(key, entry);
    }

    const tierRoll = nextRandom(entry);
    const tier = pickTier(tierRoll, behavior.tiers);
    const magnitudeRoll = nextRandom(entry);
    const magnitudePct =
      tier === 2
        ? pickInRange(magnitudeRoll, SIGNIFICANT_RANGE)
        : tier === 1
          ? pickInRange(magnitudeRoll, MODERATE_RANGE)
          : pickInRange(magnitudeRoll, NORMAL_RANGE);

    const directionRoll = nextRandom(entry);
    const direction = directionRoll < behavior.up ? 1 : -1;

    const nextPrice = Math.max(0.5, entry.price * (1 + (direction * magnitudePct) / 100));
    entry.price = nextPrice;

    // Volume follows the move: bigger moves plausibly trade at higher
    // volume than a quiet day, plus per-call noise so it's never a flat
    // multiple of the baseline.
    const baseVolume = meta?.baseVolume ?? 500_000;
    const volumeNoise = 0.5 + nextRandom(entry) * 1.0; // 0.5x-1.5x
    const volumeSpike = tier === 2 ? 2.5 + nextRandom(entry) * 2 : tier === 1 ? 1.2 + nextRandom(entry) * 0.6 : 1;
    const volume = Math.round(baseVolume * volumeNoise * volumeSpike);

    return {
      symbol: key,
      price: Math.round(nextPrice * 100) / 100,
      currency: meta?.currency ?? "USD",
      exchange: meta?.exchange ?? "SIM",
      name: meta?.name ?? `${key} (Simulated)`,
      observedAt: new Date(),
      volume,
      avgVolume: baseVolume,
    };
  }

  async fetchHistory(symbol: string, range: HistoryRange, signal: AbortSignal): Promise<HistoricalBar[]> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const key = symbol.toUpperCase();
    const meta = SYMBOL_TABLE[key];
    const count: Record<HistoryRange, number> = { "1D": 78, "1W": 60, "1M": 30, "3M": 90, "1Y": 52 };
    const stepMs: Record<HistoryRange, number> = { "1D": 5 * 60_000, "1W": 60 * 60_000, "1M": 24 * 60 * 60_000, "3M": 24 * 60 * 60_000, "1Y": 7 * 24 * 60 * 60_000 };
    let price = meta?.basePrice ?? fallbackStartingPrice(key);
    let seed = hashSymbol(`${key}:${range}`);
    const rand = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const now = Date.now(); const total = count[range]; const bars: HistoricalBar[] = [];
    for (let i = 0; i < total; i++) { const open = price; const move = (rand() - 0.48) * 0.035; const close = Math.max(0.5, open * (1 + move)); const high = Math.max(open, close) * (1 + rand() * 0.012); const low = Math.min(open, close) * (1 - rand() * 0.012); bars.push({ timestamp: new Date(now - (total - i) * stepMs[range]), open, high, low, close, volume: Math.round((meta?.baseVolume ?? 500_000) * (0.7 + rand() * 0.8)) }); price = close; }
    return bars;
  }
}
