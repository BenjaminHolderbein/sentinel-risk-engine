// Reason codes: a transparent, rule-based explanation layer that sits alongside
// the model score. Production fraud systems always pair a score with reason
// codes so an analyst can action an alert; these are derived from the same
// feature values the model consumes, so they explain *why* an event looks risky
// without claiming to be the model's exact attribution.

import type { ReasonCode } from "./types";

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export function reasonCodes(f: Record<string, number>): ReasonCode[] {
  const out: ReasonCode[] = [];
  const push = (
    code: string,
    label: string,
    severity: ReasonCode["severity"],
    detail: string,
  ) => out.push({ code, label, severity, detail });

  if (f.geo_velocity_kmh > 900) {
    push(
      "impossible_travel",
      "Impossible travel",
      "high",
      `Implied travel speed ${Math.round(f.geo_velocity_kmh).toLocaleString()} km/h since last login`,
    );
  }
  if (f.failed_attempts_ip_1h >= 10) {
    push(
      "stuffing",
      "Credential stuffing",
      "high",
      `${f.failed_attempts_ip_1h} failed logins from this IP in the last hour`,
    );
  }
  if (f.failed_attempts_user_1h >= 4) {
    push(
      "brute_force",
      "Repeated failures",
      "medium",
      `${f.failed_attempts_user_1h} failed attempts on this account in the last hour`,
    );
  }
  if (!f.country_is_home && f.country_changed_from_last) {
    push("new_country", "New country", "medium", "Login from a country not seen for this account");
  }
  if (!f.device_is_known) {
    push("new_device", "Unrecognised device", "medium", "Device fingerprint never seen for this account");
  }
  if (f.distinct_countries_24h >= 3) {
    push(
      "country_spread",
      "Multiple countries",
      "medium",
      `${f.distinct_countries_24h} distinct countries in the last 24h`,
    );
  }
  if (!f.asn_is_known) {
    push("new_network", "New network", "low", "First login from this network/ASN");
  }
  if (f.is_off_hours) {
    push("off_hours", "Off-hours", "low", "Login outside the account's usual active window");
  }
  if (f.distance_from_home_km > 3000) {
    push(
      "far_from_home",
      "Far from home",
      "low",
      `${Math.round(f.distance_from_home_km).toLocaleString()} km from the account's home location`,
    );
  }

  return out
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, 5);
}
