import numpy as np
import pandas as pd

from sentinel_ml.config import CLIP_BOUNDS, FEATURE_ORDER
from sentinel_ml.features import compute_features, feature_matrix
from sentinel_ml.geo import haversine_km

SF = (37.7749, -122.4194)
LONDON = (51.5074, -0.1278)


def _event(eid, uid, ts, lat, lon, country, device, asn, ip, outcome="success",
           home=SF, home_country="US"):
    return {
        "event_id": eid, "user_id": uid, "ts": pd.Timestamp(ts, tz="UTC"),
        "country": country, "lat": lat, "lon": lon, "asn": asn, "ip": ip,
        "device_id": device, "device_type": "mobile", "os": "ios",
        "auth_method": "password", "outcome": outcome,
        "home_country": home_country, "home_lat": home[0], "home_lon": home[1],
        "account_age_days": 400, "active_start": 8, "active_end": 18,
        "is_ato": 0, "attack_type": "none",
    }


def _frame(rows):
    return pd.DataFrame(rows)


def test_cold_start_defaults():
    df = _frame([_event("e0", "u1", "2025-05-01T10:00:00", *SF, "US", "d1", 100, "A")])
    f = compute_features(df).iloc[0]
    assert f["time_since_last_login_min"] == CLIP_BOUNDS["time_since_last_login_min"]
    assert f["geo_velocity_kmh"] == 0
    assert f["device_is_known"] == 0
    assert f["ip_is_known"] == 0
    assert f["country_changed_from_last"] == 0


def test_known_device_and_recency():
    df = _frame([
        _event("e0", "u1", "2025-05-01T10:00:00", *SF, "US", "d1", 100, "A"),
        _event("e1", "u1", "2025-05-01T10:10:00", *SF, "US", "d1", 100, "A"),
    ])
    f = compute_features(df).iloc[1]
    assert f["device_is_known"] == 1
    assert f["ip_is_known"] == 1
    assert f["asn_is_known"] == 1
    assert abs(f["time_since_last_login_min"] - 10) < 1e-6
    assert f["geo_velocity_kmh"] < 1  # same location


def test_impossible_travel_signal():
    df = _frame([
        _event("e0", "u1", "2025-05-01T10:00:00", *SF, "US", "d1", 100, "A"),
        _event("e1", "u1", "2025-05-01T10:30:00", *LONDON, "GB", "d2", 999, "B"),
    ])
    f = compute_features(df).iloc[1]
    assert f["device_is_known"] == 0
    assert f["country_changed_from_last"] == 1
    assert f["country_is_home"] == 0
    # SF->London in 30 min implies thousands of km/h
    assert f["geo_velocity_kmh"] > 900
    expected = haversine_km(*SF, *LONDON)
    assert abs(f["distance_from_home_km"] - expected) < 1.0


def test_failed_attempts_window():
    rows = [
        _event(f"f{i}", "u1", f"2025-05-01T10:0{i}:00", *SF, "US", "d1", 100, "A", outcome="fail")
        for i in range(5)
    ]
    rows.append(_event("ok", "u1", "2025-05-01T10:06:00", *SF, "US", "d1", 100, "A"))
    f = compute_features(_frame(rows)).iloc[-1]
    assert f["failed_attempts_user_1h"] == 5
    assert f["logins_user_1h"] == 5  # prior attempts in the last hour


def test_off_hours():
    night = compute_features(
        _frame([_event("e", "u1", "2025-05-01T03:00:00", *SF, "US", "d1", 100, "A")])
    ).iloc[0]
    day = compute_features(
        _frame([_event("e", "u1", "2025-05-01T12:00:00", *SF, "US", "d1", 100, "A")])
    ).iloc[0]
    assert night["is_off_hours"] == 1
    assert day["is_off_hours"] == 0


def test_matrix_shape_and_dtype():
    df = _frame([_event("e0", "u1", "2025-05-01T10:00:00", *SF, "US", "d1", 100, "A")])
    X = feature_matrix(compute_features(df))
    assert X.shape == (1, len(FEATURE_ORDER))
    assert X.dtype == np.float32
