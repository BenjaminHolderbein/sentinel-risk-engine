"""Evaluation utilities tuned for an imbalanced security problem.

Accuracy is meaningless at <3% prevalence, so we lead with PR-AUC, calibration
(Brier score), and *recall at a fixed false-positive budget* — the metric a SOC
actually cares about, since it bounds analyst review load.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    precision_recall_curve,
    roc_auc_score,
    roc_curve,
)

from .config import MAX_FALSE_POSITIVE_RATE


@dataclass
class ThresholdPolicy:
    threshold: float
    fpr: float
    recall: float
    precision: float


def pick_threshold(
    y_true: np.ndarray, y_score: np.ndarray, max_fpr: float = MAX_FALSE_POSITIVE_RATE
) -> ThresholdPolicy:
    """Highest-recall threshold whose false-positive rate stays within budget."""
    fpr, tpr, thr = roc_curve(y_true, y_score)
    ok = fpr <= max_fpr
    # always keep at least the strictest point
    idx_candidates = np.where(ok)[0]
    best = idx_candidates[np.argmax(tpr[idx_candidates])] if len(idx_candidates) else int(np.argmin(fpr))
    t = float(thr[best]) if np.isfinite(thr[best]) else 1.0
    pred = (y_score >= t).astype(int)
    tp = int(((pred == 1) & (y_true == 1)).sum())
    fp = int(((pred == 1) & (y_true == 0)).sum())
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    return ThresholdPolicy(threshold=t, fpr=float(fpr[best]), recall=float(tpr[best]), precision=precision)


def recall_at_fpr(y_true: np.ndarray, y_score: np.ndarray, max_fpr: float) -> float:
    fpr, tpr, _ = roc_curve(y_true, y_score)
    ok = fpr <= max_fpr
    return float(tpr[ok].max()) if ok.any() else 0.0


def core_metrics(y_true: np.ndarray, y_score: np.ndarray, threshold: float) -> dict:
    pred = (y_score >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    return {
        "roc_auc": float(roc_auc_score(y_true, y_score)),
        "pr_auc": float(average_precision_score(y_true, y_score)),
        "brier": float(brier_score_loss(y_true, y_score)),
        "recall_at_1pct_fpr": recall_at_fpr(y_true, y_score, 0.01),
        "recall_at_2pct_fpr": recall_at_fpr(y_true, y_score, 0.02),
        "threshold": float(threshold),
        "precision_at_threshold": float(precision),
        "recall_at_threshold": float(recall),
        "f1_at_threshold": float(f1),
        "confusion": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "prevalence": float(y_true.mean()),
        "n": int(len(y_true)),
    }


# --------------------------------------------------------------------------
# Plots (saved to artifacts/plots, surfaced on the dashboard + README)
# --------------------------------------------------------------------------
def save_plots(y_true: np.ndarray, y_score: np.ndarray, plots_dir, model_label: str) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from sklearn.calibration import calibration_curve

    plots_dir.mkdir(parents=True, exist_ok=True)

    # PR curve
    prec, rec, _ = precision_recall_curve(y_true, y_score)
    ap = average_precision_score(y_true, y_score)
    plt.figure(figsize=(5, 4))
    plt.plot(rec, prec, color="#0b6bcb")
    plt.axhline(y_true.mean(), ls="--", color="#999", label=f"baseline={y_true.mean():.3f}")
    plt.xlabel("Recall"); plt.ylabel("Precision")
    plt.title(f"Precision-Recall (AP={ap:.3f})"); plt.legend(); plt.tight_layout()
    plt.savefig(plots_dir / "pr_curve.png", dpi=120); plt.close()

    # ROC curve
    fpr, tpr, _ = roc_curve(y_true, y_score)
    auc = roc_auc_score(y_true, y_score)
    plt.figure(figsize=(5, 4))
    plt.plot(fpr, tpr, color="#0b6bcb"); plt.plot([0, 1], [0, 1], ls="--", color="#999")
    plt.xlabel("False positive rate"); plt.ylabel("True positive rate")
    plt.title(f"ROC (AUC={auc:.3f})"); plt.tight_layout()
    plt.savefig(plots_dir / "roc_curve.png", dpi=120); plt.close()

    # Calibration
    frac_pos, mean_pred = calibration_curve(y_true, y_score, n_bins=10, strategy="quantile")
    plt.figure(figsize=(5, 4))
    plt.plot(mean_pred, frac_pos, "o-", color="#0b6bcb"); plt.plot([0, 1], [0, 1], ls="--", color="#999")
    plt.xlabel("Mean predicted probability"); plt.ylabel("Observed fraction")
    plt.title("Calibration"); plt.tight_layout()
    plt.savefig(plots_dir / "calibration.png", dpi=120); plt.close()

    # Score distribution by class
    plt.figure(figsize=(5, 4))
    plt.hist(y_score[y_true == 0], bins=40, alpha=0.6, label="legit", color="#4caf50", density=True)
    plt.hist(y_score[y_true == 1], bins=40, alpha=0.6, label="ATO", color="#e53935", density=True)
    plt.xlabel("Risk score"); plt.ylabel("Density"); plt.yscale("log")
    plt.title(f"Score distribution ({model_label})"); plt.legend(); plt.tight_layout()
    plt.savefig(plots_dir / "score_distribution.png", dpi=120); plt.close()


def save_importance_plot(names: list[str], importances: np.ndarray, plots_dir) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    order = np.argsort(importances)[::-1][:15][::-1]
    plt.figure(figsize=(6, 5))
    plt.barh([names[i] for i in order], importances[order], color="#0b6bcb")
    plt.title("Feature importance (gain)"); plt.tight_layout()
    plt.savefig(plots_dir / "feature_importance.png", dpi=120); plt.close()
