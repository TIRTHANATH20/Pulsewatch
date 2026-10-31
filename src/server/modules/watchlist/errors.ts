// Domain errors for the watchlist module. Kept separate from HTTP concerns
// (status codes) so the service layer stays framework-agnostic and only
// `src/server/lib/api-response.ts` needs to know how these map to HTTP.

export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class DuplicateItemError extends Error {
  constructor(message = "Item already exists") {
    super(message);
    this.name = "DuplicateItemError";
  }
}

export class UnauthorizedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ValidationError extends Error {
  constructor(message = "Invalid request") {
    super(message);
    this.name = "ValidationError";
  }
}
