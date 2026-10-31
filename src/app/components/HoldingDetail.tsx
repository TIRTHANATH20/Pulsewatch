"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import MarketView from "@/app/components/MarketView";
import { useAttention } from "@/app/hooks/useAttention";
import * as api from "@/lib/api-client";
import { formatPercent } from "@/lib/format";

export default function HoldingDetail({
  watchlistId,
  itemId,
}: {
  watchlistId: string;
  itemId: string;
}) {
  const { items, loadState, error, reload } = useAttention(watchlistId);
  const [insight, setInsight] = useState<api.MarketInsight | null>(null);
  const [insightError, setInsightError] = useState<string | null>(null);
  const item = items.find((candidate) => candidate.itemId === itemId);

  useEffect(() => {
    if (!item) return;
    let active = true;
    setInsightError(null);
    void api.fetchMarketInsight(item.symbol).then(
      (result) => {
        if (active) setInsight(result);
      },
      (reason) => {
        if (active) {
          setInsightError(
            reason instanceof Error ? reason.message : "Insight unavailable",
          );
        }
      },
    );
    return () => {
      active = false;
    };
  }, [item]);

  if (!item && loadState === "loading") {
    return <main className="page"><div className="loading-state">Loading holding…</div></main>;
  }

  if (!item) {
    return (
      <main className="page">
        <Link className="back-link" href="/">← Back to companies</Link>
        <div className="error-banner" role="alert">
          {error ?? "This holding could not be found."}
        </div>
      </main>
    );
  }

  const movement = item.dayChangePercent ?? item.percentChange;

  return (
    <main className="page holding-detail-page">
      <Link className="back-link" href="/">← Back to companies</Link>
      <header className="holding-detail-header">
        <p className="eyebrow">Holding details</p>
        <div className="holding-detail-title-row">
          <div>
            <h1 className="page-heading">{item.name !== item.symbol ? item.name : item.symbol}</h1>
            <p className="section-sub">{item.symbol} · {item.exchange}</p>
          </div>
          <div className="holding-detail-price">
            <strong>{item.currentPrice === null ? "Unavailable" : `${item.currency ?? ""} ${item.currentPrice.toFixed(2)}`}</strong>
            <span className={movement !== null && movement < 0 ? "is-down" : "is-up"}>
              {formatPercent(movement) ?? "—"}
            </span>
          </div>
        </div>
      </header>

      <section className="holding-detail-insight liquid-glass" aria-label="Holding analysis">
        <div>
          <p className="eyebrow">AI outlook</p>
          <h2 className={`section-heading insight-${insight?.recommendation ?? "pending"}`}>
            {insight
              ? `Suggestion: ${insight.recommendation === "sell" ? "Sell" : "Hold"}`
              : "Loading analysis…"}
          </h2>
        </div>
        {insight && <p>{insight.summary}</p>}
        {insight && (
          <details className="holding-rag-context">
            <summary>Why this suggestion?</summary>
            <ul>
              {insight.rag_context.map((fact) => <li key={fact}>{fact}</li>)}
            </ul>
          </details>
        )}
        {insightError && <p className="error-text">{insightError}</p>}
      </section>

      <MarketView
        items={[item]}
        loadState={loadState}
        error={error}
        onRetry={reload}
      />
    </main>
  );
}
