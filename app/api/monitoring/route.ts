import { NextResponse } from "next/server";
import { z } from "zod";
import { controlSimulation, getSimulationSnapshot, getSpeedRunSummary } from "@/lib/simulator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("summary") === "1") {
      const summary = await getSpeedRunSummary();
      return NextResponse.json(summary || { summary: null }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(await getSimulationSnapshot(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to advance the live simulation." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { action } = z.object({ action: z.enum(["start", "pause", "reset", "inject_spike", "speed_run"]) }).parse(await request.json());
    return NextResponse.json(await controlSimulation(action), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to control the simulation." }, { status: 400 });
  }
}
