import { NextResponse } from "next/server";
import { dbInfo, query } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await query<{ rows: number }>("SELECT count(*)::INTEGER AS rows FROM rides");
    return NextResponse.json({ ok: true, database: { ...dbInfo(), rides: rows[0].rows } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
