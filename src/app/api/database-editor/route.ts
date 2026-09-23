import { execFileSync } from "node:child_process";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";

const HELPER = "/usr/local/sbin/vps-dashboard-domains";
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
const ROW_ID = /^\([0-9]+,[0-9]+\)$/;
const COLUMN_TYPES = new Set(["text", "varchar", "integer", "bigint", "boolean", "date", "timestamptz", "jsonb", "uuid", "bigserial"]);

type ColumnInput = { name: string; type: string; nullable?: boolean; primaryKey?: boolean };
type EditorBody = {
  database?: string;
  operation?: string;
  table?: string;
  rowId?: string;
  columns?: ColumnInput[];
  column?: ColumnInput;
  values?: Record<string, unknown>;
};

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

function validColumn(column: unknown): column is ColumnInput {
  if (!column || typeof column !== "object") return false;
  const value = column as ColumnInput;
  return IDENTIFIER.test(value.name ?? "") && COLUMN_TYPES.has(value.type) && (value.nullable === undefined || typeof value.nullable === "boolean") && (value.primaryKey === undefined || typeof value.primaryKey === "boolean");
}

function encoded(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function execute(database: string, operation: string, args: string[] = []) {
  const output = execFileSync("sudo", ["-n", HELPER, "database-editor", database, operation, ...args], {
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output ? JSON.parse(output) as unknown : { ok: true };
}

function errorResponse(error: unknown) {
  console.error("Database editor operation failed", error instanceof Error ? error.message : error);
  return NextResponse.json({ message: "Databázovou operaci se nepodařilo provést." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  if (!await getSession()) return NextResponse.json({ message: "Relace vypršela." }, { status: 401 });
  const database = request.nextUrl.searchParams.get("database") ?? "";
  const table = request.nextUrl.searchParams.get("table");
  if (!IDENTIFIER.test(database) || (table !== null && !IDENTIFIER.test(table))) return NextResponse.json({ message: "Neplatný databázový objekt." }, { status: 400 });

  try {
    const result = table
      ? execute(database, "rows", [table, request.nextUrl.searchParams.get("offset") ?? "0", "50"])
      : execute(database, "tables");
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  if (!await getSession()) return NextResponse.json({ message: "Relace vypršela." }, { status: 401 });
  if (!sameOrigin(request)) return NextResponse.json({ message: "Neplatný původ požadavku." }, { status: 403 });
  const body = await request.json().catch(() => null) as EditorBody | null;
  if (!body || !IDENTIFIER.test(body.database ?? "") || !IDENTIFIER.test(body.table ?? "")) return NextResponse.json({ message: "Neplatný databázový objekt." }, { status: 400 });

  try {
    if (body.operation === "create-table" && Array.isArray(body.columns) && body.columns.length > 0 && body.columns.every(validColumn)) {
      return NextResponse.json(execute(body.database!, "create-table", [body.table!, encoded({ columns: body.columns })]));
    }
    if (body.operation === "add-column" && validColumn(body.column)) {
      return NextResponse.json(execute(body.database!, "add-column", [body.table!, encoded(body.column)]));
    }
    if (body.operation === "insert-row" && body.values && typeof body.values === "object" && !Array.isArray(body.values)) {
      return NextResponse.json(execute(body.database!, "insert-row", [body.table!, encoded(body.values)]));
    }
    return NextResponse.json({ message: "Neplatná databázová operace." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  if (!await getSession()) return NextResponse.json({ message: "Relace vypršela." }, { status: 401 });
  if (!sameOrigin(request)) return NextResponse.json({ message: "Neplatný původ požadavku." }, { status: 403 });
  const body = await request.json().catch(() => null) as EditorBody | null;
  if (!body || body.operation !== "update-row" || !IDENTIFIER.test(body.database ?? "") || !IDENTIFIER.test(body.table ?? "") || !ROW_ID.test(body.rowId ?? "") || !body.values || typeof body.values !== "object" || Array.isArray(body.values)) return NextResponse.json({ message: "Neplatná změna záznamu." }, { status: 400 });

  try {
    return NextResponse.json(execute(body.database!, "update-row", [body.table!, body.rowId!, encoded(body.values)]));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  if (!await getSession()) return NextResponse.json({ message: "Relace vypršela." }, { status: 401 });
  if (!sameOrigin(request)) return NextResponse.json({ message: "Neplatný původ požadavku." }, { status: 403 });
  const body = await request.json().catch(() => null) as EditorBody | null;
  if (!body || !IDENTIFIER.test(body.database ?? "") || !IDENTIFIER.test(body.table ?? "")) return NextResponse.json({ message: "Neplatný databázový objekt." }, { status: 400 });

  try {
    if (body.operation === "drop-table") return NextResponse.json(execute(body.database!, "drop-table", [body.table!]));
    if (body.operation === "delete-row" && ROW_ID.test(body.rowId ?? "")) return NextResponse.json(execute(body.database!, "delete-row", [body.table!, body.rowId!]));
    return NextResponse.json({ message: "Neplatná databázová operace." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}