import { NextResponse } from "next/server";

import { scoreEvent } from "@/lib/scoring/engine";
import { rawEventSchema } from "@/lib/scoring/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = rawEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid event", issues: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const scored = await scoreEvent(parsed.data);
    return NextResponse.json(scored);
  } catch (err) {
    console.error("scoring failed", err);
    return NextResponse.json({ error: "scoring failed" }, { status: 500 });
  }
}
