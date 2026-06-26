import fs from "node:fs";
import path from "node:path";

import { Header } from "@/components/dashboard/Header";
import { Card } from "@/components/ui/card";
import { pct } from "@/lib/format";

export const dynamic = "force-static";

interface Metrics {
  selected_model: string;
  candidates: Record<string, { pr_auc_test: number }>;
  calibrated_test: {
    roc_auc: number;
    pr_auc: number;
    brier: number;
    recall_at_2pct_fpr: number;
    precision_at_threshold: number;
    recall_at_threshold: number;
    threshold: number;
    prevalence: number;
    n: number;
    confusion: { tn: number; fp: number; fn: number; tp: number };
  };
  threshold_policy: { threshold: number; max_fpr_budget: number; fpr: number; recall: number };
  detection_by_attack_type: Record<string, { events: number; detected: number; recall: number }>;
}

function loadMetrics(): Metrics | null {
  try {
    const p = path.join(process.cwd(), "public", "metrics.json");
    return JSON.parse(fs.readFileSync(p, "utf8")) as Metrics;
  } catch {
    return null;
  }
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="gap-1 p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

function Plot({ src, title, caption }: { src: string; title: string; caption: string }) {
  return (
    <Card className="gap-2 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={title} className="w-full rounded-md bg-white" />
      <p className="text-xs text-muted-foreground">{caption}</p>
    </Card>
  );
}

export default function ModelPage() {
  const m = loadMetrics();

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 py-5">
      <Header active="model" />

      {!m ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Model metrics unavailable. Run <code>uv run sentinel all</code> in <code>ml/</code>.
        </Card>
      ) : (
        <>
          <div>
            <h2 className="text-lg font-semibold">Model card</h2>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Selected model: <strong className="capitalize">{m.selected_model}</strong>, chosen by
              PR-AUC on a <em>temporal</em> hold-out (train on the earliest events, test on the
              latest) over {m.calibrated_test.n.toLocaleString()} events at{" "}
              {pct(m.calibrated_test.prevalence, 2)} ATO prevalence. Scores are isotonic-calibrated;
              all metrics below are on the calibrated test set.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="PR-AUC" value={m.calibrated_test.pr_auc.toFixed(3)} hint="vs prevalence baseline" />
            <Stat label="ROC-AUC" value={m.calibrated_test.roc_auc.toFixed(3)} />
            <Stat label="Recall @2% FPR" value={pct(m.calibrated_test.recall_at_2pct_fpr)} hint="alert budget" />
            <Stat label="Precision" value={pct(m.calibrated_test.precision_at_threshold)} hint="at operating threshold" />
            <Stat label="Recall" value={pct(m.calibrated_test.recall_at_threshold)} hint="at operating threshold" />
            <Stat label="Brier" value={m.calibrated_test.brier.toFixed(4)} hint="calibration error" />
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <Plot
              src="/plots/pr_curve.png"
              title="Precision–Recall"
              caption="The metric that matters under heavy imbalance — far above the prevalence baseline."
            />
            <Plot
              src="/plots/calibration.png"
              title="Calibration"
              caption="Isotonic-calibrated scores track observed ATO frequency, so the score is a real probability."
            />
            <Plot
              src="/plots/feature_importance.png"
              title="Feature importance"
              caption="Velocity, device/network novelty and failed-attempt counts dominate, as expected."
            />
            <Plot
              src="/plots/score_distribution.png"
              title="Score separation"
              caption="Legit vs ATO score distributions (log scale); overlap is the irreducible error."
            />
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <Card className="gap-3 p-4">
              <h3 className="text-sm font-semibold">Detection by attack type</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="pb-2">Campaign</th>
                    <th className="pb-2 text-right">Events</th>
                    <th className="pb-2 text-right">Detected</th>
                    <th className="pb-2 text-right">Recall</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(m.detection_by_attack_type).map(([k, v]) => (
                    <tr key={k} className="border-t border-border/50">
                      <td className="py-1.5 capitalize">{k.replaceAll("_", " ")}</td>
                      <td className="py-1.5 text-right font-mono">{v.events}</td>
                      <td className="py-1.5 text-right font-mono">{v.detected}</td>
                      <td className="py-1.5 text-right font-mono">{pct(v.recall)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground">
                Noisy credential-stuffing is caught almost perfectly; stealthy session-hijack
                takeovers that reuse the victim&apos;s own device are the hard, partly-irreducible
                cases.
              </p>
            </Card>

            <Card className="gap-3 p-4">
              <h3 className="text-sm font-semibold">Model comparison & operating point</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="pb-2">Model</th>
                    <th className="pb-2 text-right">PR-AUC (test)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(m.candidates).map(([k, v]) => (
                    <tr key={k} className="border-t border-border/50">
                      <td className="py-1.5 capitalize">
                        {k} {k === m.selected_model && <span className="text-emerald-500">★</span>}
                      </td>
                      <td className="py-1.5 text-right font-mono">{v.pr_auc_test.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground">
                Operating threshold {m.threshold_policy.threshold.toFixed(3)} — the highest-recall
                point with FPR ≤ {pct(m.threshold_policy.max_fpr_budget, 0)} (the SOC&apos;s alert
                budget). Confusion at threshold: {m.calibrated_test.confusion.tp} TP /{" "}
                {m.calibrated_test.confusion.fp} FP / {m.calibrated_test.confusion.fn} FN.
              </p>
            </Card>
          </div>
        </>
      )}
    </main>
  );
}
