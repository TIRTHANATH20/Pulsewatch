// Domain errors for the NLP module, mirroring the pattern in
// server/modules/watchlist/errors.ts. Kept HTTP-agnostic; mapped to
// status codes in server/lib/api-response.ts.

export class NlpUnavailableError extends Error {
  constructor(message = "NLP service is currently unavailable") {
    super(message);
    this.name = "NlpUnavailableError";
  }
}

export class NlpDisabledError extends Error {
  constructor(message = "NLP intelligence is disabled on this deployment") {
    super(message);
    this.name = "NlpDisabledError";
  }
}
