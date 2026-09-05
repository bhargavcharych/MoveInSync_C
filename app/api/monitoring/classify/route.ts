import { NextResponse } from "next/server";
import { z } from "zod";
import { classifySimulationEvent } from "@/lib/simulator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { eventId } = z.object({ eventId: z.string().regex(/^sim-[0-9]{6}-[0-9]+$/) }).parse(await request.json());
    return NextResponse.json(await classifySimulationEvent(eventId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sarvam classification failed." }, { status: 500 });
  }
}
