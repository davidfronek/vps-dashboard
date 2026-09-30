import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getServerSnapshot } from "@/lib/server-data";

export async function GET() {
  if (!await getSession()) return NextResponse.json({ message: "Relace vypršela." }, { status: 401 });
  try {
    return NextResponse.json(await getServerSnapshot(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to collect server snapshot", error instanceof Error ? error.message : error);
    return NextResponse.json({ message: "Stav serveru se nepodařilo načíst." }, { status: 500 });
  }
}