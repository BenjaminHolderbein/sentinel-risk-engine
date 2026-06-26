"use client";

import { BandChart, ScoreTimeline } from "@/components/dashboard/Charts";
import { Controls } from "@/components/dashboard/Controls";
import { Header } from "@/components/dashboard/Header";
import { Kpis } from "@/components/dashboard/Kpis";
import { RiskFeed } from "@/components/dashboard/RiskFeed";
import { Card } from "@/components/ui/card";
import { useSentinel } from "@/lib/client/useSentinel";

export default function Home() {
  const s = useSentinel();

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 py-5">
      <Header active="live" />

      <p className="max-w-3xl text-sm text-muted-foreground">
        Each login event is scored in real time: contextual features are computed from the
        account&apos;s recent history in the feature store, fed to a calibrated gradient-boosted
        model running on ONNX inside the serverless function, and returned with reason codes — all
        in single-digit milliseconds.
      </p>

      <Kpis stats={s.stats} />

      <Controls
        running={s.running}
        ready={s.ready}
        status={s.status}
        speed={s.speed}
        onStart={s.start}
        onPause={s.pause}
        onReset={s.reset}
        onInject={s.injectAttack}
        onSpeed={s.setSpeed}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <RiskFeed feed={s.feed} onLabel={s.label} />
        <div className="flex flex-col gap-5">
          <BandChart stats={s.stats} />
          <ScoreTimeline feed={s.feed} />
          <Card className="gap-2 p-4 text-xs text-muted-foreground">
            <h3 className="text-sm font-semibold text-foreground">Operating point</h3>
            <p>
              The decision threshold is chosen offline as the highest-recall point that keeps the
              false-positive rate within a 2% “alert budget,” not the naive 0.5 cutoff — flagged
              events are what a SOC would actually review.
            </p>
            <p>
              Confirm or dismiss flagged events to label them; those labels are the supervision a
              periodic retraining job consumes.
            </p>
          </Card>
        </div>
      </div>
    </main>
  );
}
