import fs from "node:fs";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { events, type NewEventRow } from "@/lib/db/schema";
import type { RawEvent } from "@/lib/scoring/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Loads the offline-generated warm history so accounts have an established
// baseline before the live stream starts. Idempotent: no-ops if already seeded.
export async function POST() {
  const [existing] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(eq(events.source, "seed"));
  if ((existing?.n ?? 0) > 0) {
    return NextResponse.json({ ok: true, seeded: existing.n, skipped: true });
  }

  const file = path.join(process.cwd(), "data", "demo_seed.json");
  if (!fs.existsSync(file)) {
    return NextResponse.json({ error: "seed file missing" }, { status: 500 });
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as RawEvent[];

  const rows: NewEventRow[] = raw.map((e) => ({
    eventId: e.event_id,
    userId: e.user_id,
    ts: new Date(e.ts),
    country: e.country,
    lat: e.lat,
    lon: e.lon,
    asn: e.asn,
    ip: e.ip,
    deviceId: e.device_id,
    deviceType: e.device_type,
    os: e.os,
    authMethod: e.auth_method,
    outcome: e.outcome,
    homeCountry: e.home_country,
    homeLat: e.home_lat,
    homeLon: e.home_lon,
    accountAgeDays: e.account_age_days,
    activeStart: e.active_start,
    activeEnd: e.active_end,
    source: "seed",
  }));

  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.insert(events).values(rows.slice(i, i + BATCH));
  }

  return NextResponse.json({ ok: true, seeded: rows.length });
}
