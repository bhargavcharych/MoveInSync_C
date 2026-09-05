import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/analytics";
import { filtersSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = filtersSchema.parse({
      persona: url.searchParams.get("persona") || undefined,
      businessUnit: url.searchParams.get("businessUnit") || undefined,
      office: url.searchParams.get("office") || undefined,
      month: url.searchParams.get("month") || undefined,
      vendor: url.searchParams.get("vendor") || undefined,
    });
    const data = await getDashboard(filters);

    if (filters.persona === "line_manager") {
      data.overview["spend"] = 0;
      data.overview["cost_per_km"] = 0;
      data.vendors = data.vendors.map((vendor) => Object.fromEntries(Object.entries(vendor).filter(([key]) => !["spend", "cost_per_km"].includes(key))));
      data.trips = data.trips.map((trip) => Object.fromEntries(Object.entries(trip).filter(([key]) => key !== "cost")));
    }
    return NextResponse.json(data, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to load mobility intelligence." }, { status: 500 });
  }
}
