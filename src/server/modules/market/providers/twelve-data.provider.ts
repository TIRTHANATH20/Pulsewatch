import { getEnv } from "@/server/lib/env";
import type {
  HistoricalBar,
  HistoryRange,
  MarketDataProvider,
  NormalizedQuote,
} from "../types";
import { ProviderRequestError } from "../errors";

const BASE_URL = "https://api.twelvedata.com/quote";
const TIME_SERIES_URL = "https://api.twelvedata.com/time_series";

// Twelve Data's `/quote` endpoint returns HTTP 200 even for symbol
// errors/invalid-key/rate-limit responses — failures show up as a JSON
// body shaped `{ status: "error", code, message }` instead of a non-2xx
// status. This type only covers the fields this provider actually reads;
// everything else in the real payload is ignored.
interface TwelveDataQuoteResponse {
  status?: string;
  code?: number;
  message?: string;
  symbol?: string;
  name?: string;
  exchange?: string;
  currency?: string;
  close?: string | number;
  // Unix seconds of the last quote/trade, and whether the exchange is open.
  timestamp?: number | string;
  is_market_open?: boolean;
}

interface TwelveDataTimeSeriesResponse {
  status?: string;
  message?: string;
  values?: Array<Record<string, unknown>>;
}

async function readJson<T>(res: Response, provider: string): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new ProviderRequestError(
      `${provider} returned an unreadable response`,
    );
  }
}

export class TwelveDataProvider implements MarketDataProvider {
  readonly name = "twelvedata";

  async fetchQuote(
    symbol: string,
    signal: AbortSignal,
  ): Promise<NormalizedQuote> {
    const env = getEnv();
    if (!env.TWELVE_DATA_API_KEY) {
      throw new ProviderRequestError("TWELVE_DATA_API_KEY is not configured");
    }

    const url = `${BASE_URL}?symbol=${encodeURIComponent(symbol)}&apikey=${env.TWELVE_DATA_API_KEY}`;

    let res: Response;
    try {
      res = await fetch(url, { signal });
    } catch (err) {
      // fetch() itself throws on abort (handled by the caller via
      // DOMException/AbortError) and on network-level failures (DNS,
      // connection refused, etc.) — normalize the latter into our own
      // error type so `service.ts` doesn't need to know about raw fetch
      // failure modes.
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }
      throw new ProviderRequestError(
        err instanceof Error
          ? `Twelve Data request failed: ${err.message}`
          : "Twelve Data request failed",
      );
    }

    if (!res.ok) {
      throw new ProviderRequestError(
        `Twelve Data request failed with status ${res.status}`,
      );
    }

    const body = await readJson<TwelveDataQuoteResponse>(res, "Twelve Data");

    if (body.status === "error") {
      throw new ProviderRequestError(
        body.message ?? `Twelve Data returned an error for ${symbol}`,
      );
    }

    if (body.close === undefined || body.close === null) {
      throw new ProviderRequestError(
        `Twelve Data returned no usable quote for ${symbol}`,
      );
    }

    const price = Number(body.close);
    if (!Number.isFinite(price)) {
      throw new ProviderRequestError(
        `Twelve Data returned a non-numeric price for ${symbol}`,
      );
    }

    const timestamp = Number(body.timestamp);
    const quoteTime =
      Number.isFinite(timestamp) && timestamp > 0
        ? new Date(timestamp * 1000)
        : undefined;

    return {
      symbol,
      price,
      currency: body.currency,
      exchange: body.exchange,
      name: body.name,
      observedAt: new Date(),
      quoteTime,
      marketOpen:
        typeof body.is_market_open === "boolean"
          ? body.is_market_open
          : undefined,
    };
  }

  async fetchHistory(
    symbol: string,
    range: HistoryRange,
    signal: AbortSignal,
  ): Promise<HistoricalBar[]> {
    const env = getEnv();
    if (!env.TWELVE_DATA_API_KEY)
      throw new ProviderRequestError("TWELVE_DATA_API_KEY is not configured");
    const intervals: Record<HistoryRange, string> = {
      "1D": "5min",
      "1W": "1h",
      "1M": "1day",
      "3M": "1day",
      "1Y": "1week",
    };
    const outputsize =
      range === "1D"
        ? 78
        : range === "1W"
          ? 60
          : range === "1M"
            ? 30
            : range === "3M"
              ? 90
              : 52;
    const url = `${TIME_SERIES_URL}?symbol=${encodeURIComponent(symbol)}&interval=${intervals[range]}&outputsize=${outputsize}&timezone=UTC&apikey=${env.TWELVE_DATA_API_KEY}`;
    let res: Response;
    try {
      res = await fetch(url, { signal });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new ProviderRequestError(
        err instanceof Error
          ? `Twelve Data history request failed: ${err.message}`
          : "Twelve Data history request failed",
      );
    }
    const body = await readJson<TwelveDataTimeSeriesResponse>(
      res,
      "Twelve Data history",
    );
    if (!res.ok || body.status === "error" || !body.values) {
      throw new ProviderRequestError(
        body.message ?? `No historical data for ${symbol}`,
      );
    }

    return body.values
      .flatMap((value): HistoricalBar[] => {
        if (typeof value.datetime !== "string") return [];
        const datetime = value.datetime.includes("T")
          ? value.datetime
          : value.datetime.replace(" ", "T");
        const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(datetime);
        const timestamp = new Date(hasTimezone ? datetime : `${datetime}Z`);
        const open = Number(value.open);
        const high = Number(value.high);
        const low = Number(value.low);
        const close = Number(value.close);
        const volume =
          value.volume == null || value.volume === ""
            ? undefined
            : Number(value.volume);
        if (
          !Number.isFinite(timestamp.getTime()) ||
          ![open, high, low, close].every(Number.isFinite) ||
          (volume !== undefined && !Number.isFinite(volume))
        ) {
          return [];
        }
        return [
          {
            timestamp,
            open,
            high,
            low,
            close,
            ...(volume === undefined ? {} : { volume }),
          },
        ];
      })
      .reverse();
  }
}
