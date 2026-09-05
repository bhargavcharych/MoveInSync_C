import { NextResponse } from "next/server";
import { getTripDetail } from "@/lib/analytics";
import { personaSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ businessUnit: string; tripId: string }> },
) {
  try {
    const { businessUnit, tripId } = await params;
    if (!/^\d{6,10}$/.test(tripId)) {
      return NextResponse.json({ error: "Invalid trip ID" }, { status: 400 });
    }
    const persona = personaSchema.parse(new URL(request.url).searchParams.get("persona") || "transport_manager");
    const detail = await getTripDetail(decodeURIComponent(businessUnit), tripId, persona);
    if (!detail.trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to load trip." }, { status: 500 });
  }
}
