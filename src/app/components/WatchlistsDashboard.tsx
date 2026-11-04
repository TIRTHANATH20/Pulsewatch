"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import type { WatchlistSummary } from "@/types/watchlist";
import * as api from "@/lib/api-client";
import { useAttention } from "@/app/hooks/useAttention";
import { formatPercent } from "@/lib/format";
import MarketView from "@/app/components/MarketView";

type LoadState = "loading" | "ready" | "error";

const SUGGESTIONS_PER_PAGE = 10;

export default function WatchlistsDashboard() {
  const [watchlists, setWatchlists] = useState<WatchlistSummary[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [companyQuery, setCompanyQuery] = useState("");
  const [searchResults, setSearchResults] = useState<api.CompanySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingSymbol, setAddingSymbol] = useState<string | null>(null);
  const [insights, setInsights] = useState<Record<string, api.MarketInsight>>({});
  const [buyInsights, setBuyInsights] = useState<Record<string, api.MarketInsight>>({});
  const [buyingInsight, setBuyingInsight] = useState<string | null>(null);
  const [removingHolding, setRemovingHolding] = useState<string | null>(null);
  const [investorHorizon, setInvestorHorizon] = useState<api.InvestorHorizon>("short_term");
  const [suggestedInsights, setSuggestedInsights] = useState<Record<string, api.MarketInsight>>({});
  const [suggestedCompanies, setSuggestedCompanies] = useState<api.CompanySearchResult[]>([]);
  const [suggestionsPage, setSuggestionsPage] = useState(1);
  const [suggestionsRefreshKey, setSuggestionsRefreshKey] = useState(0);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<WatchlistSummary | null>(
    null,
  );

  // Reused for the dashboard-wide metrics strip below the header — same
  // data AttentionSection fetches, so this doesn't add an extra request
  // beyond what the feed itself already needs.
  const {
    items: attentionItems,
    loadState: attentionLoadState,
    error: attentionError,
    reload: reloadAttention,
  } = useAttention();

  const holdingSymbols = useMemo(
    () => [...new Set(attentionItems.map((item) => item.symbol))],
    [attentionItems],
  );
  const ownedSymbols = useMemo(
    () => new Set(holdingSymbols.map((symbol) => symbol.toUpperCase())),
    [holdingSymbols],
  );

  const load = useCallback(async () => {
    setLoadState("loading");
    setLoadError(null);
    try {
      const { watchlists } = await api.fetchWatchlists();
      setWatchlists(watchlists);
      setLoadState("ready");
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load watchlists",
      );
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!holdingSymbols.length) return;
    let active = true;
    void Promise.all(
      holdingSymbols.map(async (symbol) => {
        try {
          return await api.fetchMarketInsight(symbol, "holding", investorHorizon);
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (!active) return;
      setInsights((current) => ({
        ...current,
        ...Object.fromEntries(
          results.filter((item): item is api.MarketInsight => item !== null)
            .map((item) => [item.symbol, item]),
        ),
      }));
    });
    return () => {
      active = false;
    };
  }, [
    holdingSymbols,
    investorHorizon,
  ]);

  const availableSuggestions = useMemo(
    () =>
      suggestedCompanies.filter(
        (stock) => !ownedSymbols.has(stock.symbol.toUpperCase()),
      ),
    [suggestedCompanies, ownedSymbols],
  );
  const eligibleSuggestions = useMemo(
    () =>
      availableSuggestions.filter((stock) => {
        const insight = suggestedInsights[stock.symbol];
        if (
          insight?.short_term_return_percent !== null &&
          insight?.short_term_return_percent !== undefined &&
          insight?.long_term_return_percent !== null &&
          insight?.long_term_return_percent !== undefined
        ) {
          return !(
            insight.short_term_return_percent < 0 &&
            insight.long_term_return_percent < 0
          );
        }
        return true;
      }),
    [availableSuggestions, suggestedInsights],
  );
  const suggestionPageCount = Math.max(
    1,
    Math.ceil(eligibleSuggestions.length / SUGGESTIONS_PER_PAGE),
  );
  const visibleSuggestions = useMemo(
    () =>
      eligibleSuggestions.slice(
        (suggestionsPage - 1) * SUGGESTIONS_PER_PAGE,
        suggestionsPage * SUGGESTIONS_PER_PAGE,
      ),
    [eligibleSuggestions, suggestionsPage],
  );
  const visibleSuggestionSymbols = useMemo(
    () => visibleSuggestions.map((stock) => stock.symbol),
    [visibleSuggestions],
  );

  useEffect(() => {
    if (suggestionsPage > suggestionPageCount) {
      setSuggestionsPage(suggestionPageCount);
    }
  }, [suggestionsPage, suggestionPageCount]);

  useEffect(() => {
    setSuggestionsPage(1);
    setSuggestedInsights({});
    let active = true;
    void api.fetchSuggestedCompanies(holdingSymbols, investorHorizon).then((companies) => {
      if (!active) return;
      setSuggestedCompanies(companies);
    }).then(() => {
      if (!active) return;
    }).catch((err) => {
      if (active) setCreateError(err instanceof Error ? err.message : "Dynamic suggestions are unavailable");
    });
    return () => {
      active = false;
    };
  }, [
    holdingSymbols,
    investorHorizon,
    suggestionsRefreshKey,
  ]);

  useEffect(() => {
    if (!visibleSuggestionSymbols.length) return;
    let active = true;
    void Promise.all(
      visibleSuggestionSymbols.map(async (symbol) => {
        try {
          return await api.fetchMarketInsight(symbol, "buy", investorHorizon);
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (!active) return;
      setSuggestedInsights((current) => ({
        ...current,
        ...Object.fromEntries(
          results.filter((item): item is api.MarketInsight => item !== null)
            .map((item) => [item.symbol, item]),
        ),
      }));
    });
    return () => {
      active = false;
    };
  }, [
    investorHorizon,
    visibleSuggestionSymbols,
  ]);

  useEffect(() => {
    const refreshTimer = window.setInterval(
      () => setSuggestionsRefreshKey((current) => current + 1),
      5 * 60 * 1000,
    );
    return () => window.clearInterval(refreshTimer);
  }, []);

  async function searchCompanies() {
    const query = companyQuery.trim();
    if (query.length < 2) return;
    setSearching(true);
    setCreateError(null);
    try {
      setSearchResults(await api.searchCompanies(query));
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Company search failed");
    } finally {
      setSearching(false);
    }

  }

  function clearCompanySearch() {
    setCompanyQuery("");
    setSearchResults([]);
    setBuyInsights({});
    setCreateError(null);
  }

  async function addCompany(symbol: string) {
    setAddingSymbol(symbol);
    setCreateError(null);
    try {
      let target = watchlists[0];
      if (!target) {
        const created = await api.createWatchlist("My holdings");
        target = created.watchlist;
        setWatchlists([target]);
      }
      await api.addSymbol(target.id, symbol);
      setCompanyQuery("");
      setSearchResults([]);
      await reloadAttention();
    } catch (err) {
      setCreateError(err instanceof api.ApiError ? err.message : "Failed to add company");
    } finally {
      setAddingSymbol(null);
    }
  }

  async function loadBuyInsight(symbol: string) {
    setBuyingInsight(symbol);
    setCreateError(null);
    try {
      const insight = await api.fetchMarketInsight(symbol, "buy");
      setBuyInsights((current) => ({ ...current, [symbol]: insight }));
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Buy insight is unavailable");
    } finally {
      setBuyingInsight(null);
    }
  }

  async function removeHolding(item: (typeof attentionItems)[number]) {
    setRemovingHolding(item.itemId);
    setCreateError(null);
    try {
      await api.removeSymbol(item.watchlistId, item.itemId);
      await Promise.all([reloadAttention(), load()]);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to remove holding");
    } finally {
      setRemovingHolding(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { watchlist } = await api.createWatchlist(newName.trim());
      setWatchlists((prev) => [...prev, watchlist]);
      setNewName("");
    } catch (err) {
      setCreateError(
        err instanceof api.ApiError
          ? err.message
          : "Failed to create watchlist",
      );
    } finally {
      setCreating(false);
    }
  }

  function startRename(w: WatchlistSummary) {
    setRenamingId(w.id);
    setRenameValue(w.name);
    setRowError(null);
  }

  async function confirmRename(id: string) {
    const name = renameValue.trim();
    if (!name) return;
    setRowBusyId(id);
    setRowError(null);
    try {
      const { watchlist } = await api.renameWatchlist(id, name);
      setWatchlists((prev) => prev.map((w) => (w.id === id ? watchlist : w)));
      setRenamingId(null);
    } catch (err) {
      setRowError(
        err instanceof api.ApiError
          ? err.message
          : "Failed to rename watchlist",
      );
    } finally {
      setRowBusyId(null);
    }
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    setRowBusyId(id);
    setRowError(null);
    try {
      await api.deleteWatchlist(id);
      setWatchlists((prev) => prev.filter((w) => w.id !== id));
      setDeleteTarget(null);
    } catch (err) {
      setRowError(
        err instanceof api.ApiError
          ? err.message
          : "Failed to delete watchlist",
      );
    } finally {
      setRowBusyId(null);
    }
  }

  const prefersReducedMotion = useReducedMotion();
  const fadeUp = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 12 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <motion.div
      className="page"
      initial="hidden"
      animate="visible"
      variants={fadeUp}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="page-intro">
        <p className="eyebrow">Market overview</p>
        <h1 className="page-heading">Here&rsquo;s what changed.</h1>
        <p className="page-sub">
          Track the stocks you care about and see what changed since your last
          visit.
        </p>
      </div>

      <section className="overview-add liquid-glass" aria-label="Add company">
        <div>
          <p className="eyebrow">Portfolio</p>
          <h2 className="section-heading">Companies</h2>
          <p className="section-sub">Search by company name or ticker and add it to your holdings.</p>
        </div>
        <form className="form-row company-search-form" onSubmit={(event) => { event.preventDefault(); void searchCompanies(); }}>
          <div className="company-search-input-wrap">
            <input
              className="input"
              value={companyQuery}
              onChange={(event) => setCompanyQuery(event.target.value)}
              placeholder="Search Apple, Philips, TCS, JPM…"
              aria-label="Search company or ticker"
            />
            {(companyQuery || searchResults.length > 0) && (
              <button className="search-clear" type="button" onClick={clearCompanySearch} aria-label="Clear company search">
                ×
              </button>
            )}
          </div>
          <button className="btn btn-primary" type="submit" disabled={searching || companyQuery.trim().length < 2}>
            {searching ? "Searching…" : "Search"}
          </button>
        </form>
        {searchResults.length > 0 && (
          <div className="company-search-results">
            {searchResults.map((result) => {
              const buyInsight = buyInsights[result.symbol];
              return (
                <div
                  className="company-search-result"
                  key={`${result.symbol}-${result.exchange ?? ""}`}
                >
                <span><strong>{result.name}</strong><small>{result.symbol}{result.exchange ? ` · ${result.exchange}` : ""}</small></span>
                <span className="company-search-actions">
                  <button className="btn btn-ghost" onClick={() => void loadBuyInsight(result.symbol)} disabled={buyingInsight !== null}>
                    {buyingInsight === result.symbol ? "Checking…" : buyInsights[result.symbol] ? "Refresh buy view" : "Should I buy?"}
                  </button>
                  <button className="btn btn-primary" onClick={() => void addCompany(result.symbol)} disabled={addingSymbol !== null}>
                    {addingSymbol === result.symbol ? "Adding…" : "Add"}
                  </button>
                </span>
                {buyInsight && (
                  <span className={`company-buy-insight is-${buyInsight.recommendation}`}>
                    {buyInsight.investor_horizon === "long_term"
                      ? "Long-term"
                      : "Short-term"}{" "}
                    buy view: <strong>{buyInsight.recommendation}</strong>.{" "}
                    {buyInsight.summary}
                  </span>
                )}
                </div>
              );
            })}
          </div>
        )}
        <section className="suggested-stocks" aria-label="Suggested stocks">
          <div className="suggested-stocks-heading">
            <div>
              <p className="eyebrow">Ideas for you</p>
              <h3>Stocks you could consider</h3>
              <p className="section-sub">
                Based on current market data. Stocks already in your holdings are left out.
              </p>
            </div>
            <span className="suggested-page-count">
              Page {suggestionsPage} of {suggestionPageCount}
            </span>
          </div>
          <div className="suggested-stock-grid">
            {visibleSuggestions.map((stock) => {
              const insight = suggestedInsights[stock.symbol];
              const reason = insight?.summary ?? null;
              return (
                <article className="suggested-stock-card" key={stock.symbol}>
                  <div className="suggested-stock-copy">
                    <div className="suggested-stock-title">
                      <strong>{stock.name}</strong>
                      <small>{stock.symbol}</small>
                    </div>
                    {reason ? <p>{reason}</p> : <p className="suggested-loading">Checking the latest forecast…</p>}
                  </div>
                  <button className="btn btn-primary" onClick={() => void addCompany(stock.symbol)} disabled={addingSymbol !== null}>
                    {addingSymbol === stock.symbol ? "Adding…" : "Add to holdings"}
                  </button>
                </article>
              );
            })}
          </div>
          <nav className="suggested-pagination" aria-label="Suggested stocks pages">
            <button className="btn btn-ghost" onClick={() => setSuggestionsPage((page) => Math.max(1, page - 1))} disabled={suggestionsPage === 1}>
              Previous
            </button>
            {Array.from({ length: suggestionPageCount }, (_, index) => index + 1).map((page) => (
              <button className={page === suggestionsPage ? "btn btn-primary is-page-active" : "btn btn-ghost"} key={page} onClick={() => setSuggestionsPage(page)} aria-label={`Go to suggestions page ${page}`}>
                {page}
              </button>
            ))}
            <button className="btn btn-ghost" onClick={() => setSuggestionsPage((page) => Math.min(suggestionPageCount, page + 1))} disabled={suggestionsPage === suggestionPageCount}>
              Next
            </button>
          </nav>
        </section>
      </section>

      {attentionItems.length > 0 && (
        <section className="overview-holdings" aria-label="Companies">
          <div className="section-heading-block">
            <h2 className="section-heading">Holdings</h2>
            <p className="section-sub">Live prices and trend-based outlooks for your tracked companies.</p>
            <p className="section-sub holdings-price-note">
              The percentage next to each price shows the change from the previous trading day&rsquo;s closing price.
            </p>
          </div>
          <div className="overview-holding-grid">
            {attentionItems.map((item) => {
              const insight = insights[item.symbol];
              return (
                <article className="overview-holding-card liquid-glass" key={item.itemId}>
                  <div className="overview-holding-top">
                    <div><strong>{item.name !== item.symbol ? item.name : item.symbol}</strong><small>{item.symbol}</small></div>
                    <span className={item.dayChangePercent !== null && (item.dayChangePercent ?? 0) < 0 ? "is-down" : "is-up"}>
                      {formatPercent(item.dayChangePercent ?? item.percentChange) ?? "—"}
                    </span>
                  </div>
                  <div className="overview-holding-price">
                    {item.currentPrice === null ? "Unavailable" : `${item.currency ?? ""} ${item.currentPrice.toFixed(2)}`}
                  </div>
                  {insight && (
                    <div className={`overview-insight is-${insight.recommendation}`}>
                      <strong>
                        Suggestion: {insight.recommendation === "sell" ? "Sell" : insight.recommendation === "hold" ? "Hold" : insight.recommendation === "consider" ? "Consider buying" : "Wait"}
                      </strong>
                      <span>{insight.summary}</span>
                      <small>
                        Forecast ({insight.forecast_horizon}): {insight.forecast_direction}
                        {" "}({insight.forecast_confidence} confidence)
                      </small>
                    </div>
                  )}
                  <button
                    className="btn btn-danger overview-remove"
                    onClick={() => void removeHolding(item)}
                    disabled={removingHolding === item.itemId}
                  >
                    {removingHolding === item.itemId ? "Removing…" : "Remove"}
                  </button>
                  <Link
                    className="btn btn-ghost overview-details"
                    href={`/holdings/${item.watchlistId}/${item.itemId}`}
                  >
                    View details
                  </Link>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <MarketView
        items={attentionItems}
        loadState={attentionLoadState}
        error={attentionError}
        onRetry={reloadAttention}
      />

      {attentionLoadState === "error" && (
        <div className="error-banner" role="alert">
          <span>{attentionError}</span>
          <button className="btn" onClick={reloadAttention}>Retry</button>
        </div>
      )}

      {loadState === "loading" && (
        <div className="loading-state" role="status">Loading your companies…</div>
      )}

    </motion.div>
  );
}
