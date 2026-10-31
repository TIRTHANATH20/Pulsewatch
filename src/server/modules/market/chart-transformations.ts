import type { HistoricalBar } from "./types";

export interface DerivedBar extends HistoricalBar { direction: "up" | "down" | "flat" }

export function toHeikinAshi(bars: HistoricalBar[]): DerivedBar[] {
  let previousOpen = 0;
  let previousClose = 0;
  return bars.map((bar, index) => {
    const close = (bar.open + bar.high + bar.low + bar.close) / 4;
    const open = index === 0 ? (bar.open + bar.close) / 2 : (previousOpen + previousClose) / 2;
    const result: DerivedBar = { timestamp: bar.timestamp, open, high: Math.max(bar.high, open, close), low: Math.min(bar.low, open, close), close, volume: bar.volume, direction: close > open ? "up" : close < open ? "down" : "flat" };
    previousOpen = open; previousClose = close;
    return result;
  });
}

export function toRenko(bars: HistoricalBar[], brickSize?: number): { bars: DerivedBar[]; brickSize: number } {
  if (!bars.length) return { bars: [], brickSize: brickSize ?? 1 };
  const first = bars[0]!;
  const size = brickSize ?? Math.max(first.close * 0.01, 0.01);
  const result: DerivedBar[] = [];
  let anchor = first.close;
  for (const bar of bars) {
    while (bar.close - anchor >= size) { const open = anchor; anchor += size; result.push({ timestamp: bar.timestamp, open, high: anchor, low: open, close: anchor, volume: bar.volume, direction: "up" }); }
    while (anchor - bar.close >= size) { const open = anchor; anchor -= size; result.push({ timestamp: bar.timestamp, open, high: open, low: anchor, close: anchor, volume: bar.volume, direction: "down" }); }
  }
  return { bars: result, brickSize: size };
}
