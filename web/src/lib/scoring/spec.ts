// Loads the feature contract emitted by the offline pipeline
// (ml/artifacts/feature_spec.json -> web/public/model/feature_spec.json) and
// exposes the encode / clip / calibrate helpers that must match Python exactly.

import fs from "node:fs";
import path from "node:path";

export interface FeatureSpec {
  model: string;
  feature_order: string[];
  numeric_features: string[];
  categorical_features: string[];
  categorical_vocabs: Record<string, string[]>;
  clip_bounds: Record<string, number>;
  calibration: { x: number[]; y: number[] };
  threshold: number;
  max_fpr_budget: number;
  onnx: {
    input_name: string;
    prob_output_name: string;
    positive_index: number;
    n_features: number;
  };
  parity_max_abs_diff: number;
}

let cached: FeatureSpec | null = null;

export function loadSpec(): FeatureSpec {
  if (cached) return cached;
  const p = path.join(process.cwd(), "public", "model", "feature_spec.json");
  cached = JSON.parse(fs.readFileSync(p, "utf8")) as FeatureSpec;
  return cached;
}

/** Map a categorical value to its integer code (0 == unknown), matching config.py. */
export function encodeCategorical(spec: FeatureSpec, field: string, value: string): number {
  const vocab = spec.categorical_vocabs[field];
  if (!vocab) return 0;
  const idx = vocab.indexOf(value);
  return idx < 0 ? 0 : idx + 1;
}

/** Clip a feature to the bound used during training (no-op if unbounded). */
export function clip(spec: FeatureSpec, name: string, value: number): number {
  const bound = spec.clip_bounds[name];
  return bound === undefined ? value : Math.min(value, bound);
}

/**
 * Apply the isotonic calibration map shipped as a lookup table, with linear
 * interpolation between the 256 sampled points — the TS counterpart of
 * sklearn's IsotonicRegression.predict.
 */
export function calibrate(spec: FeatureSpec, raw: number): number {
  const { x, y } = spec.calibration;
  if (raw <= x[0]) return y[0];
  if (raw >= x[x.length - 1]) return y[y.length - 1];
  // binary search for the bracketing interval
  let lo = 0;
  let hi = x.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= raw) lo = mid;
    else hi = mid;
  }
  const t = (raw - x[lo]) / (x[hi] - x[lo]);
  return y[lo] + t * (y[hi] - y[lo]);
}
