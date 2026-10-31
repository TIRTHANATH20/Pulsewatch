"use client";
import { useEffect, useMemo, useState } from "react";
import type { AttentionItemDTO } from "@/types/attention";
import type { HistoricalBar, HistoryRange } from "@/server/modules/market/types";
import { fetchMarketHistory, ApiError } from "@/lib/api-client";
import { toHeikinAshi, toRenko } from "@/server/modules/market/chart-transformations";
import { formatPrice, formatPriceWithCurrency, formatPercent, formatFreshness, moveForDisplay } from "@/lib/format";
import { marketViewStatus, resolveSelectedSymbol, splitStocks } from "@/lib/market-view";
import Link from "next/link";

type ChartType = "line" | "area" | "bar" | "candles" | "heikin" | "renko" | "map";
const chartTypes: Array<[ChartType, string]> = [["line", "Line"], ["area", "Area"], ["bar", "Bars"], ["candles", "Candles"], ["heikin", "Heikin-Ashi"], ["renko", "Renko"], ["map", "Market map"]];
const ranges: HistoryRange[] = ["1D", "1W", "1M", "3M", "1Y"];

type HistoryState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; bars: HistoricalBar[]; source: string; stale?: boolean }
  | { kind: "unavailable"; source: string }
  | { kind: "error"; message: string };

interface MarketViewProps {
  items: AttentionItemDTO[];
  // Load state of the attention feed `items` came from, so "still loading" and
  // "failed" are never mistaken for "you track no stocks".
  loadState?: "loading" | "ready" | "error";
  error?: string | null;
  onRetry?: () => void;
}

export default function MarketView({ items, loadState = "ready", error = null, onRetry }: MarketViewProps) {
  const { selectable, unavailable } = useMemo(() => splitStocks(items), [items]);
  const [picked, setPicked] = useState("");
  // Derived, not stored: always a stock that currently has a quote.
  const selected = resolveSelectedSymbol(picked, selectable);
  const status = marketViewStatus({ loadState, error, items });
  const [type, setType] = useState<ChartType>("area");
  const [range, setRange] = useState<HistoryRange>("1M");
  const [history, setHistory] = useState<HistoryState>({ kind: "idle" });
  const [retryToken, setRetryToken] = useState(0);
  const current = selectable.find((i) => i.symbol === selected);
  const bars = history.kind === "ready" ? history.bars : [];
  const source = history.kind === "ready" || history.kind === "unavailable" ? history.source : "";
  useEffect(() => {
    if (!selected || type === "map") { setHistory({ kind: "idle" }); return; }
    let cancelled = false;
    setHistory({ kind: "loading" });
    fetchMarketHistory(selected, range)
      .then((r) => { if (!cancelled) setHistory(r.status === "unavailable" ? { kind: "unavailable", source: r.source } : { kind: "ready", bars: r.bars, source: r.source, stale: r.status === "stale" }); })
      .catch((err) => { if (!cancelled) setHistory({ kind: "error", message: err instanceof ApiError ? err.message : "Could not load market history." }); });
    return () => { cancelled = true; };
  }, [selected, range, type, retryToken]);
  const derived = type === "heikin" ? toHeikinAshi(bars) : type === "renko" ? toRenko(bars).bars : bars;
  const retry = () => setRetryToken((n) => n + 1);
  return <section className="market-view"><div className="market-view-header"><div><div className="section-kicker">Market view</div><h2>Explore your market</h2></div>{source && <span className="data-provenance">{source === "simulated" ? "DEMO DATA" : "PROVIDER DATA"}</span>}</div>
    <div className="market-controls"><select value={selected} onChange={(e) => setPicked(e.target.value)} aria-label="Stock" disabled={!selectable.length}><option value="" disabled={!!selectable.length}>{status.kind === "loading" ? "Loading stocks…" : selectable.length ? "Select a stock" : "No stock available"}</option>{selectable.map((i) => <option key={i.symbol} value={i.symbol}>{i.symbol}</option>)}{unavailable.map((i) => <option key={i.symbol} value={i.symbol} disabled>{i.symbol} (no current quote)</option>)}</select><div className="control-scroll">{chartTypes.map(([value, label]) => <button key={value} className={type === value ? "control active" : "control"} onClick={() => setType(value)}>{label}</button>)}</div><div className="range-controls">{ranges.map((r) => <button key={r} className={range === r ? "control active" : "control"} onClick={() => setRange(r)}>{r}</button>)}</div></div>
    {status.kind === "loading" && <div className="empty-state" role="status">Loading your stocks…</div>}
    {status.kind === "error" && <div className="error-banner" role="alert"><span>{status.message}</span>{onRetry && <button className="btn" onClick={onRetry}>Retry</button>}</div>}
    {status.kind === "no-stocks" && <div className="empty-state">Add your first stock to open Market View.</div>}
    {status.kind === "no-quotes" && <div className="empty-state" role="status">None of your {status.tracked} tracked {status.tracked === 1 ? "stock has" : "stocks have"} a current quote right now, so there is nothing to chart yet.{status.reason ? ` ${status.reason}` : ""}{onRetry && <> <button className="btn" onClick={onRetry}>Try again</button></>}</div>}
    {status.kind === "ready" && status.withoutQuote > 0 && <small className="chart-note">{status.withoutQuote} of {status.tracked} tracked stocks have no current quote and can’t be selected.</small>}
    {type === "map" ? (status.kind === "ready" || status.kind === "no-quotes") && <MarketMap items={items} /> : current && <div className="chart-workspace"><div className="chart-stat"><span>{current.symbol}</span><strong>{formatPriceWithCurrency(current.currentPrice, current.symbol, current.currency)}</strong><b className={`market-change ${(moveForDisplay(current) ?? 0) >= 0 ? "is-up" : "is-down"}`}>{formatPercent(moveForDisplay(current)) ?? "—"}</b><small>{current.status === "STALE" ? "STALE · " : ""}{current.observedAt ? formatFreshness(current.observedAt, current.status, current.quoteTime) : "Unavailable"}</small></div>
      {history.kind === "loading" && <div className="chart-empty">Loading market history…</div>}
      {history.kind === "error" && <div className="chart-empty" role="alert">{history.message} <button className="btn" onClick={retry}>Retry</button></div>}
      {history.kind === "unavailable" && <div className="chart-empty" role="status">Market history is unavailable from the data provider right now. <button className="btn" onClick={retry}>Retry</button></div>}
      {history.kind === "ready" && (bars.length ? <SvgChart bars={derived} type={type} /> : <div className="chart-empty">The provider returned no price history for {current.symbol} over {range}.</div>)}
      {history.kind === "ready" && history.stale && <small className="chart-note">Showing the last successfully loaded history — the provider did not respond just now. <button className="btn" onClick={retry}>Refresh</button></small>}
      {type === "renko" && history.kind === "ready" && <small className="chart-note">Renko · derived view · brick size {formatPrice(Math.max((bars[0]?.close ?? 1) * 0.01, 0.01))}</small>}</div>}
  </section>;
}

function SvgChart({ bars, type }: { bars: HistoricalBar[]; type: ChartType }) {
  if (!bars.length) return <div className="chart-empty">Market data unavailable.</div>;
  const width = 800;
  const height = 330;
  const left = 64;
  const right = 18;
  const top = 18;
  const bottom = 42;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const values = bars.flatMap((bar) => [bar.high, bar.low]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || Math.max(max * 0.02, 1);
  const y = (value: number) => top + ((max - value) / spread) * chartHeight;
  const x = (index: number) => left + (index / Math.max(bars.length - 1, 1)) * chartWidth;
  const linePoints = bars.map((bar, index) => `${x(index)},${y(bar.close)}`).join(" ");
  const areaPoints = `${left},${top + chartHeight} ${linePoints} ${left + chartWidth},${top + chartHeight}`;
  const gridLines = Array.from({ length: 5 }, (_, index) => {
    const value = max - (spread * index) / 4;
    return { value, y: y(value) };
  });
  const labelIndexes = [0, Math.floor((bars.length - 1) / 2), bars.length - 1];
  const showCandles = type === "candles" || type === "heikin" || type === "renko";

  return (
    <div className="chart-shell">
      <svg className="market-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${type} price chart`}>
        {gridLines.map((grid) => (
          <g key={grid.y}>
            <line className="chart-grid-line" x1={left} x2={left + chartWidth} y1={grid.y} y2={grid.y} />
            <text className="chart-axis-label" x={left - 10} y={grid.y + 4} textAnchor="end">
              {grid.value.toFixed(2)}
            </text>
          </g>
        ))}
        {labelIndexes.map((index) => (
          <text className="chart-axis-label" key={index} x={x(index)} y={height - 14} textAnchor="middle">
            {bars[index]?.timestamp.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </text>
        ))}
        {type === "bar" && bars.map((bar, index) => (
          <line className={bar.close >= bar.open ? "chart-up" : "chart-down"} key={bar.timestamp.toISOString()} x1={x(index)} x2={x(index)} y1={y(bar.high)} y2={y(bar.low)} />
        ))}
        {showCandles && bars.map((bar, index) => {
          const candleWidth = Math.max(2, Math.min(10, chartWidth / bars.length * 0.65));
          const color = bar.close >= bar.open ? "chart-up" : "chart-down";
          return (
            <g key={bar.timestamp.toISOString()}>
              <line className={color} x1={x(index)} x2={x(index)} y1={y(bar.high)} y2={y(bar.low)} />
              <rect className={color} x={x(index) - candleWidth / 2} y={Math.min(y(bar.open), y(bar.close))} width={candleWidth} height={Math.max(2, Math.abs(y(bar.open) - y(bar.close)))} />
              <title>{`${bar.timestamp.toLocaleString()} · Open ${bar.open.toFixed(2)} · High ${bar.high.toFixed(2)} · Low ${bar.low.toFixed(2)} · Close ${bar.close.toFixed(2)}`}</title>
            </g>
          );
        })}
        {!showCandles && type !== "bar" && (
          <>
            {type === "area" && <polygon className="chart-area-fill" points={areaPoints} />}
            <polyline className="chart-line" points={linePoints} />
            {bars.map((bar, index) => (
              <circle className="chart-point" key={bar.timestamp.toISOString()} cx={x(index)} cy={y(bar.close)} r="2.5">
                <title>{`${bar.timestamp.toLocaleString()} · Close ${bar.close.toFixed(2)}`}</title>
              </circle>
            ))}
          </>
        )}
      </svg>
    </div>
  );
}

function MarketMap({ items }: { items: AttentionItemDTO[] }) { return <div className="market-map">{items.map((i) => { const pct = i.percentChange ?? 0; return <Link href={`/watchlists/${i.watchlistId}?symbol=${i.symbol}`} className={`market-tile ${pct >= 0 ? "up" : "down"}`} key={i.itemId} title={`${i.name} · ${i.currentPrice === null ? "Unavailable" : formatPriceWithCurrency(i.currentPrice, i.symbol, i.currency)} · ${i.status}`}><strong>{i.symbol}</strong><span>{i.name}</span><b>{i.percentChange === null ? "—" : formatPercent(i.percentChange)}</b><small>{i.status}</small></Link>; })}</div>; }
