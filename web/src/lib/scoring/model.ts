// Model runner — pure-TypeScript gradient-boosted tree inference.
//
// The XGBoost model trained offline is compiled to a portable JSON of decision
// trees (`model_trees.json`) plus an empirically-derived intercept. We walk the
// trees here with zero native or wasm dependencies, so the scorer runs in any
// Node serverless function (or the edge) and the function bundle stays tiny.
// A parity check asserts this reproduces the Python pipeline to ~1e-6.

import fs from "node:fs";
import path from "node:path";

import { calibrate, loadSpec } from "./spec";

interface TreeNode {
  nodeid: number;
  leaf?: number;
  split?: string; // "f<index>"
  split_condition?: number;
  yes?: number;
  no?: number;
  missing?: number;
  children?: TreeNode[];
}

interface TreeModel {
  trees: TreeNode[];
  intercept: number;
  n_features: number;
}

let cached: TreeModel | null = null;

function loadTrees(): TreeModel {
  if (cached) return cached;
  const p = path.join(process.cwd(), "public", "model", "model_trees.json");
  cached = JSON.parse(fs.readFileSync(p, "utf8")) as TreeModel;
  return cached;
}

function leafValue(node: TreeNode, x: number[]): number {
  let cur = node;
  while (cur.leaf === undefined) {
    const f = Number(cur.split!.slice(1));
    const v = x[f];
    const nextId = Number.isNaN(v)
      ? cur.missing
      : v < cur.split_condition!
        ? cur.yes
        : cur.no;
    cur = cur.children!.find((c) => c.nodeid === nextId)!;
  }
  return cur.leaf;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export interface RawAndCalibrated {
  raw: number;
  calibrated: number;
}

/** Score one feature vector → raw + calibrated probability. */
export async function runModel(vector: number[]): Promise<RawAndCalibrated> {
  const spec = loadSpec();
  const model = loadTrees();
  let margin = model.intercept;
  for (const tree of model.trees) margin += leafValue(tree, vector);
  const raw = sigmoid(margin);
  return { raw, calibrated: calibrate(spec, raw) };
}

export type RiskBand = "critical" | "high" | "medium" | "low";

export function riskBand(score: number, threshold: number): RiskBand {
  if (score >= 0.8) return "critical";
  if (score >= 0.4) return "high";
  if (score >= threshold) return "medium";
  return "low";
}

/** Warm the model cache at module load so the first request isn't slow. */
export function warmup(): void {
  loadTrees();
}
