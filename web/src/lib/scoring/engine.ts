// Online scoring orchestrator. Given a raw event it:
//   1. reads the account's recent history + the IP's recent failures from the
//      feature store (Postgres) — the "online features from contextual signals",
//   2. computes the feature vector (features.ts, parity-matched to Python),
//   3. runs the ONNX model and calibrates the score,
//   4. derives reason codes, and
//   5. appends the scored event back to the store (which becomes history for the
//      next event — the live feedback the system learns from).

import { and, eq, gte, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { events, type NewEventRow } from "@/lib/db/schema";
import { computeFeatures } from "./features";
import { riskBand, runModel } from "./model";
import { reasonCodes } from "./reasons";
import { loadSpec } from "./spec";
import type { HistoryRow, RawEvent, ScoreResult } from "./types";

const HISTORY_WINDOW_DAYS = 30;

async function fetchUserHistory(userId: string, before: Date): Promise<HistoryRow[]> {
  const since = new Date(before.getTime() - HISTORY_WINDOW_DAYS * 24 * 3600 * 1000);
  const rows = await db
    .select({
      ts: events.ts,
      country: events.country,
      lat: events.lat,
      lon: events.lon,
      asn: events.asn,
      ip: events.ip,
      device_id: events.deviceId,
      outcome: events.outcome,
    })
    .from(events)
    .where(and(eq(events.userId, userId), lt(events.ts, before), gte(events.ts, since)))
    .orderBy(events.ts)
    .limit(1000);
  return rows.map((r) => ({ ...r, ts: r.ts.toISOString() }));
}

async function fetchIpFailLast1h(ip: string, before: Date): Promise<number> {
  const since = new Date(before.getTime() - 3600 * 1000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(
      and(
        eq(events.ip, ip),
        eq(events.outcome, "fail"),
        lt(events.ts, before),
        gte(events.ts, since),
      ),
    );
  return row?.n ?? 0;
}

export interface ScoredEvent extends ScoreResult {
  id: number | null;
  event: RawEvent;
}

export async function scoreEvent(event: RawEvent, persist = true): Promise<ScoredEvent> {
  const t0 = performance.now();
  const spec = loadSpec();
  const ts = new Date(event.ts);

  const [history, ipFails] = await Promise.all([
    fetchUserHistory(event.user_id, ts),
    fetchIpFailLast1h(event.ip, ts),
  ]);

  const { vector, named } = computeFeatures(spec, event, history, ipFails);
  const { raw, calibrated } = await runModel(vector);
  const band = riskBand(calibrated, spec.threshold);
  const flagged = calibrated >= spec.threshold;
  const reasons = reasonCodes(named);
  const latencyMs = performance.now() - t0;

  const result: ScoreResult = {
    riskScore: calibrated,
    rawScore: raw,
    band,
    flagged,
    threshold: spec.threshold,
    reasons,
    features: named,
    latencyMs,
  };

  let insertedId: number | null = null;
  if (persist) {
    const row: NewEventRow = {
      eventId: event.event_id,
      userId: event.user_id,
      ts,
      country: event.country,
      lat: event.lat,
      lon: event.lon,
      asn: event.asn,
      ip: event.ip,
      deviceId: event.device_id,
      deviceType: event.device_type,
      os: event.os,
      authMethod: event.auth_method,
      outcome: event.outcome,
      homeCountry: event.home_country,
      homeLat: event.home_lat,
      homeLon: event.home_lon,
      accountAgeDays: event.account_age_days,
      activeStart: event.active_start,
      activeEnd: event.active_end,
      source: "stream",
      riskScore: calibrated,
      rawScore: raw,
      band,
      flagged,
      threshold: spec.threshold,
      latencyMs,
      reasons,
      features: named,
      isAto: event.is_ato ?? null,
      attackType: event.attack_type ?? null,
    };
    const [inserted] = await db.insert(events).values(row).returning({ id: events.id });
    insertedId = inserted?.id ?? null;
  }

  return { ...result, id: insertedId, event };
}
