"use client";

import { Pause, Play, RotateCcw, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";

interface Props {
  running: boolean;
  ready: boolean;
  status: string;
  speed: number;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onInject: () => void;
  onSpeed: (v: number) => void;
}

export function Controls({
  running,
  ready,
  status,
  speed,
  onStart,
  onPause,
  onReset,
  onInject,
  onSpeed,
}: Props) {
  return (
    <Card className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button onClick={onPause} variant="secondary" size="sm">
            <Pause className="size-4" /> Pause
          </Button>
        ) : (
          <Button onClick={onStart} disabled={!ready} size="sm">
            <Play className="size-4" /> Start stream
          </Button>
        )}
        <Button onClick={onInject} disabled={!ready} variant="outline" size="sm">
          <Zap className="size-4" /> Inject attack
        </Button>
        <Button onClick={onReset} variant="ghost" size="sm">
          <RotateCcw className="size-4" /> Reset
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">Speed</span>
        <Slider
          className="w-40"
          min={1}
          max={12}
          step={1}
          value={[speed]}
          onValueChange={(v) => onSpeed(Array.isArray(v) ? v[0] : v)}
        />
        <span className="w-14 font-mono text-xs tabular-nums text-muted-foreground">{speed}/s</span>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className={`h-2 w-2 rounded-full ${running ? "animate-pulse bg-emerald-500" : "bg-muted-foreground/40"}`}
        />
        {status}
      </div>
    </Card>
  );
}
