import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 60), 200);
  const flaggedOnly = url.searchParams.get("flagged") === "1";

  const where = flaggedOnly
    ? and(eq(events.source, "stream"), eq(events.flagged, true))
    : eq(events.source, "stream");

  const rows = await db
    .select({
      id: events.id,
      eventId: events.eventId,
      userId: events.userId,
      ts: events.ts,
      country: events.country,
      ip: events.ip,
      deviceType: events.deviceType,
      authMethod: events.authMethod,
      outcome: events.outcome,
      riskScore: events.riskScore,
      band: events.band,
      flagged: events.flagged,
      latencyMs: events.latencyMs,
      reasons: events.reasons,
      isAto: events.isAto,
      attackType: events.attackType,
      label: events.label,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(where)
    .orderBy(desc(events.id))
    .limit(limit);

  return NextResponse.json({ events: rows });
}
