import { execFileSync } from "node:child_process";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import type { AdminJob, AdminJobStep } from "@/lib/admin-job-types";

const HELPER = "/usr/local/sbin/vps-dashboard-domains";

function parseJob(id: string, output: string): AdminJob {
  let status: AdminJob["status"] = "queued";
  let title = "Správa serveru";
  let message = "";
  const labels: string[] = [];

  for (const line of output.split("\n")) {
    const separator = line.indexOf("|");
    if (separator < 0) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (key === "STATUS" && ["queued", "running", "succeeded", "failed"].includes(value)) status = value as AdminJob["status"];
    if (key === "TITLE") title = value;
    if (key === "MESSAGE") message = value;
    if (key === "STEP") labels.push(value);
  }

  const steps: AdminJobStep[] = labels.map((label, index) => ({
    label,
    state: status === "failed" && index === labels.length - 1 ? "failed" : status === "running" && index === labels.length - 1 ? "running" : "done",
  }));
  return { id, status, title, message, steps };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await getSession()) return NextResponse.json({ message: "Relace vypršela." }, { status: 401 });
  const { id } = await context.params;
  if (!/^[a-f0-9]{32}$/.test(id)) return NextResponse.json({ message: "Neplatné ID operace." }, { status: 400 });

  try {
    const output = execFileSync("sudo", ["-n", HELPER, "status", id], { encoding: "utf8", timeout: 2_000, stdio: ["ignore", "pipe", "pipe"] });
    return NextResponse.json(parseJob(id, output), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Stav operace je dočasně nedostupný." }, { status: 503 });
  }
}