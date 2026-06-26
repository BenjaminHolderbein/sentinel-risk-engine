"""Causal feature engineering for Sentinel.

For each event we derive model inputs using **only information available before
that event** — the exact constraint the online scorer faces. The reference
implementation here streams through the time-sorted log once, maintaining the
same per-user and per-IP state the TypeScript scorer reconstructs from recent
rows in Postgres.

Feature windowing conventions (kept identical on both sides):

  * ``failed_attempts_*`` and ``logins_user_1h`` count *prior* events only — the
    current attempt's outcome is not known at decision time.
  * ``distinct_*_24h`` count distinct values across prior events in the window
    **plus** the current event (it reflects state as of "now").
  * ``*_is_known`` flags compare against everything seen for the user strictly
    before this event.
"""

from __future__ import annotations

from collections import defaultdict, deque

import numpy as np
import pandas as pd

from .config import CLIP_BOUNDS, FEATURE_ORDER, encode_categorical
from .geo import haversine_km

HOUR = pd.Timedelta(hours=1)
DAY = pd.Timedelta(hours=24)


def _is_off_hours(hour: int, start: int, end: int) -> int:
    end_mod = end % 24
    if start == end_mod:
        return 0
    if start < end_mod:
        active = start <= hour < end_mod
    else:  # window wraps past midnight
        active = hour >= start or hour < end_mod
    return 0 if active else 1


def _clip(name: str, value: float) -> float:
    bound = CLIP_BOUNDS.get(name)
    if bound is None:
        return float(value)
    return float(min(value, bound))


def compute_features(events: pd.DataFrame) -> pd.DataFrame:
    """Return one feature row per event, in time order.

    Output columns: identifiers + ``FEATURE_ORDER`` + ``is_ato`` + a few raw
    fields kept for the dashboard / analysis.
    """
    events = events.sort_values("ts").reset_index(drop=True)

    # per-user state
    last_ts: dict[str, pd.Timestamp] = {}
    last_loc: dict[str, tuple[float, float]] = {}
    last_country: dict[str, str] = {}
    known_devices: dict[str, set[str]] = defaultdict(set)
    known_ips: dict[str, set[str]] = defaultdict(set)
    known_asns: dict[str, set[int]] = defaultdict(set)
    user_recent: dict[str, deque] = defaultdict(deque)  # (ts, country, device, ip, outcome)
    # per-ip state (across users) for stuffing detection
    ip_recent: dict[str, deque] = defaultdict(deque)  # (ts, outcome)

    out_rows: list[dict] = []

    for row in events.itertuples(index=False):
        uid = row.user_id
        ts = row.ts
        hour = int(ts.hour)
        dow = int(ts.dayofweek)

        # ---- evict stale state from sliding windows ----
        urec = user_recent[uid]
        while urec and (ts - urec[0][0]) > DAY:
            urec.popleft()
        irec = ip_recent[row.ip]
        while irec and (ts - irec[0][0]) > HOUR:
            irec.popleft()

        # ---- history-based features (prior events only) ----
        prev_ts = last_ts.get(uid)
        if prev_ts is None:
            tsl = CLIP_BOUNDS["time_since_last_login_min"]
            velocity = 0.0
            country_changed = 0
        else:
            dt_min = max(0.0, (ts - prev_ts).total_seconds() / 60.0)
            tsl = dt_min
            plat, plon = last_loc[uid]
            dist = haversine_km(plat, plon, float(row.lat), float(row.lon))
            dt_h = max(dt_min / 60.0, 1.0 / 60.0)  # floor at 1 minute to bound velocity
            velocity = dist / dt_h
            country_changed = int(last_country[uid] != row.country)

        failed_user_1h = sum(
            1 for (t, _c, _d, _i, o) in urec if o == "fail" and (ts - t) <= HOUR
        )
        logins_user_1h = sum(1 for (t, *_rest) in urec if (ts - t) <= HOUR)
        failed_ip_1h = sum(1 for (t, o) in irec if o == "fail")

        # distinct over prior-in-window + current
        countries_24h = {c for (_t, c, _d, _i, _o) in urec} | {row.country}
        devices_24h = {d for (_t, _c, d, _i, _o) in urec} | {row.device_id}
        ips_24h = {i for (_t, _c, _d, i, _o) in urec} | {row.ip}

        dist_home = haversine_km(
            float(row.home_lat), float(row.home_lon), float(row.lat), float(row.lon)
        )

        feat = {
            "hour": hour,
            "dow": dow,
            "is_off_hours": _is_off_hours(hour, int(row.active_start), int(row.active_end)),
            "account_age_days": float(row.account_age_days),
            "time_since_last_login_min": _clip("time_since_last_login_min", tsl),
            "geo_velocity_kmh": _clip("geo_velocity_kmh", velocity),
            "distance_from_home_km": _clip("distance_from_home_km", dist_home),
            "country_is_home": int(row.country == row.home_country),
            "country_changed_from_last": country_changed,
            "device_is_known": int(row.device_id in known_devices[uid]),
            "ip_is_known": int(row.ip in known_ips[uid]),
            "asn_is_known": int(int(row.asn) in known_asns[uid]),
            "failed_attempts_user_1h": _clip("failed_attempts_user_1h", failed_user_1h),
            "failed_attempts_ip_1h": _clip("failed_attempts_ip_1h", failed_ip_1h),
            "distinct_countries_24h": _clip("distinct_countries_24h", len(countries_24h)),
            "distinct_devices_24h": _clip("distinct_devices_24h", len(devices_24h)),
            "distinct_ips_24h": _clip("distinct_ips_24h", len(ips_24h)),
            "logins_user_1h": _clip("logins_user_1h", logins_user_1h),
            "device_type_code": encode_categorical("device_type", row.device_type),
            "os_code": encode_categorical("os", row.os),
            "auth_method_code": encode_categorical("auth_method", row.auth_method),
        }

        out_rows.append(
            {
                "event_id": row.event_id,
                "user_id": uid,
                "ts": ts,
                "country": row.country,
                "outcome": row.outcome,
                "attack_type": row.attack_type,
                "is_ato": int(row.is_ato),
                **feat,
            }
        )

        # ---- commit current event to state (now it's "known") ----
        known_devices[uid].add(row.device_id)
        known_ips[uid].add(row.ip)
        known_asns[uid].add(int(row.asn))
        urec.append((ts, row.country, row.device_id, row.ip, row.outcome))
        irec.append((ts, row.outcome))
        last_ts[uid] = ts
        last_loc[uid] = (float(row.lat), float(row.lon))
        last_country[uid] = row.country

    df = pd.DataFrame(out_rows)
    # guarantee column presence + order for the model matrix
    for col in FEATURE_ORDER:
        assert col in df.columns, f"missing feature column {col}"
    return df


def feature_matrix(features: pd.DataFrame) -> np.ndarray:
    """Extract the ordered float32 model-input matrix."""
    return features[FEATURE_ORDER].to_numpy(dtype=np.float32)


if __name__ == "__main__":
    from .config import DATA_PATH, FEATURES_PATH

    ev = pd.read_parquet(DATA_PATH)
    feats = compute_features(ev)
    feats.to_parquet(FEATURES_PATH)
    print(f"Computed features for {len(feats):,} events -> {FEATURES_PATH}")
    print(feats[FEATURE_ORDER].describe().T.to_string())
