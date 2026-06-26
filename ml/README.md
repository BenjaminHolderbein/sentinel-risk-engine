# sentinel-ml

Offline ML pipeline for **Sentinel**, a real-time account-takeover (ATO) risk engine.

This package generates a synthetic stream of authentication events, engineers the
same features the online scorer computes at request time, trains and calibrates
gradient-boosted risk models on heavily imbalanced data, and exports the winning
model to ONNX so it can be served from a TypeScript function on Vercel.

```bash
uv sync
uv run sentinel all          # generate -> features -> train -> evaluate -> export
```

Artifacts land in `artifacts/` and are copied into the web app's `public/model/`.
See the repository root `README.md` for the full system design.
