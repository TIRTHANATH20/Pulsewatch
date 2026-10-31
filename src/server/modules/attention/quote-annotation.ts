import { DELAYED_AFTER_MS, type QuoteLabel } from "@/server/modules/market/quote-kind";
import { formatDuration } from "@/lib/format";

// Appends an honest "this quote is old" sentence to an attention reason when
// the provider's own quote time shows the price was not traded recently
// (closed market, delayed feed). Without it the card says
// "No price movement since your last visit" next to "as of just now" for a
// price that last traded on Friday. Classification is never changed by this -
// only the human-readable explanation.
export function annotateReason(
  reason: string,
  label: QuoteLabel | null,
  marketOpen: boolean | undefined,
  now: Date,
): string {
  if (!label || label.kind !== "delayed") return reason;
  const ageMs = now.getTime() - label.asOf.getTime();
  if (ageMs <= DELAYED_AFTER_MS) return reason;
  const age = formatDuration(ageMs);
  const tail =
    marketOpen === false
      ? `Market is closed - this is the last traded price, from ${age} ago.`
      : `The latest quote is from ${age} ago, so the market may be closed or the feed delayed.`;
  return `${reason} ${tail}`;
}
