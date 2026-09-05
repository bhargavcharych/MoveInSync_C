import { NextResponse } from "next/server";
import { z } from "zod";
import { controlSimulation, getSimulationSnapshot } from "@/lib/simulator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getSimulationSnapshot(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to advance the live simulation." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { action } = z.object({ action: z.enum(["start", "pause", "reset", "inject_spike"]) }).parse(await request.json());
    return NextResponse.json(await controlSimulation(action), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to control the simulation." }, { status: 400 });
  }
}
