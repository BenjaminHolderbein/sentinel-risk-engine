# Design notes

Why the system is built the way it is.

## 1. Train in Python, serve in TypeScript — via ONNX

The ML work (feature engineering, model selection, calibration) belongs in Python. But the product
is a low-latency web service, and standing up a separate Python model server would add a network
hop, a second platform to operate, and a second place for dependencies to rot.

Instead the model is exported to **ONNX** and run with `onnxruntime-node` *inside* the Next.js
serverless function. One deployment, no model server, no cross-service hop. The risk with two
languages is train/serve skew, so the feature contract is serialized once (`feature_spec.json`) and a
**parity test** asserts the TS path reproduces Python to ~1e-7. Inference itself is sub-millisecond;
online latency is dominated by the feature-store lookups.

## 2. Online features from a feature store

A risk score is only as good as its features, and the interesting features are *contextual*:
geo-velocity since the last login, whether this device/network has been seen before, how many times
this IP has failed in the last hour. Those require state.

At score time the engine reads the account's recent events and the IP's recent failures from Postgres
and recomputes the point-in-time features — the same logic, under the same causal constraint, as the
offline pipeline. Postgres is the feature store; the `events` table is append-only and doubles as the
alert feed. In a larger system this is where Redis / a streaming store and a real feature platform
would go, but the shape is the same.

## 3. Metrics and threshold match the security problem

At ~3% prevalence, accuracy is a trap. The system optimizes and reports **PR-AUC**, **calibration**
(Brier), and **recall at a fixed false-positive budget** — because a SOC can only review so many
alerts a day, so the real question is "how much fraud do we catch within that budget." The operating
threshold is chosen from that budget, not left at 0.5. Scores are isotonic-calibrated so a "0.8"
genuinely means ~80% chance of ATO, which is what lets you set policy on the number.

## 4. Realistic, overlapping synthetic data

Synthetic data is easy to make trivially separable — and a model that scores a perfect 1.0 is a red
flag, not a triumph. The generator injects deliberate overlap: benign users travel abroad, buy new
phones, use VPNs, and fumble passwords; attackers run low-and-slow stuffing and hijack the victim's
own device. The resulting irreducible error is what keeps PR-AUC at a believable 0.98 instead of 1.0,
and it's why the per-attack-type breakdown shows stealthy hijacks as the hard case.

## 5. The feedback loop

Flagged events can be confirmed or dismissed by an analyst in the dashboard. Those labels are written
back to the same row and are exactly the supervision a periodic retraining job would consume — the
"feedback loops / iterative retraining" that real fraud systems live on. Retraining is a documented,
scripted step (`uv run sentinel all`) rather than an automated cron here, but the data path is closed.

## Trade-offs taken deliberately

- **postgres.js over the Neon HTTP driver** — works identically against local Postgres and Neon's
  pooler, so dev and prod run the same code path.
- **Ordinal-encoded categoricals** rather than one-hot — keeps the ONNX input a single float tensor,
  which makes the TS serving path trivial and bulletproof; GBDTs handle ordinal codes well.
- **Replay on the data's own timeline** — the live demo streams events with their original
  timestamps so each account's seeded history stays inside the feature window and the online features
  match the training distribution exactly.
