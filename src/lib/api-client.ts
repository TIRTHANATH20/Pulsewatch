import type {
  WatchlistSummary,
  WatchlistDetail,
  WatchlistItemDTO,
} from "@/types/watchlist";
import type { AttentionResponse } from "@/types/attention";
import type {
  HistoricalBar,
  HistoryRange,
} from "@/server/modules/market/types";

// Thin fetch wrapper for the watchlist API. Lives outside `src/server` so
// it is safe to import from client components — it only ever talks to our
// own API routes over HTTP, never touches Prisma or other server-only
// modules directly.

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      (body && typeof body.message === "string" && body.message) ||
      `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }

  return body as T;
}

export function fetchWatchlists(): Promise<{ watchlists: WatchlistSummary[] }> {
  return request("/api/watchlists");
}

export function createWatchlist(
  name: string,
): Promise<{ watchlist: WatchlistSummary }> {
  return request("/api/watchlists", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function fetchWatchlist(
  id: string,
): Promise<{ watchlist: WatchlistDetail }> {
  return request(`/api/watchlists/${id}`);
}

export function renameWatchlist(
  id: string,
  name: string,
): Promise<{ watchlist: WatchlistSummary }> {
  return request(`/api/watchlists/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function deleteWatchlist(id: string): Promise<void> {
  return request(`/api/watchlists/${id}`, { method: "DELETE" });
}

export function addSymbol(
  id: string,
  symbol: string,
): Promise<{ item: WatchlistItemDTO }> {
  return request(`/api/watchlists/${id}/items`, {
    method: "POST",
    body: JSON.stringify({ symbol }),
  });
}

export function removeSymbol(id: string, itemId: string): Promise<void> {
  return request(`/api/watchlists/${id}/items/${itemId}`, {
    method: "DELETE",
  });
}

export interface CompanySearchResult {
  symbol: string;
  name: string;
  exchange?: string | null;
}

export interface MarketInsight {
  symbol: string;
  direction: "up" | "down" | "flat";
  confidence: "low" | "moderate";
  recommendation: "consider" | "wait" | "avoid" | "hold" | "sell";
  summary: string;
  basis: string;
  source: "llm_rag" | "deterministic_fallback";
  rag_context: string[];
}

export function searchCompanies(query: string): Promise<CompanySearchResult[]> {
  return request(`/api/market/search?q=${encodeURIComponent(query)}`);
}

export function fetchMarketInsight(
  symbol: string,
  purpose: "buy" | "holding" = "holding",
): Promise<MarketInsight> {
  return request(
    `/api/market/${encodeURIComponent(symbol)}/insight?purpose=${purpose}`,
  );
}

// --- Authentication ----------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
}

export function signup(
  email: string,
  password: string,
): Promise<{ user: AuthUser }> {
  return request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function login(
  email: string,
  password: string,
): Promise<{ user: AuthUser }> {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function logout(): Promise<{ ok: true }> {
  return request("/api/auth/logout", { method: "POST" });
}

export function fetchCurrentUser(): Promise<{ user: AuthUser | null }> {
  return request("/api/auth/me");
}

const pendingAttentionRequests = new Map<string, Promise<AttentionResponse>>();
const recentVisitResponses = new Map<string, { at: number; value: AttentionResponse }>();

// Several components (header, dashboard, attention feed) each mount their own
// useAttention(). A "visit" load advances the server-side baseline, so if each
// mounting component issued its own visit, the second one would compare
// against the baseline the first had just written and show 0.00%. Mount-time
// loads may therefore reuse a visit response that completed this recently.
export const VISIT_REUSE_MS = 10_000;

export interface FetchAttentionOptions {
  // Silent background refresh: prices update, the baseline does NOT advance.
  background?: boolean;
  // Mount-time load: reuse a visit response from the last VISIT_REUSE_MS.
  reuseRecent?: boolean;
}

// "Since your last visit" attention state. Omit watchlistId for every
// watchlist the user owns, or pass one to scope to a single watchlist
// (used by WatchlistDetail).
export function fetchAttention(
  watchlistId?: string,
  options: FetchAttentionOptions = {},
): Promise<AttentionResponse> {
  const params = new URLSearchParams();
  if (watchlistId) params.set("watchlistId", watchlistId);
  if (options.background) params.set("poll", "1");
  const qs = params.toString() ? `?${params.toString()}` : "";
  const key = `${watchlistId ?? "all"}:${options.background ? "poll" : "visit"}`;

  if (options.reuseRecent && !options.background) {
    const recent = recentVisitResponses.get(key);
    if (recent && Date.now() - recent.at < VISIT_REUSE_MS) {
      return Promise.resolve(recent.value);
    }
  }

  const pending = pendingAttentionRequests.get(key);
  if (pending) return pending;

  const next = request<AttentionResponse>(`/api/attention${qs}`);
  pendingAttentionRequests.set(key, next);
  void next.then(
    (value) => {
      if (!options.background) recentVisitResponses.set(key, { at: Date.now(), value });
      if (pendingAttentionRequests.get(key) === next) pendingAttentionRequests.delete(key);
    },
    () => {
      if (pendingAttentionRequests.get(key) === next) pendingAttentionRequests.delete(key);
    },
  );
  return next;
}

// Test hook: forget remembered responses between tests.
export function __resetAttentionClientCache(): void {
  pendingAttentionRequests.clear();
  recentVisitResponses.clear();
}

export function fetchMarketHistory(
  symbol: string,
  range: HistoryRange,
): Promise<{
  bars: HistoricalBar[];
  source: string;
  status: "fresh" | "stale" | "unavailable";
}> {
  return request<{
    bars: Array<Omit<HistoricalBar, "timestamp"> & { timestamp: string }>;
    source: string;
    status: "fresh" | "stale" | "unavailable";
  }>(
    `/api/market/history?symbol=${encodeURIComponent(symbol)}&range=${range}`,
  ).then((result) => ({
    ...result,
    bars: result.bars.map((bar) => ({
      ...bar,
      timestamp: new Date(bar.timestamp),
    })),
  }));
}
