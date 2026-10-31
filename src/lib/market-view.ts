import type { AttentionItemDTO } from "@/types/attention";

// Pure selection/state logic for MarketView, kept out of the component so the
// "summary says N stocks, selector shows none" class of bug is unit-testable.

// A stock is selectable when it has a usable current quote.
export function hasCurrentQuote(item: AttentionItemDTO): boolean {
  return item.currentPrice !== null && Number.isFinite(item.currentPrice) && item.currentPrice > 0;
}

function uniqueBySymbol(items: AttentionItemDTO[]): AttentionItemDTO[] {
  const seen = new Set<string>();
  const out: AttentionItemDTO[] = [];
  for (const item of items) {
    if (seen.has(item.symbol)) continue;
    seen.add(item.symbol);
    out.push(item);
  }
  return out;
}

// One entry per distinct symbol (a symbol on two watchlists is one stock).
// Prefers an entry that has a quote when duplicates disagree.
export function splitStocks(items: AttentionItemDTO[]): {
  selectable: AttentionItemDTO[];
  unavailable: AttentionItemDTO[];
} {
  const withQuote = uniqueBySymbol(items.filter(hasCurrentQuote));
  const have = new Set(withQuote.map((i) => i.symbol));
  const unavailable = uniqueBySymbol(items.filter((i) => !have.has(i.symbol)));
  return { selectable: withQuote, unavailable };
}

// The effective selection is DERIVED on every render: the user's pick if it is
// still selectable, otherwise the first selectable stock. (Storing the first
// symbol in useState's initial value froze it at "" whenever the component
// mounted before the attention data arrived.)
export function resolveSelectedSymbol(preferred: string, selectable: AttentionItemDTO[]): string {
  if (preferred && selectable.some((i) => i.symbol === preferred)) return preferred;
  return selectable[0]?.symbol ?? "";
}

export type MarketViewStatus =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "no-stocks" }
  | { kind: "no-quotes"; tracked: number; reason: string | null }
  | { kind: "ready"; tracked: number; withoutQuote: number };

export function marketViewStatus(input: {
  loadState: "loading" | "ready" | "error";
  error: string | null;
  items: AttentionItemDTO[];
}): MarketViewStatus {
  const { selectable, unavailable } = splitStocks(input.items);
  const tracked = selectable.length + unavailable.length;
  if (input.loadState === "error" && tracked === 0) {
    return { kind: "error", message: input.error ?? "Failed to load your stocks" };
  }
  if (tracked === 0) {
    // Loading with nothing yet is NOT "you have no stocks".
    return input.loadState === "loading" ? { kind: "loading" } : { kind: "no-stocks" };
  }
  if (selectable.length === 0) {
    return { kind: "no-quotes", tracked, reason: unavailable[0]?.reason ?? null };
  }
  return { kind: "ready", tracked, withoutQuote: unavailable.length };
}
