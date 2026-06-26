"""Export the selected model to ONNX and emit the shared feature contract.

The web app serves this ONNX graph from a Node function via onnxruntime, so the
export step also:

  * verifies the ONNX output matches scikit-learn / XGBoost / LightGBM in-process
    (parity guard — catches converter drift before it ships), and
  * writes ``feature_spec.json``: the ordered feature list, categorical
    vocabularies, clip bounds, the isotonic calibration table, the operating
    threshold, and the ONNX input/output tensor names.
"""

from __future__ import annotations

import json

import joblib
import numpy as np
import onnxruntime as ort
import pandas as pd

from .config import (
    ARTIFACTS_DIR,
    CATEGORICAL_VOCABS,
    CLIP_BOUNDS,
    FEATURE_ORDER,
    FEATURE_SPEC_PATH,
    FEATURES_PATH,
    MAX_FALSE_POSITIVE_RATE,
    NUMERIC_FEATURES,
    CATEGORICAL_FEATURES,
    ONNX_PATH,
)


def _convert(model, name: str, n_features: int):
    if name == "logreg":
        from skl2onnx import convert_sklearn
        from skl2onnx.common.data_types import FloatTensorType

        initial_types = [("input", FloatTensorType([None, n_features]))]
        return convert_sklearn(
            model, initial_types=initial_types, options={id(model): {"zipmap": False}}, target_opset=15
        )
    # onnxmltools' tree converters require their own tensor types, not skl2onnx's.
    from onnxmltools.convert.common.data_types import FloatTensorType as MtFloatTensorType

    initial_types = [("input", MtFloatTensorType([None, n_features]))]
    if name == "xgboost":
        from onnxmltools.convert import convert_xgboost

        return convert_xgboost(model, initial_types=initial_types, target_opset=15)
    if name == "lightgbm":
        from onnxmltools.convert import convert_lightgbm

        return convert_lightgbm(model, initial_types=initial_types, target_opset=15)
    raise ValueError(f"no converter for {name}")


def export_trees(model, sample: np.ndarray) -> dict:
    """Compile the XGBoost model to a portable JSON of decision trees + an
    intercept, so the serverless scorer can run it in pure TypeScript with zero
    native dependencies. The intercept is derived empirically (margin minus the
    summed leaf values) so we never have to second-guess XGBoost's base_score
    conventions across versions.
    """
    import json as _json

    import xgboost as xgb

    booster = model.get_booster()
    trees = [_json.loads(t) for t in booster.get_dump(dump_format="json")]

    def leaf(node, x):
        while "leaf" not in node:
            f = int(node["split"][1:])
            v = x[f]
            nid = node["missing"] if v != v else (node["yes"] if v < node["split_condition"] else node["no"])
            node = next(c for c in node["children"] if c["nodeid"] == nid)
        return float(node["leaf"])

    margins = booster.predict(xgb.DMatrix(sample), output_margin=True)
    sums = np.array([sum(leaf(t, x) for t in trees) for x in sample])
    intercept = float(np.mean(margins - sums))
    resid = float(np.max(np.abs((margins - sums) - intercept)))

    # verify the pure-walk reproduces predict_proba before shipping
    raw = 1.0 / (1.0 + np.exp(-(intercept + sums)))
    ref = model.predict_proba(sample)[:, 1]
    max_diff = float(np.max(np.abs(raw - ref)))
    print(f"Tree-walk parity max|Δ| = {max_diff:.2e} (intercept residual {resid:.2e})")
    if max_diff > 1e-4:
        raise RuntimeError(f"tree export parity failed: {max_diff:.3e}")

    return {"trees": trees, "intercept": intercept, "n_features": int(sample.shape[1])}


def _find_prob_output(sess: ort.InferenceSession) -> tuple[str, int]:
    """Return (output_name, positive_class_index) for the probability tensor."""
    for out in sess.get_outputs():
        shape = out.shape
        if len(shape) == 2 and (shape[1] == 2 or shape[1] is None):
            return out.name, 1
    # fallback: last output
    return sess.get_outputs()[-1].name, 1


def export() -> dict:
    best = joblib.load(ARTIFACTS_DIR / "best_model.joblib")
    cal = joblib.load(ARTIFACTS_DIR / "calibration.joblib")
    name = cal["name"]
    n_features = len(FEATURE_ORDER)

    onnx_model = _convert(best, name, n_features)
    ONNX_PATH.write_bytes(onnx_model.SerializeToString())

    # ---- parity check ----
    df = pd.read_parquet(FEATURES_PATH)
    sample = df[FEATURE_ORDER].to_numpy(dtype=np.float32)[:2000]
    sess = ort.InferenceSession(str(ONNX_PATH), providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name
    out_name, pos_idx = _find_prob_output(sess)
    onnx_out = sess.run([out_name], {input_name: sample})[0]
    onnx_proba = onnx_out[:, pos_idx] if onnx_out.ndim == 2 else onnx_out.ravel()
    ref_proba = best.predict_proba(sample)[:, 1]
    max_diff = float(np.max(np.abs(onnx_proba - ref_proba)))
    print(f"ONNX parity max|Δ| = {max_diff:.2e}  (model={name})")
    if max_diff > 1e-3:
        raise RuntimeError(f"ONNX parity check failed: max diff {max_diff:.3e}")

    spec = {
        "model": name,
        "feature_order": FEATURE_ORDER,
        "numeric_features": NUMERIC_FEATURES,
        "categorical_features": CATEGORICAL_FEATURES,
        "categorical_vocabs": CATEGORICAL_VOCABS,
        "clip_bounds": CLIP_BOUNDS,
        "calibration": cal["isotonic"],
        "threshold": cal["threshold"],
        "max_fpr_budget": MAX_FALSE_POSITIVE_RATE,
        "onnx": {
            "input_name": input_name,
            "prob_output_name": out_name,
            "positive_index": pos_idx,
            "n_features": n_features,
        },
        "parity_max_abs_diff": max_diff,
    }
    # Compile to portable trees for the zero-dependency TS serverless scorer.
    if name == "xgboost":
        from .config import MODEL_TREES_PATH

        trees = export_trees(best, sample)
        MODEL_TREES_PATH.write_text(json.dumps(trees))
        spec["serving"] = "trees"
        print(f"Wrote model_trees.json ({MODEL_TREES_PATH.stat().st_size // 1024} KB)")
    else:
        spec["serving"] = "onnx"
        print(f"WARNING: selected model is {name}; TS serving path expects xgboost trees.")

    FEATURE_SPEC_PATH.write_text(json.dumps(spec, indent=2))
    print(f"Wrote {ONNX_PATH.name} ({ONNX_PATH.stat().st_size // 1024} KB) and feature_spec.json")
    return spec


if __name__ == "__main__":
    export()
