import { execFileSync } from "node:child_process";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";

const HELPER = "/usr/local/sbin/vps-dashboard-domains";
const DOMAIN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

type EnvironmentRequest = {
  domain?: unknown;
  key?: unknown;
  value?: unknown;
};
type ValidEnvironmentTarget = EnvironmentRequest & { domain: string; key: string };

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

function validTarget(body: EnvironmentRequest): body is ValidEnvironmentTarget {
  return typeof body.domain === "string"
    && DOMAIN.test(body.domain)
    && body.domain.includes(".")
    && !body.domain.includes("..")
    && typeof body.key === "string"
    && KEY.test(body.key);
}

async function authorize(request: NextRequest) {
  if (!await getSession()) return NextResponse.json({ message: "Relace vypršela." }, { status: 401 });
  if (!sameOrigin(request)) return NextResponse.json({ message: "Neplatný původ požadavku." }, { status: 403 });
  return null;
}

export async function POST(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;
  const body = await request.json().catch(() => null) as EnvironmentRequest | null;
  if (!body || !validTarget(body) || typeof body.value !== "string" || body.value.length > 8192 || /[\r\n\0]/.test(body.value)) {
    return NextResponse.json({ message: "Neplatná proměnná prostředí." }, { status: 400 });
  }
  try {
    execFileSync("sudo", ["-n", HELPER, "domain-env-set", body.domain, body.key], {
      encoding: "utf8",
      input: `${body.value}\n`,
      timeout: 15_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to set domain environment variable", error instanceof Error ? error.message : error);
    return NextResponse.json({ message: "Proměnnou se nepodařilo uložit." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;
  const body = await request.json().catch(() => null) as EnvironmentRequest | null;
  if (!body || !validTarget(body)) return NextResponse.json({ message: "Neplatná proměnná prostředí." }, { status: 400 });
  try {
    execFileSync("sudo", ["-n", HELPER, "domain-env-delete", body.domain, body.key], {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete domain environment variable", error instanceof Error ? error.message : error);
    return NextResponse.json({ message: "Proměnnou se nepodařilo odstranit." }, { status: 500 });
  }
}
