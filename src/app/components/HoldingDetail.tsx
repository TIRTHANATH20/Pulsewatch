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
  const [investorHorizon, setInvestorHorizon] = useState<api.InvestorHorizon>("short_term");
  const [loadingHorizon, setLoadingHorizon] = useState(false);
  const item = items.find((candidate) => candidate.itemId === itemId);
  const symbol = item?.symbol;

  useEffect(() => {
    if (!symbol) return;
    let active = true;
    const controller = new AbortController();
    setInsightError(null);
    setLoadingHorizon(true);
    void fetch(
      `/api/market/${encodeURIComponent(symbol)}/insight?purpose=holding&horizon=${investorHorizon}`,
      { signal: controller.signal, cache: "no-store" },
    ).then(async (response) => {
      const body = await response.json();
      if (!response.ok) {
        throw new api.ApiError(
          typeof body?.message === "string"
            ? body.message
            : "Insight unavailable",
          response.status,
        );
      }
      return body as api.MarketInsight;
    }).then(
      (result) => {
        if (active) {
          setInsight(result);
          setLoadingHorizon(false);
        }
      },
      (reason) => {
        if (active && reason?.name !== "AbortError") {
          setLoadingHorizon(false);
          setInsightError(
            reason instanceof Error ? reason.message : "Insight unavailable",
          );
        }
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [symbol, investorHorizon]);

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
          <div className="horizon-picker" role="group" aria-label="Investment horizon">
            <span>Investment horizon</span>
            <div className="horizon-options">
              {([
                ["short_term", "Short term", "1–3 months"],
                ["long_term", "Long term", "1–5 years"],
              ] as const).map(([value, label, range]) => (
                <button
                  className={investorHorizon === value ? "btn btn-ghost horizon-option is-active" : "btn btn-ghost horizon-option"}
                  key={value}
                  type="button"
                  aria-pressed={investorHorizon === value}
                  onClick={() => setInvestorHorizon(value)}
                >
                  <strong>{label}</strong>
                  <small>{range}</small>
                </button>
              ))}
            </div>
          </div>
          <h2 className={`section-heading insight-${insight?.recommendation ?? "pending"}`}>
            {insight
              ? `Suggestion: ${insight.recommendation === "sell" ? "Sell" : insight.recommendation === "hold" ? "Hold" : insight.recommendation === "consider" ? "Consider buying" : "Wait"}`
              : loadingHorizon ? "Checking this horizon…" : "Loading analysis…"}
          </h2>
        </div>
        {insight && <p>{insight.summary}</p>}
        {insight && (
          <p>
            Forecast for {insight.forecast_horizon}: <strong>{insight.forecast_direction}</strong>
            {" "}({insight.forecast_confidence} confidence)
          </p>
        )}
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
