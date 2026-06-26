/**
 * Parity check: confirm the TypeScript serving path reproduces the offline
 * Python pipeline. Reads parity_samples.json (exported by the ML package:
 * feature vectors + Python's raw and calibrated scores) and asserts the ONNX
 * runtime + isotonic-table calibration in TS match within tolerance.
 *
 *   pnpm tsx scripts/parity-check.ts
 */
import fs from "node:fs";
import path from "node:path";

import { runModel } from "../src/lib/scoring/model";

interface Sample {
  vector: number[];
  raw: number;
  calibrated: number;
}

async function main() {
  const p = path.join(process.cwd(), "data", "parity_samples.json");
  if (!fs.existsSync(p)) {
    console.error("Missing data/parity_samples.json — run `uv run sentinel parity` in ml/ first.");
    process.exit(1);
  }
  const samples = JSON.parse(fs.readFileSync(p, "utf8")) as Sample[];

  let maxRaw = 0;
  let maxCal = 0;
  for (const s of samples) {
    const { raw, calibrated } = await runModel(s.vector);
    maxRaw = Math.max(maxRaw, Math.abs(raw - s.raw));
    maxCal = Math.max(maxCal, Math.abs(calibrated - s.calibrated));
  }

  console.log(`samples:            ${samples.length}`);
  console.log(`max |Δ raw|:        ${maxRaw.toExponential(3)}`);
  console.log(`max |Δ calibrated|: ${maxCal.toExponential(3)}`);

  const tol = 1e-4;
  if (maxRaw > tol || maxCal > tol) {
    console.error(`PARITY FAILED (tolerance ${tol})`);
    process.exit(1);
  }
  console.log("PARITY OK ✓");
}

main();
