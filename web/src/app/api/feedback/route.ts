import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  id: z.number().int(),
  label: z.enum(["confirmed_ato", "false_positive"]),
});

// Analyst feedback closes the loop: labels written here are exactly the
// supervision a periodic retraining job (see ml/) would consume.
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid feedback" }, { status: 422 });
  }
  const { id, label } = parsed.data;
  await db
    .update(events)
    .set({ label, labeledAt: new Date() })
    .where(eq(events.id, id));
  return NextResponse.json({ ok: true });
}
