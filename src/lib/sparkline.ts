// A sparkline is only worth drawing when there is real history to draw:
// at least two finite points that are not all identical. A run of identical
// samples (e.g. repeated fetches of the same last-trade price on a closed
// market) is not a chart - it renders as a blank horizontal rule.
export function isSparklineDrawable(data: readonly number[] | null | undefined): data is number[] {
  if (!data || data.length < 2) return false;
  if (!data.every((v) => Number.isFinite(v))) return false;
  const first = data[0] as number;
  return data.some((v) => v !== first);
}
