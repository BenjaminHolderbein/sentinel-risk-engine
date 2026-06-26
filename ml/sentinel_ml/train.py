"""Train, calibrate, and select the Sentinel risk model.

Design choices that matter for a security ML problem:

  * **Temporal split.** Fraud is non-stationary, so we train on the earliest
    events and test on the latest — never a random shuffle, which would leak the
    future and inflate metrics.
  * **Imbalance handling.** ~2-3% prevalence, so trees use ``scale_pos_weight``
    and the logistic baseline uses balanced class weights. We rank models by
    PR-AUC, not accuracy.
  * **Calibration.** Raw GBDT scores are not probabilities. We fit isotonic
    regression on a held-out slice and ship the mapping as a lookup table the
    TypeScript scorer interpolates, so the deployed score is a real probability.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

import joblib
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from . import evaluate as ev
from .config import (
    ARTIFACTS_DIR,
    FEATURE_ORDER,
    FEATURES_PATH,
    METRICS_PATH,
    PLOTS_DIR,
    RANDOM_SEED,
)


@dataclass
class Split:
    Xtr: np.ndarray
    ytr: np.ndarray
    Xcal: np.ndarray
    ycal: np.ndarray
    Xte: np.ndarray
    yte: np.ndarray


def temporal_split(df: pd.DataFrame, train=0.7, calib=0.1) -> tuple[Split, pd.DataFrame]:
    """Return the (Split, test-rows DataFrame). Test rows keep ``attack_type``
    so we can report detection by campaign type, not just in aggregate."""
    df = df.sort_values("ts").reset_index(drop=True)
    n = len(df)
    i_tr, i_cal = int(n * train), int(n * (train + calib))
    X = df[FEATURE_ORDER].to_numpy(dtype=np.float32)
    y = df["is_ato"].to_numpy(dtype=int)
    split = Split(X[:i_tr], y[:i_tr], X[i_tr:i_cal], y[i_tr:i_cal], X[i_cal:], y[i_cal:])
    return split, df.iloc[i_cal:].reset_index(drop=True)


def recall_by_attack_type(df_test: pd.DataFrame, scores: np.ndarray, threshold: float) -> dict:
    flagged = scores >= threshold
    out: dict[str, dict] = {}
    for atype, sub in df_test.assign(_flag=flagged).groupby("attack_type"):
        if atype == "none":
            continue
        n = len(sub)
        caught = int(sub["_flag"].sum())
        out[atype] = {"events": int(n), "detected": caught, "recall": caught / n if n else 0.0}
    return out


def _xgb(scale_pos_weight: float):
    from xgboost import XGBClassifier

    return XGBClassifier(
        n_estimators=400,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.9,
        min_child_weight=2.0,
        reg_lambda=1.0,
        scale_pos_weight=scale_pos_weight,
        eval_metric="aucpr",
        tree_method="hist",
        random_state=RANDOM_SEED,
        n_jobs=4,
    )


def _lgbm(scale_pos_weight: float):
    from lightgbm import LGBMClassifier

    return LGBMClassifier(
        n_estimators=500,
        num_leaves=48,
        learning_rate=0.05,
        subsample=0.9,
        subsample_freq=1,
        colsample_bytree=0.9,
        min_child_samples=30,
        reg_lambda=1.0,
        scale_pos_weight=scale_pos_weight,
        random_state=RANDOM_SEED,
        n_jobs=4,
        verbosity=-1,
    )


def _logreg():
    return Pipeline(
        [
            ("scale", StandardScaler()),
            ("clf", LogisticRegression(max_iter=2000, class_weight="balanced", C=1.0)),
        ]
    )


def train_all() -> dict:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    PLOTS_DIR.mkdir(parents=True, exist_ok=True)

    df = pd.read_parquet(FEATURES_PATH)
    sp, df_test = temporal_split(df)
    n_pos = int(sp.ytr.sum())
    n_neg = int((sp.ytr == 0).sum())
    spw = max(1.0, n_neg / max(1, n_pos))
    print(f"train={len(sp.ytr):,} (pos={n_pos}) cal={len(sp.ycal):,} test={len(sp.yte):,}  spw={spw:.1f}")

    candidates = {
        "logreg": _logreg(),
        "xgboost": _xgb(spw),
        "lightgbm": _lgbm(spw),
    }

    results: dict[str, dict] = {}
    fitted: dict[str, object] = {}
    for name, model in candidates.items():
        model.fit(sp.Xtr, sp.ytr)
        proba_te = model.predict_proba(sp.Xte)[:, 1]
        ap = average_precision_score(sp.yte, proba_te)
        results[name] = {"pr_auc_test": float(ap)}
        fitted[name] = model
        print(f"  {name:10s} test PR-AUC = {ap:.4f}")

    best_name = max(results, key=lambda k: results[k]["pr_auc_test"])
    best = fitted[best_name]
    print(f"Selected model: {best_name}")

    # ---- isotonic calibration on the held-out calibration slice ----
    raw_cal = best.predict_proba(sp.Xcal)[:, 1]
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    iso.fit(raw_cal, sp.ycal)

    raw_te = best.predict_proba(sp.Xte)[:, 1]
    cal_te = iso.predict(raw_te)

    # threshold from the calibration slice (avoid peeking at test)
    cal_cal = iso.predict(raw_cal)
    policy = ev.pick_threshold(sp.ycal, cal_cal)

    metrics = {
        "selected_model": best_name,
        "candidates": results,
        "uncalibrated_test": ev.core_metrics(sp.yte, raw_te, 0.5),
        "calibrated_test": ev.core_metrics(sp.yte, cal_te, policy.threshold),
        "threshold_policy": {
            "threshold": policy.threshold,
            "max_fpr_budget": ev.MAX_FALSE_POSITIVE_RATE,
            "fpr": policy.fpr,
            "recall": policy.recall,
        },
        "detection_by_attack_type": recall_by_attack_type(df_test, cal_te, policy.threshold),
        "feature_order": FEATURE_ORDER,
    }
    METRICS_PATH.write_text(json.dumps(metrics, indent=2))

    # ---- plots ----
    ev.save_plots(sp.yte, cal_te, PLOTS_DIR, best_name)
    importances = _importances(best, best_name)
    if importances is not None:
        ev.save_importance_plot(FEATURE_ORDER, importances, PLOTS_DIR)

    # ---- persist for the ONNX export step ----
    joblib.dump(best, ARTIFACTS_DIR / "best_model.joblib")
    iso_table = _isotonic_table(iso)
    joblib.dump(
        {"name": best_name, "isotonic": iso_table, "threshold": policy.threshold},
        ARTIFACTS_DIR / "calibration.joblib",
    )

    print(f"PR-AUC (cal) test: {metrics['calibrated_test']['pr_auc']:.4f}")
    print(f"Recall @2% FPR:    {metrics['calibrated_test']['recall_at_2pct_fpr']:.4f}")
    print(f"Brier (cal):       {metrics['calibrated_test']['brier']:.4f}")
    return metrics


def _importances(model, name: str):
    if name == "logreg":
        clf = model.named_steps["clf"]
        return np.abs(clf.coef_[0])
    if hasattr(model, "feature_importances_"):
        return np.asarray(model.feature_importances_, dtype=float)
    return None


def _isotonic_table(iso: IsotonicRegression, n: int = 256) -> dict:
    xs = np.linspace(0.0, 1.0, n)
    ys = iso.predict(xs)
    return {"x": [float(v) for v in xs], "y": [float(v) for v in ys]}


if __name__ == "__main__":
    train_all()
