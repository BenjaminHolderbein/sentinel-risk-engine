// Online feature engineering — the exact counterpart of sentinel_ml/features.py
// for a single incoming event. The offline pipeline streams the whole log; here
// we reconstruct the same per-user / per-IP state from rows the feature store
// (Postgres) returns, under the identical causal constraint: only information
// available *before* this event may be used.
//
// Windowing conventions kept identical to Python:
//   * failed_attempts_* and logins_user_1h count PRIOR events only.
//   * distinct_*_24h count prior-in-window values PLUS the current event.
//   * *_is_known compares against everything seen strictly before this event.

import { haversineKm } from "./geo";
import { clip, encodeCategorical, type FeatureSpec } from "./spec";
import type { HistoryRow, RawEvent } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function isOffHours(hour: number, start: number, end: number): number {
  const endMod = end % 24;
  if (start === endMod) return 0;
  const active = start < endMod ? hour >= start && hour < endMod : hour >= start || hour < endMod;
  return active ? 0 : 1;
}

export interface ComputedFeatures {
  vector: number[];
  named: Record<string, number>;
}

/**
 * @param event        the event being scored
 * @param userHistory  this user's prior events (ascending ts, all < event.ts)
 * @param ipFailLast1h  prior failed attempts on this IP within the last hour (any user)
 */
export function computeFeatures(
  spec: FeatureSpec,
  event: RawEvent,
  userHistory: HistoryRow[],
  ipFailLast1h: number,
): ComputedFeatures {
  const now = Date.parse(event.ts);
  const jsDay = new Date(now).getUTCDay(); // Sun=0
  const dow = (jsDay + 6) % 7; // pandas: Mon=0
  const hour = new Date(now).getUTCHours();

  const prior = userHistory.filter((h) => Date.parse(h.ts) < now);
  const last = prior.length ? prior[prior.length - 1] : null;

  const knownDevices = new Set(prior.map((h) => h.device_id));
  const knownIps = new Set(prior.map((h) => h.ip));
  const knownAsns = new Set(prior.map((h) => h.asn));

  const within24h = prior.filter((h) => now - Date.parse(h.ts) <= DAY_MS);
  const failedUser1h = prior.filter(
    (h) => h.outcome === "fail" && now - Date.parse(h.ts) <= HOUR_MS,
  ).length;
  const loginsUser1h = prior.filter((h) => now - Date.parse(h.ts) <= HOUR_MS).length;

  const countries24h = new Set(within24h.map((h) => h.country));
  countries24h.add(event.country);
  const devices24h = new Set(within24h.map((h) => h.device_id));
  devices24h.add(event.device_id);
  const ips24h = new Set(within24h.map((h) => h.ip));
  ips24h.add(event.ip);

  let timeSinceLast: number;
  let velocity: number;
  let countryChanged: number;
  if (!last) {
    timeSinceLast = spec.clip_bounds["time_since_last_login_min"];
    velocity = 0;
    countryChanged = 0;
  } else {
    const dtMin = Math.max(0, (now - Date.parse(last.ts)) / 60000);
    timeSinceLast = dtMin;
    const dist = haversineKm(last.lat, last.lon, event.lat, event.lon);
    const dtH = Math.max(dtMin / 60, 1 / 60); // floor at 1 minute
    velocity = dist / dtH;
    countryChanged = last.country !== event.country ? 1 : 0;
  }

  const distHome = haversineKm(event.home_lat, event.home_lon, event.lat, event.lon);

  const named: Record<string, number> = {
    hour,
    dow,
    is_off_hours: isOffHours(hour, event.active_start, event.active_end),
    account_age_days: event.account_age_days,
    time_since_last_login_min: clip(spec, "time_since_last_login_min", timeSinceLast),
    geo_velocity_kmh: clip(spec, "geo_velocity_kmh", velocity),
    distance_from_home_km: clip(spec, "distance_from_home_km", distHome),
    country_is_home: event.country === event.home_country ? 1 : 0,
    country_changed_from_last: countryChanged,
    device_is_known: knownDevices.has(event.device_id) ? 1 : 0,
    ip_is_known: knownIps.has(event.ip) ? 1 : 0,
    asn_is_known: knownAsns.has(event.asn) ? 1 : 0,
    failed_attempts_user_1h: clip(spec, "failed_attempts_user_1h", failedUser1h),
    failed_attempts_ip_1h: clip(spec, "failed_attempts_ip_1h", ipFailLast1h),
    distinct_countries_24h: clip(spec, "distinct_countries_24h", countries24h.size),
    distinct_devices_24h: clip(spec, "distinct_devices_24h", devices24h.size),
    distinct_ips_24h: clip(spec, "distinct_ips_24h", ips24h.size),
    logins_user_1h: clip(spec, "logins_user_1h", loginsUser1h),
    device_type_code: encodeCategorical(spec, "device_type", event.device_type),
    os_code: encodeCategorical(spec, "os", event.os),
    auth_method_code: encodeCategorical(spec, "auth_method", event.auth_method),
  };

  const vector = spec.feature_order.map((f) => named[f]);
  return { vector, named };
}
