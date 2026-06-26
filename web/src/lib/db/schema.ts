import {
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type { ReasonCode } from "@/lib/scoring/types";

/**
 * Single append-only table that doubles as the online feature store and the
 * alert feed. Raw signals (country/ip/device/asn/outcome/ts) are read back to
 * reconstruct per-user and per-IP features at scoring time; the scoring outputs
 * and analyst labels live on the same row.
 */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    eventId: text("event_id").notNull(),
    userId: text("user_id").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),

    // raw signals
    country: text("country").notNull(),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    asn: integer("asn").notNull(),
    ip: text("ip").notNull(),
    deviceId: text("device_id").notNull(),
    deviceType: text("device_type").notNull(),
    os: text("os").notNull(),
    authMethod: text("auth_method").notNull(),
    outcome: text("outcome").notNull(),

    // account context
    homeCountry: text("home_country").notNull(),
    homeLat: doublePrecision("home_lat").notNull(),
    homeLon: doublePrecision("home_lon").notNull(),
    accountAgeDays: integer("account_age_days").notNull(),
    activeStart: integer("active_start").notNull(),
    activeEnd: integer("active_end").notNull(),

    // 'seed' = warm history, 'stream' = scored live event
    source: text("source").notNull().default("stream"),

    // scoring outputs (null for seed rows)
    riskScore: doublePrecision("risk_score"),
    rawScore: doublePrecision("raw_score"),
    band: text("band"),
    flagged: boolean("flagged"),
    threshold: doublePrecision("threshold"),
    latencyMs: doublePrecision("latency_ms"),
    reasons: jsonb("reasons").$type<ReasonCode[]>(),
    features: jsonb("features").$type<Record<string, number>>(),

    // ground truth (simulation only) + analyst feedback
    isAto: integer("is_ato"),
    attackType: text("attack_type"),
    label: text("label"), // 'confirmed_ato' | 'false_positive' | null
    labeledAt: timestamp("labeled_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_events_user_ts").on(t.userId, t.ts),
    index("idx_events_ip_ts").on(t.ip, t.ts),
    index("idx_events_created").on(t.createdAt),
    index("idx_events_source").on(t.source),
  ],
);

export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
