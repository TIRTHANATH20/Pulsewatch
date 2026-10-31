// Domain errors for the market-data module. These never escape
// `service.ts` as thrown exceptions in normal operation — every one of
// them is caught and converted into a `QuoteOutcome` ("stale" or
// "unavailable") so a provider hiccup degrades gracefully instead of
// bubbling up as a 500. They exist as distinct classes anyway so the
// reason text attached to a degraded `QuoteOutcome` is accurate and
// specific rather than a generic "something went wrong".

export class ProviderRequestError extends Error {
  constructor(message = "Market data provider request failed") {
    super(message);
    this.name = "ProviderRequestError";
  }
}

export class ProviderTimeoutError extends Error {
  constructor(message = "Market data provider request timed out") {
    super(message);
    this.name = "ProviderTimeoutError";
  }
}

export class RateLimitExceededError extends Error {
  constructor(message = "Market data provider rate limit reached") {
    super(message);
    this.name = "RateLimitExceededError";
  }
}
