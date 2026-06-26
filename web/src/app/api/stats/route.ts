import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const streamed = eq(events.source, "stream");

  const [agg] = await db
    .select({
      total: sql<number>`count(*)::int`,
      flagged: sql<number>`count(*) filter (where ${events.flagged})::int`,
      avgLatency: sql<number>`coalesce(avg(${events.latencyMs}), 0)`,
      p95Latency: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${events.latencyMs}), 0)`,
      lastMinute: sql<number>`count(*) filter (where ${events.createdAt} > now() - interval '60 seconds')::int`,
      // live confusion against simulated ground truth
      tp: sql<number>`count(*) filter (where ${events.flagged} and ${events.isAto} = 1)::int`,
      fp: sql<number>`count(*) filter (where ${events.flagged} and ${events.isAto} = 0)::int`,
      fn: sql<number>`count(*) filter (where not ${events.flagged} and ${events.isAto} = 1)::int`,
      tn: sql<number>`count(*) filter (where not ${events.flagged} and ${events.isAto} = 0)::int`,
    })
    .from(events)
    .where(streamed);

  const bands = await db
    .select({ band: events.band, n: sql<number>`count(*)::int` })
    .from(events)
    .where(streamed)
    .groupBy(events.band);

  const tp = agg?.tp ?? 0;
  const fp = agg?.fp ?? 0;
  const fn = agg?.fn ?? 0;
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;

  return NextResponse.json({
    total: agg?.total ?? 0,
    flagged: agg?.flagged ?? 0,
    flagRate: agg?.total ? (agg.flagged ?? 0) / agg.total : 0,
    avgLatencyMs: agg?.avgLatency ?? 0,
    p95LatencyMs: agg?.p95Latency ?? 0,
    eventsPerMin: agg?.lastMinute ?? 0,
    bands: Object.fromEntries(bands.map((b) => [b.band ?? "unknown", b.n])),
    live: { tp, fp, fn, tn: agg?.tn ?? 0, precision, recall },
  });
}
