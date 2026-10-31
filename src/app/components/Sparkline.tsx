// Compact sparkline drawn directly from real PriceObservation history
// (see AttentionItemDTO.sparkline, sourced by
// server/modules/market/service.ts's getRecentPriceHistory). No hardcoded
// path data — the polyline points are computed from whatever history
// array is passed in. With no drawable history (fewer than two points, or
// all identical) it renders nothing rather than a fake or flat line.
import { isSparklineDrawable } from "@/lib/sparkline";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  direction?: "up" | "down" | "flat" | null;
}

export default function Sparkline({
  data,
  width = 88,
  height = 28,
  direction,
}: SparklineProps) {
  // Nothing real to draw (too few points, or all identical) -> render nothing,
  // never a flat rule. Callers decide whether to show an "unavailable" label.
  if (!isSparklineDrawable(data)) {
    return null;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const points = data
    .map((value, i) => {
      const x = i * stepX;
      const y = height - ((value - min) / range) * (height - 4) - 2;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const strokeClass =
    direction === "up"
      ? "sparkline-up"
      : direction === "down"
        ? "sparkline-down"
        : "sparkline-flat";

  return (
    <svg
      className={`sparkline ${strokeClass}`}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
