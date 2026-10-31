"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import type { WatchlistDetail as WatchlistDetailDTO } from "@/types/watchlist";
import * as api from "@/lib/api-client";
import AttentionSection from "./AttentionSection";
import ConfirmDialog from "./ConfirmDialog";
import Sparkline from "./Sparkline";
import { isSparklineDrawable } from "@/lib/sparkline";
import { useAttention } from "@/app/hooks/useAttention";
import {
  formatPriceWithCurrency,
  formatPercent,
  formatFreshnessShort,
  STATUS_LABEL,
  STATUS_BADGE_CLASS,
} from "@/lib/format";

type LoadState = "loading" | "ready" | "error";

export default function WatchlistDetail({ id }: { id: string }) {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();

  const [watchlist, setWatchlist] = useState<WatchlistDetailDTO | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [deleteWatchlistOpen, setDeleteWatchlistOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteWatchlistError, setDeleteWatchlistError] = useState<
    string | null
  >(null);

  const [symbolInput, setSymbolInput] = useState("");
  const [addingSymbol, setAddingSymbol] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [removeTarget, setRemoveTarget] = useState<{
    id: string;
    symbol: string;
  } | null>(null);
  const [removingItemId, setRemovingItemId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Live price/status per symbol, keyed by watchlist item id, so each row
  // below can show a real price and freshness badge next to the symbol
  // instead of only static metadata. Same attention feed AttentionSection
  // renders further up the page — this doesn't add a second endpoint.
  const { items: attentionItems, reload: reloadAttention } = useAttention(id);
  const attentionByItemId = useMemo(() => {
    const map = new Map<string, (typeof attentionItems)[number]>();
    for (const a of attentionItems) map.set(a.itemId, a);
    return map;
  }, [attentionItems]);

  const load = useCallback(async () => {
    setLoadState("loading");
    setLoadError(null);
    try {
      const { watchlist } = await api.fetchWatchlist(id);
      setWatchlist(watchlist);
      setLoadState("ready");
    } catch (err) {
      setLoadError(
        err instanceof api.ApiError ? err.message : "Failed to load watchlist",
      );
      setLoadState("error");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  function startRename() {
    if (!watchlist) return;
    setRenameValue(watchlist.name);
    setRenaming(true);
    setRenameError(null);
  }

  async function confirmRename() {
    const name = renameValue.trim();
    if (!name) return;
    setRenameBusy(true);
    setRenameError(null);
    try {
      const { watchlist: updated } = await api.renameWatchlist(id, name);
      setWatchlist((prev) => (prev ? { ...prev, name: updated.name } : prev));
      setRenaming(false);
    } catch (err) {
      setRenameError(
        err instanceof api.ApiError
          ? err.message
          : "Failed to rename watchlist",
      );
    } finally {
      setRenameBusy(false);
    }
  }

  async function handleDeleteWatchlistConfirmed() {
    if (!watchlist) return;
    setDeleting(true);
    setDeleteWatchlistError(null);
    try {
      await api.deleteWatchlist(id);
      router.push("/");
    } catch (err) {
      setDeleting(false);
      setDeleteWatchlistError(
        err instanceof api.ApiError
          ? err.message
          : "Failed to delete watchlist",
      );
    }
  }

  async function handleAddSymbol(e: React.FormEvent) {
    e.preventDefault();
    const symbol = symbolInput.trim();
    if (!symbol) return;
    setAddingSymbol(true);
    setAddError(null);
    try {
      const { item } = await api.addSymbol(id, symbol);
      setWatchlist((prev) =>
        prev
          ? {
              ...prev,
              items: [...prev.items, item],
              itemCount: prev.itemCount + 1,
            }
          : prev,
      );
      setSymbolInput("");
      await reloadAttention();
    } catch (err) {
      setAddError(
        err instanceof api.ApiError ? err.message : "Failed to add symbol",
      );
    } finally {
      setAddingSymbol(false);
    }
  }

  async function handleRemoveSymbolConfirmed() {
    if (!removeTarget) return;
    const { id: itemId } = removeTarget;
    setRemovingItemId(itemId);
    setRemoveError(null);
    try {
      await api.removeSymbol(id, itemId);
      setWatchlist((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.filter((it) => it.id !== itemId),
              itemCount: prev.itemCount - 1,
            }
          : prev,
      );
      setRemoveTarget(null);
      await reloadAttention();
    } catch (err) {
      setRemoveError(
        err instanceof api.ApiError ? err.message : "Failed to remove symbol",
      );
    } finally {
      setRemovingItemId(null);
    }
  }

  if (loadState === "loading") {
    return (
      <div className="page">
        <Link href="/" className="back-link">
          ← Watchlists
        </Link>
        <div className="loading-state" role="status" aria-live="polite">
          <span className="spinner" />
          Loading watchlist…
        </div>
      </div>
    );
  }

  if (loadState === "error" || !watchlist) {
    return (
      <div className="page">
        <Link href="/" className="back-link">
          ← Watchlists
        </Link>
        <div
          className="error-banner"
          role="alert"
          style={{ marginTop: "1rem" }}
        >
          <span>{loadError ?? "Watchlist not found"}</span>
          <button className="btn" onClick={load}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className="page"
      initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      <Link href="/" className="back-link">
        ← Watchlists
      </Link>

      <div className="page-header" style={{ marginTop: "0.9rem" }}>
        {renaming ? (
          <div className="inline-edit-row">
            <input
              className="input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={80}
              autoFocus
            />
            <button
              className="btn btn-primary"
              disabled={renameBusy || !renameValue.trim()}
              onClick={confirmRename}
            >
              {renameBusy ? "Saving…" : "Save"}
            </button>
            <button className="btn" onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="watchlist-title" title={watchlist.name}>
            <h1 className="page-heading" style={{ fontSize: "2.25rem" }}>
              {watchlist.name}
            </h1>
            <p className="subtitle">
              {watchlist.itemCount}{" "}
              {watchlist.itemCount === 1 ? "symbol" : "symbols"}
            </p>
          </div>
        )}

        {!renaming && (
          <div className="row-actions">
            <button className="btn" onClick={startRename}>
              Rename
            </button>
            <button
              className="btn btn-danger"
              disabled={deleting}
              onClick={() => setDeleteWatchlistOpen(true)}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        )}
      </div>
      {renameError && (
        <div className="error-banner" role="alert">
          <span>{renameError}</span>
        </div>
      )}
      {deleteWatchlistError && (
        <div className="error-banner" role="alert">
          <span>{deleteWatchlistError}</span>
        </div>
      )}

      <div className="section-heading-block">
        <h2 className="section-heading">What&rsquo;s moving</h2>
      </div>
      <AttentionSection watchlistId={id} showWatchlistName={false} />

      <div className="section-title">Add a symbol</div>
      <form className="form-row" onSubmit={handleAddSymbol}>
        <input
          className="input"
          placeholder="Enter ticker symbol (e.g. AAPL, TCS, RELIANCE)"
          value={symbolInput}
          onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
          disabled={addingSymbol}
          maxLength={20}
        />
        <button
          className="btn btn-primary"
          type="submit"
          disabled={addingSymbol || !symbolInput.trim()}
        >
          {addingSymbol ? "Adding…" : "+ Add stock"}
        </button>
      </form>
      {addError && (
        <div className="error-banner" role="alert">
          <span>{addError}</span>
        </div>
      )}

      {removeError && (
        <div className="error-banner" role="alert">
          <span>{removeError}</span>
          <button className="btn" onClick={() => setRemoveError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="section-heading-block">
        <h2 className="section-heading">All holdings</h2>
      </div>
      {watchlist.items.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-title">Your watchlist is quiet.</span>
          Add a symbol above to start tracking meaningful changes.
        </div>
      ) : (
        <div className="card">
          {watchlist.items.map((item) => {
            const live = attentionByItemId.get(item.id);
            const percentLabel = live
              ? formatPercent(live.percentChange)
              : null;
            const direction =
              live?.absoluteChange == null
                ? null
                : live.absoluteChange > 0
                  ? "is-up"
                  : live.absoluteChange < 0
                    ? "is-down"
                    : null;
            // Same direction-follows-movement rule as AttentionSection's
            // SIGNIFICANT badge — a SIGNIFICANT status shown here (a
            // symbol's live badge on its holding row) must colour by
            // direction too, not default to red.
            const badgeClass = live
              ? `badge ${STATUS_BADGE_CLASS[live.status]} ${
                  live.status === "SIGNIFICANT"
                    ? direction === "is-up"
                      ? "badge-significant-positive"
                      : direction === "is-down"
                        ? "badge-significant-negative"
                        : ""
                    : ""
                }`
              : "";
            return (
              <div className="item-row-group" key={item.id}>
                <div className="item-row">
                  <div className="item-row-main">
                    <div className="item-symbol-line">
                      <span className="item-symbol">{item.symbol}</span>
                      {item.name && item.name !== item.symbol && (
                        <span className="item-company">{item.name}</span>
                      )}
                      {live && (
                        <span className={badgeClass}>
                          {STATUS_LABEL[live.status]}
                        </span>
                      )}
                    </div>
                    <div className="item-meta">
                      Added {new Date(item.addedAt).toLocaleDateString()}
                      {live && live.observedAt && (
                        <>
                          {" "}
                          ·{" "}
                          {formatFreshnessShort(
                            live.observedAt,
                            live.status,
                            live.quoteTime,
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="item-row-price">
                    {/* Fixed-width columns so spark / price / change / action line
                      up identically on every row, whatever data a row has. */}
                    <span className="item-spark-slot">
                      {live && isSparklineDrawable(live.sparkline) ? (
                        <Sparkline
                          data={live.sparkline}
                          width={64}
                          height={22}
                          direction={
                            direction === "is-up"
                              ? "up"
                              : direction === "is-down"
                                ? "down"
                                : "flat"
                          }
                        />
                      ) : (
                        <span
                          className="item-spark-empty"
                          title="Not enough price history yet to draw a chart"
                        >
                          No history
                        </span>
                      )}
                    </span>
                    <span className="item-price">
                      {live && live.currentPrice !== null ? (
                        formatPriceWithCurrency(
                          live.currentPrice,
                          live.symbol,
                          live.currency,
                        )
                      ) : (
                        <span className="item-price-empty">
                          {live ? "Unavailable" : "…"}
                        </span>
                      )}
                    </span>
                    <span
                      className={`attention-delta item-delta ${direction ?? ""}`}
                    >
                      {live && live.currentPrice !== null && percentLabel ? (
                        <>
                          {direction === "is-up"
                            ? "↑ "
                            : direction === "is-down"
                              ? "↓ "
                              : ""}
                          {percentLabel}
                        </>
                      ) : null}
                    </span>
                    <button
                      className="btn btn-icon btn-danger"
                      disabled={removingItemId === item.id}
                      onClick={() =>
                        setRemoveTarget({ id: item.id, symbol: item.symbol })
                      }
                    >
                      {removingItemId === item.id ? "Removing…" : "Remove"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteWatchlistOpen}
        title={`Delete "${watchlist.name}"?`}
        description="This removes the watchlist and every symbol on it. This cannot be undone."
        confirmLabel="Delete watchlist"
        danger
        busy={deleting}
        onConfirm={handleDeleteWatchlistConfirmed}
        onCancel={() => setDeleteWatchlistOpen(false)}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        title={`Remove ${removeTarget?.symbol}?`}
        description="This removes the symbol from this watchlist."
        confirmLabel="Remove symbol"
        danger
        busy={removingItemId === removeTarget?.id}
        onConfirm={handleRemoveSymbolConfirmed}
        onCancel={() => setRemoveTarget(null)}
      />
    </motion.div>
  );
}
