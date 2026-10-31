import type { AttentionComputation } from "./engine";

// Why this file exists
// --------------------
// `GET /api/attention` is called for two very different reasons:
//
//   "visit" - the user opened/reloaded a page or pressed Refresh. This is the
//             moment "since your last visit" is about, so the comparison is
//             made against the stored baseline and the baseline is then
//             advanced to what the user is now looking at.
//   "poll"  - the silent 25s background refresh (useAttention). The user has
//             not "visited" anything; they are just still looking at the same
//             page. A poll may refresh prices, but it must NOT move the
//             baseline: if it did, every poll would compare the price with the
//             one it fetched 25 seconds earlier. That is exactly how
//             "+2.4% over five minutes" used to be displayed as "+0.2%,
//             UNCHANGED" forever, and how every card collapsed to 0.00% as
//             soon as the first poll landed.
export type AttentionRequestKind = "visit" | "poll";

// The baseline is only worth remembering when there is a real price behind it.
// (UNAVAILABLE has no price, so an outage never resets a user's baseline.)
export function shouldAdvanceBaseline(
  kind: AttentionRequestKind,
  computation: Pick<AttentionComputation, "currentPrice" | "observedAt">,
): boolean {
  if (kind === "poll") return false;
  return computation.currentPrice !== null && computation.observedAt !== null;
}

// How old a previously fetched quote for the same symbol may be before the
// market module must go back to the provider. Polls tolerate a quote up to
// 55s old (a 1-minute bar cannot be fresher than that anyway); visits only
// tolerate 15s so pressing Refresh still fetches, but a quick page-to-page
// navigation does not spend the whole provider budget twice. These exist
// because 4 symbols polled every 25s need ~9.6 provider calls/minute, more
// than the default 7/minute budget, which used to push entire polls into STALE.
export const QUOTE_MAX_AGE_MS: Record<AttentionRequestKind, number> = {
  visit: 15_000,
  poll: 55_000,
};
