"""Single source of truth for the Sentinel feature contract.

The online scorer (TypeScript, running on Vercel) and this offline training
package must agree exactly on:

  * the ordered list of model input features,
  * how categorical values are encoded to integers,
  * the defaults used when a signal is missing.

To keep the two implementations in lockstep we serialise this contract to
``artifacts/feature_spec.json`` at export time. The TS side loads that JSON and
builds its input tensor from it, so there is exactly one place (here) where the
feature order or a vocabulary can change.
"""

from __future__ import annotations

from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PKG_DIR = Path(__file__).resolve().parent
ML_DIR = PKG_DIR.parent
ARTIFACTS_DIR = ML_DIR / "artifacts"
DATA_PATH = ARTIFACTS_DIR / "events.parquet"
FEATURES_PATH = ARTIFACTS_DIR / "features.parquet"
ONNX_PATH = ARTIFACTS_DIR / "model.onnx"
FEATURE_SPEC_PATH = ARTIFACTS_DIR / "feature_spec.json"
METRICS_PATH = ARTIFACTS_DIR / "metrics.json"
PLOTS_DIR = ARTIFACTS_DIR / "plots"

RANDOM_SEED = 42

# ---------------------------------------------------------------------------
# Categorical vocabularies (ordinal encoding).
#
# Index 0 is reserved for "unknown / unseen" so the online scorer can encode a
# value it has never seen without falling outside the trained range.
# ---------------------------------------------------------------------------
DEVICE_TYPES = ["mobile", "desktop", "tablet"]
OPERATING_SYSTEMS = ["ios", "android", "windows", "macos", "linux"]
AUTH_METHODS = ["password", "oauth", "mfa"]

CATEGORICAL_VOCABS: dict[str, list[str]] = {
    "device_type": DEVICE_TYPES,
    "os": OPERATING_SYSTEMS,
    "auth_method": AUTH_METHODS,
}


def encode_categorical(field: str, value: str) -> int:
    """Map a categorical value to its integer code (0 == unknown)."""
    vocab = CATEGORICAL_VOCABS[field]
    try:
        return vocab.index(value) + 1
    except ValueError:
        return 0


# ---------------------------------------------------------------------------
# Ordered model feature list.
#
# This ordering IS the model input tensor. Never reorder without re-exporting
# the ONNX model and feature_spec.json together.
# ---------------------------------------------------------------------------
NUMERIC_FEATURES = [
    "hour",
    "dow",
    "is_off_hours",
    "account_age_days",
    "time_since_last_login_min",
    "geo_velocity_kmh",
    "distance_from_home_km",
    "country_is_home",
    "country_changed_from_last",
    "device_is_known",
    "ip_is_known",
    "asn_is_known",
    "failed_attempts_user_1h",
    "failed_attempts_ip_1h",
    "distinct_countries_24h",
    "distinct_devices_24h",
    "distinct_ips_24h",
    "logins_user_1h",
]

CATEGORICAL_FEATURES = ["device_type_code", "os_code", "auth_method_code"]

FEATURE_ORDER = NUMERIC_FEATURES + CATEGORICAL_FEATURES

# Clip bounds keep generated/online features in the same numeric range so a
# single extreme event can't dominate the model's input distribution.
CLIP_BOUNDS: dict[str, float] = {
    "time_since_last_login_min": 60 * 24 * 30,  # 30 days
    "geo_velocity_kmh": 5000.0,                  # faster than any aircraft
    "distance_from_home_km": 20000.0,
    "failed_attempts_user_1h": 50,
    "failed_attempts_ip_1h": 500,
    "distinct_countries_24h": 20,
    "distinct_devices_24h": 20,
    "distinct_ips_24h": 50,
    "logins_user_1h": 50,
}

# Decision-threshold policy. Security teams operate under an "alert budget":
# the SOC can only review so many flagged events per day. We pick the operating
# threshold that maximises recall subject to a maximum acceptable false-positive
# rate, rather than the naive 0.5 cutoff.
MAX_FALSE_POSITIVE_RATE = 0.02
