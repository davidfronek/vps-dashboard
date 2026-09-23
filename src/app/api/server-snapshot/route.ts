import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getServerSnapshot } from "@/lib/server-data";

export async function GET() {
  if (!await getSession()) return NextResponse.json({ message: "Relace vypršela." }, { status: 401 });
  return NextResponse.json(getServerSnapshot(), { headers: { "Cache-Control": "no-store" } });
}