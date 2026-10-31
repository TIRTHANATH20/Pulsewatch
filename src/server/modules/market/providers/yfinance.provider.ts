import { getEnv } from "@/server/lib/env";
import type {
  HistoricalBar,
  HistoryRange,
  MarketDataProvider,
  NormalizedQuote,
} from "../types";
import { ProviderRequestError } from "../errors";

interface YFinanceQuoteResponse {
  symbol: string;
  price: number;
  currency?: string | null;
  exchange?: string | null;
  quoteTime?: string | null;
  volume?: number | null;
  avgVolume?: number | null;
  previousClose?: number | null;
}

interface YFinanceHistoryResponse {
  bars: Array<{
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number | null;
  }>;
}

function serviceUrl(path: string): URL {
  const base = getEnv().NLP_SERVICE_URL;
  return new URL(path, `${base.replace(/\/+$/, "")}/`);
}

async function requestJson<T>(
  url: URL,
  signal: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ProviderRequestError(
      err instanceof Error
        ? `yfinance service request failed: ${err.message}`
        : "yfinance service request failed",
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = `: ${body.detail}`;
    } catch {
      detail = "";
    }
    throw new ProviderRequestError(
      `yfinance service returned status ${response.status}${detail}`,
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new ProviderRequestError("yfinance service returned invalid JSON");
  }
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ProviderRequestError("yfinance service returned invalid numeric metadata");
  }
  return value;
}

// Best-effort metadata: a missing or malformed previous close must never fail
// an otherwise good quote.
function optionalPositive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ProviderRequestError("yfinance service returned invalid text metadata");
  }
  return value;
}

export class YFinanceProvider implements MarketDataProvider {
  readonly name = "yfinance";

  async fetchQuote(
    symbol: string,
    signal: AbortSignal,
  ): Promise<NormalizedQuote> {
    const url = serviceUrl(
      `market/${encodeURIComponent(symbol.trim().toUpperCase())}/quote`,
    );
    const body = await requestJson<YFinanceQuoteResponse>(url, signal);
    if (
      typeof body.price !== "number" ||
      !Number.isFinite(body.price) ||
      body.price <= 0
    ) {
      throw new ProviderRequestError(
        `yfinance service returned no usable quote for ${symbol}`,
      );
    }
    const quoteTime =
      typeof body.quoteTime === "string" ? new Date(body.quoteTime) : undefined;
    if (quoteTime && !Number.isFinite(quoteTime.getTime())) {
      throw new ProviderRequestError("yfinance service returned an invalid quote time");
    }

    return {
      symbol,
      price: body.price,
      currency: optionalString(body.currency) ?? undefined,
      exchange: optionalString(body.exchange) ?? undefined,
      observedAt: new Date(),
      quoteTime,
      volume: optionalNumber(body.volume),
      avgVolume: optionalNumber(body.avgVolume),
      previousClose: optionalPositive(body.previousClose),
    };
  }

  async fetchHistory(
    symbol: string,
    range: HistoryRange,
    signal: AbortSignal,
  ): Promise<HistoricalBar[]> {
    const url = serviceUrl(
      `market/${encodeURIComponent(symbol.trim().toUpperCase())}/history`,
    );
    url.searchParams.set("range", range);
    const body = await requestJson<YFinanceHistoryResponse>(url, signal);
    if (!Array.isArray(body.bars)) {
      throw new ProviderRequestError("yfinance service returned invalid history");
    }

    return body.bars.map((bar, index) => {
      const timestamp = new Date(bar.timestamp);
      const values = [bar.open, bar.high, bar.low, bar.close];
      if (
        !Number.isFinite(timestamp.getTime()) ||
        !values.every((value) => typeof value === "number" && Number.isFinite(value))
      ) {
        throw new ProviderRequestError(
          `yfinance service returned an invalid history bar at index ${index}`,
        );
      }
      return {
        timestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: optionalNumber(bar.volume),
      };
    });
  }
}
