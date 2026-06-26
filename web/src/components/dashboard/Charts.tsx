"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card } from "@/components/ui/card";
import { BAND_COLOR, BAND_LABEL } from "@/lib/format";
import type { FeedItem, Stats } from "@/lib/scoring/types";

const BAND_ORDER = ["critical", "high", "medium", "low"];

export function BandChart({ stats }: { stats: Stats | null }) {
  const data = BAND_ORDER.map((b) => ({
    band: BAND_LABEL[b],
    key: b,
    n: stats?.bands?.[b] ?? 0,
  }));
  return (
    <Card className="gap-2 p-4">
      <h3 className="text-sm font-semibold">Risk band distribution</h3>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <XAxis dataKey="band" tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "#ffffff08" }}
            contentStyle={{ background: "#18181b", border: "1px solid #333", borderRadius: 8, fontSize: 12 }}
          />
          <Bar dataKey="n" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.key} fill={BAND_COLOR[d.key]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

export function ScoreTimeline({ feed }: { feed: FeedItem[] }) {
  const data = feed
    .slice(0, 60)
    .reverse()
    .map((f, i) => ({ i, score: Number((f.riskScore * 100).toFixed(2)) }));
  return (
    <Card className="gap-2 p-4">
      <h3 className="text-sm font-semibold">Risk score timeline</h3>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="risk" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.6} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="i" hide />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "#18181b", border: "1px solid #333", borderRadius: 8, fontSize: 12 }}
            formatter={(v) => [`${v}`, "risk"]}
          />
          <Area type="monotone" dataKey="score" stroke="#ef4444" strokeWidth={1.5} fill="url(#risk)" />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}
