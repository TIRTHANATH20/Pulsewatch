import { getEnv } from "@/server/lib/env";
import type { MarketDataProvider } from "./types";
import { TwelveDataProvider } from "./providers/twelve-data.provider";
import { SimulatedMarketDataProvider } from "./providers/simulated.provider";
import { YFinanceProvider } from "./providers/yfinance.provider";

let cachedProvider: MarketDataProvider | undefined;

// Resolves and caches a single provider instance per process, selected by
// `MARKET_DATA_PROVIDER`. Routing through a factory (rather than
// importing a specific provider directly in service.ts) means adding or
// switching providers is a matter of adding a case here — nothing in
// `service.ts` or the attention module needs to change, since they only
// depend on the `MarketDataProvider` interface.
export function getMarketDataProvider(): MarketDataProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  const env = getEnv();
  switch (env.MARKET_DATA_PROVIDER) {
    case "simulated":
      cachedProvider = new SimulatedMarketDataProvider();
      return cachedProvider;
    case "twelvedata":
      cachedProvider = new TwelveDataProvider();
      return cachedProvider;
    case "yfinance":
      cachedProvider = new YFinanceProvider();
      return cachedProvider;
    default: {
      // Exhaustiveness check: if MARKET_DATA_PROVIDER's enum ever grows
      // without a corresponding case here, this fails to compile instead
      // of silently falling through at runtime.
      const exhaustive: never = env.MARKET_DATA_PROVIDER;
      throw new Error(`Unknown market data provider: ${exhaustive}`);
    }
  }
}
