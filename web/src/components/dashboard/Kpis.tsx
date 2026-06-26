import { Card } from "@/components/ui/card";
import { ms, num, pct } from "@/lib/format";
import type { Stats } from "@/lib/scoring/types";

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="gap-1 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function Kpis({ stats }: { stats: Stats | null }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi label="Events scored" value={num(stats?.total ?? 0)} hint="this session" />
      <Kpi label="Flag rate" value={pct(stats?.flagRate)} hint={`${num(stats?.flagged ?? 0)} flagged`} />
      <Kpi label="p95 latency" value={ms(stats?.p95LatencyMs)} hint={`avg ${ms(stats?.avgLatencyMs)}`} />
      <Kpi label="Throughput" value={`${num(stats?.eventsPerMin ?? 0)}/min`} hint="last 60s" />
      <Kpi
        label="Live precision"
        value={pct(stats?.live.precision)}
        hint="flagged that were real ATO"
      />
      <Kpi label="Live recall" value={pct(stats?.live.recall)} hint="ATO caught vs ground truth" />
    </div>
  );
}
