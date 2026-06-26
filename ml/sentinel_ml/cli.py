"""Command-line entry point for the Sentinel offline pipeline.

    uv run sentinel generate     # synthesize the labelled event log
    uv run sentinel features     # derive causal features
    uv run sentinel train        # train + calibrate + select model
    uv run sentinel export       # ONNX export + feature_spec.json + parity
    uv run sentinel all          # the full pipeline, then sync to the web app
"""

from __future__ import annotations

import shutil
import sys

from . import config


def _generate() -> None:

    from .generate import generate

    config.ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    df = generate()
    df.to_parquet(config.DATA_PATH)
    print(f"events: {len(df):,}  ATO prevalence: {df['is_ato'].mean():.3%}")


def _features() -> None:
    import pandas as pd

    from .features import compute_features

    ev = pd.read_parquet(config.DATA_PATH)
    feats = compute_features(ev)
    feats.to_parquet(config.FEATURES_PATH)
    print(f"features: {len(feats):,} rows x {len(config.FEATURE_ORDER)} cols")


def _train() -> None:
    from .train import train_all

    train_all()


def _export() -> None:
    from .export_onnx import export

    export()


def _demo() -> None:
    """Export a small, self-contained demo dataset for the live dashboard.

    Generated independently of the training data (different seed / population) so
    the deployed demo never replays events the model trained on. Split in time
    into *seed* history (used to warm the database so accounts have a baseline)
    and a *stream* that the simulator replays through the real scoring path.
    """
    import json

    from .generate import GenConfig, generate

    web_data = config.ML_DIR.parent / "web" / "data"
    web_public = config.ML_DIR.parent / "web" / "public" / "demo"
    web_data.mkdir(parents=True, exist_ok=True)
    web_public.mkdir(parents=True, exist_ok=True)

    df = generate(
        GenConfig(
            n_users=150,
            days=18,
            seed=7,
            n_stuffing_campaigns=6,
            n_impossible_travel=55,
            n_device_takeover=60,
        )
    )
    cut = df["ts"].quantile(0.78)
    seed_df = df[df["ts"] < cut]
    stream_df = df[df["ts"] >= cut].sort_values("ts").head(2500)

    keep = [
        "event_id", "user_id", "ts", "country", "lat", "lon", "asn", "ip",
        "device_id", "device_type", "os", "auth_method", "outcome",
        "home_country", "home_lat", "home_lon", "account_age_days",
        "active_start", "active_end", "is_ato", "attack_type",
    ]

    def records(frame):
        f = frame[keep].copy()
        f["ts"] = f["ts"].dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        return f.to_dict(orient="records")

    (web_data / "demo_seed.json").write_text(json.dumps(records(seed_df)))
    (web_public / "demo_stream.json").write_text(json.dumps(records(stream_df)))
    print(
        f"demo: {len(seed_df):,} seed -> {web_data} | "
        f"{len(stream_df):,} stream events (ATO={stream_df['is_ato'].mean():.1%}) -> {web_public}"
    )


def _parity() -> None:
    """Export feature vectors + Python scores so the TS serving path can be
    parity-checked against the offline pipeline (web/scripts/parity-check.ts)."""
    import json

    import joblib
    import numpy as np
    import pandas as pd

    web_data = config.ML_DIR.parent / "web" / "data"
    web_data.mkdir(parents=True, exist_ok=True)

    model = joblib.load(config.ARTIFACTS_DIR / "best_model.joblib")
    cal = joblib.load(config.ARTIFACTS_DIR / "calibration.joblib")
    tbl = cal["isotonic"]
    df = pd.read_parquet(config.FEATURES_PATH)

    # spread the sample across the score range so calibration is exercised
    X = df[config.FEATURE_ORDER].to_numpy(dtype=np.float32)
    raw = model.predict_proba(X)[:, 1]
    idx = np.argsort(raw)
    pick = idx[:: max(1, len(idx) // 300)][:300]

    samples = []
    cal_vals = np.interp(raw[pick], tbl["x"], tbl["y"])
    for i, j in enumerate(pick):
        samples.append(
            {
                "vector": [float(v) for v in X[j]],
                "raw": float(raw[j]),
                "calibrated": float(cal_vals[i]),
            }
        )
    (web_data / "parity_samples.json").write_text(json.dumps(samples))
    print(f"parity: {len(samples)} samples -> {web_data / 'parity_samples.json'}")


def _sync_to_web() -> None:
    """Copy the served artifacts into the Next.js app."""
    web_model = config.ML_DIR.parent / "web" / "public" / "model"
    if not web_model.parent.parent.exists():
        print("web/ not found yet; skipping sync")
        return
    web_model.mkdir(parents=True, exist_ok=True)
    shutil.copy2(config.ONNX_PATH, web_model / "model.onnx")
    shutil.copy2(config.FEATURE_SPEC_PATH, web_model / "feature_spec.json")
    # metrics + plots power the dashboard's model page
    public = web_model.parent
    shutil.copy2(config.METRICS_PATH, public / "metrics.json")
    plots_dst = public / "plots"
    plots_dst.mkdir(parents=True, exist_ok=True)
    for p in config.PLOTS_DIR.glob("*.png"):
        shutil.copy2(p, plots_dst / p.name)
    print(f"synced artifacts -> {web_model}")


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd == "generate":
        _generate()
    elif cmd == "features":
        _features()
    elif cmd == "train":
        _train()
    elif cmd == "export":
        _export()
    elif cmd == "sync":
        _sync_to_web()
    elif cmd == "demo":
        _demo()
    elif cmd == "parity":
        _parity()
    elif cmd == "all":
        _generate()
        _features()
        _train()
        _export()
        _sync_to_web()
        _demo()
        _parity()
    else:
        print(__doc__)
        sys.exit(1 if cmd not in ("-h", "--help", "help") else 0)


if __name__ == "__main__":
    main()
