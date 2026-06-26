
from sentinel_ml.generate import GenConfig, generate


def small():
    return generate(GenConfig(n_users=120, days=6, seed=1, n_stuffing_campaigns=3,
                              n_impossible_travel=15, n_device_takeover=15))


def test_schema_and_sorting():
    df = small()
    required = {
        "event_id", "user_id", "ts", "country", "lat", "lon", "asn", "ip",
        "device_id", "device_type", "os", "auth_method", "outcome", "is_ato", "attack_type",
    }
    assert required.issubset(df.columns)
    assert df["ts"].is_monotonic_increasing  # time-ordered
    assert df["event_id"].is_unique


def test_realistic_imbalance():
    df = small()
    rate = df["is_ato"].mean()
    # imbalanced but present — never trivially all/none
    assert 0.005 < rate < 0.25


def test_attack_types_present():
    df = small()
    types = set(df.loc[df["is_ato"] == 1, "attack_type"].unique())
    assert {"credential_stuffing", "impossible_travel", "new_device_takeover"} <= types
    assert (df.loc[df["is_ato"] == 0, "attack_type"] == "none").all()


def test_overlap_exists():
    """Benign traffic must include risky-looking events (new device / abroad),
    otherwise the problem is trivially separable."""
    df = small()
    benign = df[df["is_ato"] == 0]
    abroad = benign["country"] != benign["home_country"]
    assert abroad.sum() > 0


def test_deterministic():
    a, b = small(), small()
    assert (a["event_id"].values == b["event_id"].values).all()
    assert (a["is_ato"].values == b["is_ato"].values).all()
