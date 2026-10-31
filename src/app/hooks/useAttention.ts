"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AttentionItemDTO } from "@/types/attention";
import * as api from "@/lib/api-client";
import { mergePolledItems } from "@/lib/attention-merge";

export type AttentionLoadState = "loading" | "ready" | "error";

// How often the feed silently re-fetches in the background once the
// first load has succeeded, so prices and attention state stay current
// without the user clicking "Refresh." One shared constant (not a
// per-call-site option) so every surface using this hook — AppHeader's
// freshness readout, both dashboard/detail AttentionSection instances,
// watchlist item rows — stays on the same cadence rather than drifting
// out of sync with each other.
const POLL_INTERVAL_MS = 25_000;

export interface UseAttentionResult {
  items: AttentionItemDTO[];
  marketDataProvider: string | null;
  loadState: AttentionLoadState;
  error: string | null;
  // Re-fetches without resetting `items` visually flickering to empty —
  // callers that want a "loading" flash on manual retry can check
  // loadState themselves; this is primarily used for silent refresh.
  reload: () => Promise<void>;
}

// Single fetch/loading/error implementation for the "since your last
// visit" attention feed, shared by every surface that needs it:
// AttentionSection (the feed itself), WatchlistsDashboard (summary
// stats), and WatchlistDetail/watchlist rows (per-symbol live price +
// freshness). Extracted in Iteration 4 so those surfaces can't drift
// out of sync on loading/error handling the way three separate
// hand-rolled useEffect blocks eventually would.
export function useAttention(watchlistId?: string): UseAttentionResult {
  const [items, setItems] = useState<AttentionItemDTO[]>([]);
  const [marketDataProvider, setMarketDataProvider] = useState<string | null>(
    null,
  );
  const [loadState, setLoadState] = useState<AttentionLoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  // Guards the background poll from firing before the first load has
  // actually succeeded (avoids a redundant/overlapping fetch if a poll
  // tick landed mid-initial-load), and pauses it again whenever
  // `watchlistId` changes until the fresh reload for that id completes.
  const readyRef = useRef(false);

  // `reuseRecent` is only for the mount-time load (see api-client.ts); an
  // explicit reload() - Refresh button, Retry, after adding/removing a
  // symbol - always goes to the server.
  const load = useCallback(async (reuseRecent: boolean) => {
    setLoadState("loading");
    setError(null);
    try {
      const { items, marketDataProvider: provider } = await api.fetchAttention(undefined, { reuseRecent });
      setItems(watchlistId ? items.filter((item) => item.watchlistId === watchlistId) : items);
      setMarketDataProvider(provider);
      setLoadState("ready");
      readyRef.current = true;
    } catch (err) {
      setError(
        err instanceof api.ApiError
          ? err.message
          : "Failed to load your attention feed",
      );
      setLoadState("error");
    }
  }, [watchlistId]);

  const reload = useCallback(() => load(false), [load]);

  // Same fetch as `reload`, but never flips `loadState` to "loading"
  // (that blanks the feed to a skeleton — appropriate for an explicit
  // "Refresh" click, not for something firing every 25s) and never
  // surfaces a transient failure as the error state. If a poll fails
  // (a momentary network blip, a rate-limited provider), the last
  // known-good `items` just stay on screen and the next tick retries.
  const pollSilently = useCallback(async () => {
    if (!readyRef.current || document.hidden) return;
    try {
      // background: true -> prices refresh but the server never advances the
      // "since your last visit" baseline for a poll.
      const { items, marketDataProvider: provider } = await api.fetchAttention(undefined, { background: true });
      const scoped = watchlistId ? items.filter((item) => item.watchlistId === watchlistId) : items;
      setItems((current) => mergePolledItems(current, scoped));
      setMarketDataProvider(provider);
    } catch {
      // Intentionally silent — see comment above.
    }
  }, [watchlistId]);

  useEffect(() => {
    readyRef.current = false;
    load(true);
  }, [load]);

  useEffect(() => {
    const id = setInterval(pollSilently, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pollSilently]);

  return { items, marketDataProvider, loadState, error, reload };
}
