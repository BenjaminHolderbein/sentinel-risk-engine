import { BAND_COLOR, BAND_LABEL } from "@/lib/format";

export function BandPill({ band }: { band: string }) {
  const color = BAND_COLOR[band] ?? "#888";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ color, backgroundColor: `${color}1a`, border: `1px solid ${color}55` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {BAND_LABEL[band] ?? band}
    </span>
  );
}

export function ScoreBar({ score }: { score: number }) {
  const pctv = Math.max(2, Math.round(score * 100));
  const color = score >= 0.8 ? "#ef4444" : score >= 0.4 ? "#f97316" : score >= 0.05 ? "#eab308" : "#22c55e";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${pctv}%`, backgroundColor: color }} />
      </div>
      <span className="font-mono text-xs tabular-nums" style={{ color }}>
        {(score * 100).toFixed(1)}
      </span>
    </div>
  );
}
