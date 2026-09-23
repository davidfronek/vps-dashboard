import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import type { AdminJobRequest, AdminOperation } from "@/lib/admin-job-types";

const HELPER = "/usr/local/sbin/vps-dashboard-domains";
const DOMAIN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const REPOSITORY = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const USERNAME = /^[a-z_][a-z0-9_-]{0,30}$/;
const SSH_KEY = /^ssh-(?:ed25519|rsa) [A-Za-z0-9+/=]+(?: .*)?$/;
const DATABASE_NAME = /^[a-z][a-z0-9_]{0,62}$/;
const OPERATIONS = new Set<AdminOperation>([
  "domain-upsert", "domain-deploy", "domain-renew", "domain-delete",
  "user-create", "user-update", "user-delete",
  "database-create", "database-delete",
]);

function validFlag(value: string) {
  return value === "0" || value === "1";
}

function validPort(value: string) {
  return /^[0-9]+$/.test(value) && Number(value) >= 1024 && Number(value) <= 65535;
}

function validRequest(value: unknown): value is AdminJobRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as AdminJobRequest;
  if (!OPERATIONS.has(request.operation) || !Array.isArray(request.arguments) || !request.arguments.every((argument) => typeof argument === "string")) return false;
  const [subject, ...args] = request.arguments;
  if (request.operation.startsWith("domain-")) {
    if (!subject || !DOMAIN.test(subject) || !subject.includes(".") || subject.includes("..")) return false;
    if (request.operation === "domain-upsert") return args.length === 3 && args.every(validFlag);
    if (request.operation === "domain-deploy") return args.length === 6 && REPOSITORY.test(args[0]) && BRANCH.test(args[1]) && validPort(args[2]) && args.slice(3).every(validFlag);
    return args.length === 0;
  }
  if (request.operation.startsWith("user-")) {
    if (!subject || !USERNAME.test(subject)) return false;
    if (request.operation === "user-create") return args.length === 1 && SSH_KEY.test(args[0]);
    if (request.operation === "user-update") return args.length === 1 && validFlag(args[0]);
    return args.length === 0;
  }
  if (!subject || !DATABASE_NAME.test(subject)) return false;
  if (request.operation === "database-create") return args.length === 3 && DATABASE_NAME.test(args[0]) && DATABASE_NAME.test(args[1]) && args[2].length >= 12 && args[2].length <= 128;
  return request.operation === "database-delete" && args.length === 0;
}

export async function POST(request: NextRequest) {
  if (!await getSession()) return NextResponse.json({ message: "Relace vypršela." }, { status: 401 });
  const origin = request.headers.get("origin");
  try {
    if (origin && new URL(origin).host !== request.headers.get("host")) return NextResponse.json({ message: "Neplatný původ požadavku." }, { status: 403 });
  } catch {
    return NextResponse.json({ message: "Neplatný původ požadavku." }, { status: 403 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!validRequest(body)) return NextResponse.json({ message: "Neplatné údaje operace." }, { status: 400 });

  const id = randomBytes(16).toString("hex");
  try {
    const helperArguments = body.operation === "database-create" ? body.arguments.slice(0, -1) : body.arguments;
    const input = body.operation === "database-create" ? `${body.arguments.at(-1)}\n` : undefined;
    execFileSync("sudo", ["-n", HELPER, "enqueue", id, body.operation, ...helperArguments], { encoding: "utf8", input, timeout: 5_000, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    return NextResponse.json({ id }, { status: 202 });
  } catch (error) {
    console.error("Failed to enqueue admin job", error instanceof Error ? error.message : error);
    return NextResponse.json({ message: "Operaci se nepodařilo zařadit." }, { status: 500 });
  }
}