export function pct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

export function num(x: number | null | undefined): string {
  if (x === null || x === undefined) return "—";
  return x.toLocaleString();
}

export function ms(x: number | null | undefined): string {
  if (x === null || x === undefined) return "—";
  return `${x.toFixed(1)} ms`;
}

export const BAND_COLOR: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
};

export const BAND_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function timeAgo(iso: string): string {
  const d = Date.now() - Date.parse(iso);
  if (d < 1000) return "now";
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  return `${Math.floor(d / 3_600_000)}h ago`;
}
