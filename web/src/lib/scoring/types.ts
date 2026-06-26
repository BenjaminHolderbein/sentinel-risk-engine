// Shared types for the online scoring path.

/** Raw authentication event as an auth gateway would log it. */
export interface RawEvent {
  event_id: string;
  user_id: string;
  ts: string; // ISO-8601
  country: string;
  lat: number;
  lon: number;
  asn: number;
  ip: string;
  device_id: string;
  device_type: string;
  os: string;
  auth_method: string;
  outcome: "success" | "fail";
  home_country: string;
  home_lat: number;
  home_lon: number;
  account_age_days: number;
  active_start: number;
  active_end: number;
  // ground-truth labels are present in the simulated stream, used only for display
  is_ato?: number;
  attack_type?: string;
}

/** A prior event for the same user (or IP), pulled from the feature store. */
export interface HistoryRow {
  ts: string;
  country: string;
  lat: number;
  lon: number;
  asn: number;
  ip: string;
  device_id: string;
  outcome: string;
}

export interface ReasonCode {
  code: string;
  label: string;
  severity: "high" | "medium" | "low";
  detail: string;
}

export interface ScoreResult {
  riskScore: number; // calibrated probability in [0,1]
  rawScore: number; // model output before calibration
  band: "critical" | "high" | "medium" | "low";
  flagged: boolean;
  threshold: number;
  reasons: ReasonCode[];
  features: Record<string, number>;
  latencyMs: number;
}

/** Shape returned by POST /api/score and rendered in the live feed. */
export interface FeedItem extends ScoreResult {
  id: number | null;
  event: RawEvent;
  label?: "confirmed_ato" | "false_positive" | null;
}

/** Shape returned by GET /api/stats. */
export interface Stats {
  total: number;
  flagged: number;
  flagRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  eventsPerMin: number;
  bands: Record<string, number>;
  live: {
    tp: number;
    fp: number;
    fn: number;
    tn: number;
    precision: number | null;
    recall: number | null;
  };
}
