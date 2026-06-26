# Model Card — Sentinel ATO Risk Model

## Overview
A binary classifier that estimates the probability that an authentication event is part of an
account-takeover (ATO) attack. Trained offline in Python; exported to ONNX and compiled to a portable
tree spec served by a zero-dependency TypeScript scorer.

- **Model type:** Gradient-boosted decision trees (XGBoost), selected by PR-AUC over LightGBM and a
  logistic-regression baseline.
- **Output:** Calibrated probability in [0, 1] plus a risk band (low / medium / high / critical) and
  rule-based reason codes.
- **Intended use:** Real-time, risk-adaptive authentication decisions (step-up auth, review queues).
  A demonstration system on synthetic data — not for production security decisions as-is.

## Data
- Fully synthetic auth-event stream (`ml/sentinel_ml/generate.py`). ~290k events, ~4k accounts,
  30-day window, **~3% ATO prevalence**.
- Attack campaigns: credential stuffing (bursty and low-and-slow), impossible travel, and
  new-device / session-hijack takeovers. Benign traffic deliberately includes risky-looking-but-legit
  behaviour (international travel, new devices, VPNs, forgotten-password bursts) so the classes
  genuinely overlap.

## Features (21)
Computed **causally** (only information available before the event), identically offline and online:
geo-velocity, distance-from-home, country-is-home / country-changed, device/IP/ASN novelty,
failed-attempt counts (user & IP, 1h), distinct countries/devices/IPs (24h), login velocity (1h),
time-since-last-login, account age, hour / day-of-week / off-hours, and encoded device type, OS, and
auth method.

## Training & evaluation
- **Temporal split** (70% train / 10% calibration / 20% test) — no random shuffling.
- **Imbalance:** `scale_pos_weight` (trees) / balanced class weights (LR).
- **Calibration:** isotonic regression on the held-out calibration slice, shipped as a lookup table.
- **Threshold:** highest recall with FPR ≤ 2% (the SOC "alert budget").

| Metric (calibrated, temporal test) | Value |
| --- | --- |
| PR-AUC | 0.979 |
| ROC-AUC | 0.999 |
| Recall @ 2% FPR | 0.998 |
| Precision @ operating threshold | 0.78 |
| Brier score | 0.004 |

Detection by attack type: credential stuffing ≈ 100%, impossible travel ≈ 98%, new-device/hijack
takeover ≈ 96% (the stealthiest hijacks are partly irreducible by design).

## Limitations
- Synthetic data cannot capture the full diversity of real attacker behaviour or concept drift.
- Behavioural signals cannot catch takeovers that perfectly mimic the user (the model is one layer
  of defence, not the whole system).
- Reason codes are a transparent rule layer that explains the feature evidence, not an exact
  attribution of the model's decision (SHAP-style attribution would be the next step).

## Ethical / operational notes
- ATO models gate access; false positives lock real users out. The FPR-budget threshold and the
  precision/recall reporting make that trade-off explicit rather than hidden behind accuracy.
- A production deployment would need drift monitoring, fairness review across user segments, and a
  human-in-the-loop review path — the feedback-labelling loop here is the seed of that.
