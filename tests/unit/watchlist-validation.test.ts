import { describe, expect, it } from "vitest";
import {
  createWatchlistSchema,
  addSymbolSchema,
} from "@/server/modules/watchlist/validation";

describe("createWatchlistSchema", () => {
  it("accepts a normal name", () => {
    const result = createWatchlistSchema.parse({ name: "Tech" });
    expect(result.name).toBe("Tech");
  });

  it("trims surrounding whitespace", () => {
    const result = createWatchlistSchema.parse({ name: "  Tech  " });
    expect(result.name).toBe("Tech");
  });

  it("rejects an empty name", () => {
    expect(() => createWatchlistSchema.parse({ name: "" })).toThrow();
  });

  it("rejects a whitespace-only name", () => {
    expect(() => createWatchlistSchema.parse({ name: "   " })).toThrow();
  });

  it("rejects a name over 80 characters", () => {
    expect(() =>
      createWatchlistSchema.parse({ name: "a".repeat(81) }),
    ).toThrow();
  });

  it("ignores unexpected extra fields rather than persisting them", () => {
    const result = createWatchlistSchema.parse({
      name: "Tech",
      userId: "someone-elses-id",
    } as unknown as { name: string });
    expect(result).toEqual({ name: "Tech" });
    expect((result as Record<string, unknown>).userId).toBeUndefined();
  });
});

describe("addSymbolSchema", () => {
  it("accepts common symbol formats", () => {
    expect(addSymbolSchema.parse({ symbol: "AAPL" }).symbol).toBe("AAPL");
    expect(addSymbolSchema.parse({ symbol: "BRK.B" }).symbol).toBe("BRK.B");
    expect(addSymbolSchema.parse({ symbol: "RELIANCE-EQ" }).symbol).toBe(
      "RELIANCE-EQ",
    );
  });

  it("rejects an empty or whitespace-only symbol", () => {
    expect(() => addSymbolSchema.parse({ symbol: "" })).toThrow();
    expect(() => addSymbolSchema.parse({ symbol: "   " })).toThrow();
  });

  it("rejects a symbol over 20 characters", () => {
    expect(() => addSymbolSchema.parse({ symbol: "A".repeat(21) })).toThrow();
  });

  it("rejects symbols with disallowed characters", () => {
    expect(() => addSymbolSchema.parse({ symbol: "AAPL; DROP TABLE" })).toThrow();
    expect(() => addSymbolSchema.parse({ symbol: "<script>" })).toThrow();
  });
});
