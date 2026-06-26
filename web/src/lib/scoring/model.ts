// ONNX model runner. Loads the gradient-boosted model exported by the offline
// pipeline and runs inference inside the Node serverless function — no separate
// Python service, no network hop. The session is created once per warm function
// instance and reused across invocations.

import path from "node:path";
import * as ort from "onnxruntime-node";

import { calibrate, loadSpec, type FeatureSpec } from "./spec";

let sessionPromise: Promise<ort.InferenceSession> | null = null;

function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    const modelPath = path.join(process.cwd(), "public", "model", "model.onnx");
    sessionPromise = ort.InferenceSession.create(modelPath, {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
    });
  }
  return sessionPromise;
}

export interface RawAndCalibrated {
  raw: number;
  calibrated: number;
}

/** Run the model on one feature vector and return raw + calibrated probability. */
export async function runModel(vector: number[]): Promise<RawAndCalibrated> {
  const spec: FeatureSpec = loadSpec();
  const session = await getSession();
  const input = new ort.Tensor("float32", Float32Array.from(vector), [1, vector.length]);
  const outputs = await session.run({ [spec.onnx.input_name]: input });
  const probs = outputs[spec.onnx.prob_output_name].data as Float32Array;
  const raw = Number(probs[spec.onnx.positive_index]);
  return { raw, calibrated: calibrate(spec, raw) };
}

export type RiskBand = "critical" | "high" | "medium" | "low";

export function riskBand(score: number, threshold: number): RiskBand {
  if (score >= 0.8) return "critical";
  if (score >= 0.4) return "high";
  if (score >= threshold) return "medium";
  return "low";
}

/** Warm the session at module load so the first real request isn't slow. */
export function warmup(): void {
  void getSession();
}
