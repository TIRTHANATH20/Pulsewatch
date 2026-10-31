"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { AttentionItemDTO, AttentionStatus } from "@/types/attention";
import { useAttention } from "@/app/hooks/useAttention";
import Sparkline from "./Sparkline";
import { isSparklineDrawable } from "@/lib/sparkline";
import {
  moveForDisplay,
  formatPriceWithCurrency,
  formatPercent,
  formatFreshness,
  formatVolume,
  STATUS_LABEL,
  STATUS_BADGE_CLASS,
} from "@/lib/format";

// Statuses meaningful enough to always show as full cards in the hero
// panel. The API already returns items sorted SIGNIFICANT → CHANGED →
// NEW → STALE → UNCHANGED → UNAVAILABLE (attention/service.ts's
// STATUS_SORT_WEIGHT), matching the redesign's attention hierarchy, so
// the frontend just needs to draw the line at the same point: NEW ("a
// first observation was recorded") is still a meaningful visit-over-
// visit event worth surfacing, unlike STALE/UNCHANGED/UNAVAILABLE which
// collapse into the quiet list below.
const NOTABLE: AttentionStatus[] = ["SIGNIFICANT", "CHANGED", "NEW"];

interface AttentionSectionProps {
  // Scope to one watchlist. Omitted = every watchlist the user owns.
  watchlistId?: string;
  // Show which watchlist each item belongs to (dashboard view) vs. hide
  // it since it's implied by the page (per-watchlist detail view).
  showWatchlistName?: boolean;
}

export default function AttentionSection({
  watchlistId,
  showWatchlistName = true,
}: AttentionSectionProps) {
  const { items, loadState, error, reload } = useAttention(watchlistId);
  const [quietToggle, setQuietToggle] = useState<boolean | null>(null);
  const prefersReducedMotion = useReducedMotion();

  if (loadState === "loading") {
    return (
      <div className="attention-section">
        <div className="attention-hero liquid-glass">
          <div className="attention-hero-header">
            <p className="attention-eyebrow">Since your last visit</p>
          </div>
          <div className="attention-list">
            <div className="skeleton skeleton-card" />
            <div className="skeleton skeleton-card" />
          </div>
        </div>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="attention-section">
        <div className="attention-hero liquid-glass">
          <div className="attention-hero-header">
            <p className="attention-eyebrow">Since your last visit</p>
          </div>
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="btn" onClick={reload}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="attention-section">
        <div className="attention-hero liquid-glass">
          <div className="attention-hero-header">
            <p className="attention-eyebrow">Since your last visit</p>
          </div>
          <motion.div
            className="empty-state"
            initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <motion.span
              className="empty-state-beacon"
              aria-hidden="true"
              animate={prefersReducedMotion ? { scale: 1, opacity: 0.7 } : { scale: [1, 1.18, 1], opacity: [0.55, 1, 0.55] }}
              transition={prefersReducedMotion ? undefined : { duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            />
            <span className="empty-state-title">Your watchlist is quiet.</span>
            Add a symbol {watchlistId ? "to this watchlist" : "to a watchlist"} to
            start tracking meaningful changes.
          </motion.div>
        </div>
      </div>
    );
  }

  const notable = items.filter((item) => NOTABLE.includes(item.status));
  const quiet = items.filter((item) => !NOTABLE.includes(item.status));
  // When nothing is "notable" the quiet list is the only place the user's
  // companies appear, so open it by default instead of hiding every stock
  // behind a collapsed toggle (which looked like "no companies shown").
  const showQuiet = quietToggle ?? notable.length === 0;

  return (
    <div className="attention-section">
      <div className="attention-hero liquid-glass">
        <div className="attention-hero-header">
          <p className="attention-eyebrow">Since your last visit</p>
          <p className="attention-count">
            {notable.length === 0 ? (
              "All caught up"
            ) : (
              <>
                <span className="attention-count-number">{notable.length}</span>{" "}
                meaningful {notable.length === 1 ? "change" : "changes"}
              </>
            )}
          </p>
        </div>

        {notable.length === 0 && (
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true">
              ✓
            </span>
            <span className="empty-state-title">Nothing needs your attention.</span>
            Your watchlist hasn&rsquo;t moved meaningfully since your last visit.
          </div>
        )}

        {notable.length > 0 && (
          <div className="attention-list">
            {notable.map((item, index) => (
              <AttentionCard
                key={item.itemId}
                item={item}
                index={index}
                showWatchlistName={showWatchlistName}
              />
            ))}
          </div>
        )}

        {quiet.length > 0 && (
          <div className="attention-quiet">
            <button
              className="attention-quiet-toggle"
              onClick={() => setQuietToggle(!showQuiet)}
            >
              {showQuiet ? "Hide" : "Show"} {quiet.length}{" "}
              {quiet.length === 1 ? "instrument" : "instruments"} with no
              notable change
            </button>
            {showQuiet && (
              <div className="attention-quiet-list">
                {quiet.map((item) => (
                  <div className="attention-quiet-row" key={item.itemId}>
                    <span>
                      <strong>{item.symbol}</strong>
                      {showWatchlistName && ` · ${item.watchlistName}`}
                      {item.currentPrice !== null &&
                        ` · ${formatPriceWithCurrency(item.currentPrice, item.symbol, item.currency)}`}
                      {item.currentPrice !== null &&
                        ` · ${formatPercent(moveForDisplay(item)) ?? "—"}`}
                      {item.status === "UNAVAILABLE" && (
                        <span className="attention-quiet-note">
                          {" "}
                          · Market data temporarily unavailable. Your previous
                          observation has been preserved.
                        </span>
                      )}
                    </span>
                    <span className={`badge ${STATUS_BADGE_CLASS[item.status]}`}>
                      {STATUS_LABEL[item.status]}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, delay: Math.min(index * 0.06, 0.3), ease: [0.16, 1, 0.3, 1] },
  }),
};

function AttentionCard({
  item,
  index,
  showWatchlistName,
}: {
  item: AttentionItemDTO;
  index: number;
  showWatchlistName: boolean;
}) {
  const prefersReducedMotion = useReducedMotion();
  const direction =
    item.absoluteChange === null
      ? null
      : item.absoluteChange > 0
        ? "is-up"
        : item.absoluteChange < 0
          ? "is-down"
          : null;

  // SIGNIFICANT's colour always follows movement direction, never the
  // status alone — a significant drop reads red, a significant gain
  // reads green, and the (practically unreachable, since SIGNIFICANT
  // requires a non-zero % move past the threshold) zero-movement case
  // stays neutral. Same `direction` value that colours the delta arrow
  // below, so the two never disagree.
  const significantDirectionClass =
    direction === "is-up" ? "is-positive" : direction === "is-down" ? "is-negative" : "";

  const cardClass =
    item.status === "SIGNIFICANT"
      ? `is-significant ${significantDirectionClass}`
      : item.status === "CHANGED"
        ? "is-changed"
        : item.status === "NEW"
          ? "is-new"
          : "";

  const badgeClass =
    item.status === "SIGNIFICANT"
      ? `badge ${STATUS_BADGE_CLASS[item.status]} ${
          significantDirectionClass === "is-positive"
            ? "badge-significant-positive"
            : significantDirectionClass === "is-negative"
              ? "badge-significant-negative"
              : ""
        }`
      : `badge ${STATUS_BADGE_CLASS[item.status]}`;

  const percentLabel = formatPercent(moveForDisplay(item));

  const sparklineDirection =
    direction === "is-up" ? "up" : direction === "is-down" ? "down" : "flat";
  const volumeLabel = formatVolume(item.volume);

  return (
    <motion.div
      className={`attention-card ${cardClass}`}
      custom={index}
      initial={prefersReducedMotion ? false : "hidden"}
      animate="visible"
      variants={cardVariants}
      whileHover={prefersReducedMotion ? undefined : { y: -2 }}
    >
      <div className="attention-card-left">
        <div className="attention-card-top">
          <div className="attention-symbol-group">
            <span className="attention-symbol">{item.symbol}</span>
            <span className={badgeClass}>{STATUS_LABEL[item.status]}</span>
          </div>
          {showWatchlistName && (
            <Link
              href={`/watchlists/${item.watchlistId}`}
              className="attention-watchlist-tag"
            >
              {item.watchlistName}
            </Link>
          )}
        </div>
        {item.name && item.name !== item.symbol && (
          <span className="attention-company">{item.name}</span>
        )}
      </div>

      <div className="attention-card-center">
        <span className="attention-price-current">
          {formatPriceWithCurrency(item.currentPrice, item.symbol, item.currency)}
        </span>
        {percentLabel && (
          <span className={`attention-delta ${direction ?? ""}`}>
            {direction === "is-up" ? "↑ " : direction === "is-down" ? "↓ " : ""}
            {percentLabel}
          </span>
        )}
        {isSparklineDrawable(item.sparkline) && (
          <Sparkline data={item.sparkline} direction={sparklineDirection} />
        )}
      </div>

      <div className="attention-card-right">
        {item.previousPrice !== null && (
          <span className="attention-compare">
            <span className="attention-compare-prev">
              {formatPriceWithCurrency(item.previousPrice, item.symbol, item.currency)}
            </span>
            <span className="attention-compare-arrow" aria-hidden="true">
              →
            </span>
            <span className="attention-compare-current">
              {formatPriceWithCurrency(item.currentPrice, item.symbol, item.currency)}
            </span>
          </span>
        )}
        <div className="attention-reason">{item.reason}</div>
        <div className="attention-footer">
          {formatFreshness(item.observedAt, item.status, item.quoteTime)}
          {volumeLabel && ` · Vol ${volumeLabel}`}
        </div>
      </div>
    </motion.div>
  );
}
