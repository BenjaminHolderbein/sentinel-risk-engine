"use client";

import { Check, ShieldAlert, ShieldCheck, X } from "lucide-react";

import { Card } from "@/components/ui/card";
import type { FeedItem } from "@/lib/scoring/types";
import { BandPill, ScoreBar } from "./BandPill";

const SEV_COLOR: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#94a3b8",
};

function GroundTruth({ item }: { item: FeedItem }) {
  if (item.event.is_ato === undefined || item.event.is_ato === null) return null;
  const isAto = item.event.is_ato === 1;
  const correct = item.flagged === isAto;
  return (
    <span
      title={`ground truth: ${isAto ? "ATO" : "legit"} · model ${correct ? "correct" : "wrong"}`}
      className={`inline-flex items-center gap-1 text-[10px] ${correct ? "text-emerald-500" : "text-red-500"}`}
    >
      {correct ? <Check className="size-3" /> : <X className="size-3" />}
      {isAto ? "ATO" : "legit"}
    </span>
  );
}

function Row({ item, onLabel }: { item: FeedItem; onLabel: FeedProps["onLabel"] }) {
  const e = item.event;
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-border/50 px-3 py-2 text-sm last:border-0 hover:bg-muted/30">
      <div className="flex w-24 flex-col items-start gap-1">
        <BandPill band={item.band} />
        <ScoreBar score={item.riskScore} />
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-foreground">{e.user_id}</span>
          <span className="text-xs text-muted-foreground">
            {e.country} · {e.device_type} · {e.auth_method} · {e.outcome}
          </span>
          <GroundTruth item={item} />
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {item.reasons.length === 0 && (
            <span className="text-[11px] text-muted-foreground">no risk signals</span>
          )}
          {item.reasons.slice(0, 3).map((r) => (
            <span
              key={r.code}
              className="rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{ color: SEV_COLOR[r.severity], backgroundColor: `${SEV_COLOR[r.severity]}1a` }}
              title={r.detail}
            >
              {r.label}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-muted-foreground">
          {item.latencyMs.toFixed(0)}ms
        </span>
        {item.flagged &&
          (item.label ? (
            <span className="text-[10px] text-muted-foreground">
              {item.label === "confirmed_ato" ? "confirmed" : "dismissed"}
            </span>
          ) : (
            item.id !== null && (
              <span className="flex gap-1">
                <button
                  title="Confirm account takeover"
                  onClick={() => onLabel(item.id!, "confirmed_ato")}
                  className="rounded p-1 text-red-500 hover:bg-red-500/10"
                >
                  <ShieldAlert className="size-3.5" />
                </button>
                <button
                  title="Mark false positive"
                  onClick={() => onLabel(item.id!, "false_positive")}
                  className="rounded p-1 text-emerald-500 hover:bg-emerald-500/10"
                >
                  <ShieldCheck className="size-3.5" />
                </button>
              </span>
            )
          ))}
      </div>
    </div>
  );
}

interface FeedProps {
  feed: FeedItem[];
  onLabel: (id: number, label: "confirmed_ato" | "false_positive") => void;
}

export function RiskFeed({ feed, onLabel }: FeedProps) {
  return (
    <Card className="flex h-[640px] flex-col overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Live decision stream</h2>
        <span className="text-xs text-muted-foreground">{feed.length} recent</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {feed.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <ShieldCheck className="size-8 opacity-40" />
            <p className="text-sm">Press “Start stream” to begin scoring auth events</p>
          </div>
        ) : (
          feed.map((item) => (
            <Row key={`${item.id}-${item.event.event_id}`} item={item} onLabel={onLabel} />
          ))
        )}
      </div>
    </Card>
  );
}
