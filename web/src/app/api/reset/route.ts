import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Clears scored stream events but keeps the warm seed history, so the live demo
// can be restarted from a clean slate.
export async function POST() {
  await db.delete(events).where(eq(events.source, "stream"));
  return NextResponse.json({ ok: true });
}
