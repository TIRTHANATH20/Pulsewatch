"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAttention } from "@/app/hooks/useAttention";
import * as api from "@/lib/api-client";
import type { AuthUser } from "@/lib/api-client";
import ThemeToggle from "./ThemeToggle";

// Persistent top bar rendered by the root layout on every page. Reuses
// the same `useAttention()` hook every other surface uses (DECISIONS.md
// — shared fetch/loading/error implementation, no new endpoint) purely
// to read the freshest `observedAt` across the user's instruments, so
// the header's "Updated N min ago" reflects real market-data freshness
// rather than a hardcoded label. Deliberately still restrained: one nav
// link back to the dashboard (PulseWatch has exactly one real
// destination — see prior iterations' notes), a freshness readout, and
// a refresh control. No search bar, no account menu, no notification
// bell.
export default function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthRoute = pathname === "/login" || pathname === "/signup";

  const { items, marketDataProvider, loadState, reload } = useAttention();
  const [refreshing, setRefreshing] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const latestObservedAt = useMemo(() => {
    let latest: string | null = null;
    for (const item of items) {
      if (item.observedAt && (!latest || item.observedAt > latest)) {
        latest = item.observedAt;
      }
    }
    return latest;
  }, [items]);

  const freshnessLabel = useMemo(() => {
    if (loadState === "loading" && items.length === 0) return "Checking…";
    if (loadState === "error") return "Freshness unavailable";
    if (!latestObservedAt) return "No data yet";
    const minutes = Math.max(
      0,
      Math.round((Date.now() - new Date(latestObservedAt).getTime()) / 60000),
    );
    if (minutes < 1) return "Updated just now";
    if (minutes === 1) return "Updated 1 min ago";
    if (minutes < 60) return `Updated ${minutes} min ago`;
    return `Updated ${Math.round(minutes / 60)} hr ago`;
  }, [loadState, items.length, latestObservedAt]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    api
      .fetchCurrentUser()
      .then(({ user }) => {
        if (!cancelled) setUser(user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setUserLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // Re-check after navigating away from /login or /signup, so a fresh
    // sign-in is reflected without a full page reload.
  }, [pathname]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await api.logout();
      setUser(null);
      router.push("/");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  if (isAuthRoute) {
    return null;
  }

  return (
    <header className="app-header">
      <div className="app-header-inner liquid-glass">
        <Link href="/" className="app-brand">
          <span className="app-brand-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                d="M3 12h4l2.5 7L14 5l2 7h5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="app-brand-name">PulseWatch</span>
        </Link>

        <nav className="app-nav" aria-label="Primary">
          <Link
            href="/"
            className={`app-nav-link ${pathname === "/" ? "is-active" : ""}`}
          >
            Overview
          </Link>
          <Link
            href="/chat"
            className={`app-nav-link ${pathname?.startsWith("/chat") ? "is-active" : ""}`}
          >
            PulseWatch AI
          </Link>
          <Link
            href="/nlp-demo"
            className={`app-nav-link ${pathname?.startsWith("/nlp-demo") ? "is-active" : ""}`}
          >
            NLP Demo
          </Link>
        </nav>

        <div className="app-header-right">
          <span
            className="freshness-indicator"
            aria-live="polite"
            title={
              marketDataProvider === "simulated"
                ? "PulseWatch uses simulated market data for this demo — not a live financial feed."
                : marketDataProvider === "yfinance"
                  ? "Quotes are fetched with yfinance from Yahoo Finance; exchange delays and provider rate limits may apply."
                  : marketDataProvider === "twelvedata"
                    ? "Quotes are sourced from Twelve Data; exchange delays may apply."
                    : "Market data source is being checked."
            }
          >
            <span
              className={`freshness-dot ${loadState === "ready" ? "is-live" : ""}`}
              aria-hidden="true"
            />
            <span className="freshness-label">{freshnessLabel}</span>
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Refresh market data"
          >
            <span
              className={`refresh-icon ${refreshing ? "is-spinning" : ""}`}
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>

          <ThemeToggle />

          {userLoaded && (
            <div className="auth-chip">
              {user ? (
                <>
                  <span className="auth-chip-email" title={user.email}>
                    {user.email}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost auth-chip-btn"
                    onClick={handleLogout}
                    disabled={loggingOut}
                  >
                    {loggingOut ? "Logging out…" : "Log out"}
                  </button>
                </>
              ) : (
                <Link href="/login" className="btn btn-ghost auth-chip-btn">
                  Log in
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
