"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { FeedItem, RawEvent, Stats } from "@/lib/scoring/types";

const MAX_FEED = 120;

async function postJSON<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export function useSentinel() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(3); // events per second
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Connecting…");

  const stream = useRef<RawEvent[]>([]);
  const cursor = useRef(0);
  const inFlight = useRef(false);
  const maxTs = useRef(0);

  // bootstrap: seed history + load the replay stream
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus("Warming feature store…");
        await postJSON("/api/seed");
        setStatus("Loading event stream…");
        const res = await fetch("/demo/demo_stream.json");
        const events = (await res.json()) as RawEvent[];
        if (cancelled) return;
        stream.current = events;
        maxTs.current = events.reduce((m, e) => Math.max(m, Date.parse(e.ts)), 0);
        setReady(true);
        setStatus(`${events.length.toLocaleString()} events queued`);
      } catch (e) {
        if (!cancelled) setStatus(`Setup failed: ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const scoreNext = useCallback(async () => {
    if (inFlight.current || stream.current.length === 0) return;
    inFlight.current = true;
    try {
      const idx = cursor.current % stream.current.length;
      cursor.current += 1;
      // Replay on the data's own timeline: each event keeps its original
      // timestamp so the account's seeded history stays inside the feature
      // window and online features match the offline training distribution.
      // The live-feed ordering uses the row's createdAt (real wall-clock).
      const raw = stream.current[idx];
      const scored = await postJSON<FeedItem>("/api/score", raw);
      setFeed((f) => [scored, ...f].slice(0, MAX_FEED));
    } catch {
      // transient errors are fine; the next tick retries
    } finally {
      inFlight.current = false;
    }
  }, []);

  // simulation loop
  useEffect(() => {
    if (!running) return;
    const interval = Math.max(120, Math.round(1000 / speed));
    const t = setInterval(scoreNext, interval);
    return () => clearInterval(t);
  }, [running, speed, scoreNext]);

  // stats polling
  useEffect(() => {
    const poll = async () => {
      try {
        const s = await fetch("/api/stats").then((r) => r.json());
        setStats(s as Stats);
      } catch {
        /* ignore */
      }
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, []);

  const injectAttack = useCallback(async () => {
    // craft an unmistakable impossible-travel takeover for a real stream user
    const base = stream.current.find((e) => e.is_ato === 0) ?? stream.current[0];
    if (!base) return;
    // place the injected attack just after the end of the data timeline so it
    // has the victim's full history behind it
    maxTs.current += 90_000;
    const attack: RawEvent = {
      ...base,
      event_id: `inj_${Math.floor(Math.random() * 1e9)}`,
      ts: new Date(maxTs.current).toISOString(),
      country: "RU",
      lat: 55.7558,
      lon: 37.6173,
      asn: 64500,
      ip: `45.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.7`,
      device_id: `atk_${Math.floor(Math.random() * 1e6)}`,
      outcome: "success",
      is_ato: 1,
      attack_type: "manual_injection",
    };
    try {
      const scored = await postJSON<FeedItem>("/api/score", attack);
      setFeed((f) => [scored, ...f].slice(0, MAX_FEED));
    } catch {
      /* ignore */
    }
  }, []);

  const reset = useCallback(async () => {
    setRunning(false);
    await postJSON("/api/reset").catch(() => {});
    cursor.current = 0;
    setFeed([]);
    setStats(null);
  }, []);

  const label = useCallback(
    async (id: number, value: "confirmed_ato" | "false_positive") => {
      setFeed((f) => f.map((it) => (it.id === id ? { ...it, label: value } : it)));
      await postJSON("/api/feedback", { id, label: value }).catch(() => {});
    },
    [],
  );

  return {
    feed,
    stats,
    running,
    start: () => setRunning(true),
    pause: () => setRunning(false),
    reset,
    injectAttack,
    speed,
    setSpeed,
    ready,
    status,
    label,
  };
}
