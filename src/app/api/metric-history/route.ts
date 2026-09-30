import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getMetricHistory } from "@/lib/metric-history-store";

export async function GET() {
  if (!await getSession()) return NextResponse.json({ message: "Relace vypršela." }, { status: 401 });
  try {
    return NextResponse.json({ metricHistory: await getMetricHistory() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to read metric history", error instanceof Error ? error.message : error);
    return NextResponse.json({ message: "Historii vytížení se nepodařilo načíst." }, { status: 500 });
  }
}
