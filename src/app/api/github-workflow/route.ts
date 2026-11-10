import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";

const DOMAIN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const REPOSITORY = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const WORKFLOW_PATH = ".github/workflows/deploy.yml";

type WorkflowRequest = {
  domain?: unknown;
  repository?: unknown;
  branch?: unknown;
  port?: unknown;
};
type ValidWorkflowRequest = { domain: string; repository: string; branch: string; port: string };

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

function validRequest(body: WorkflowRequest): body is WorkflowRequest & ValidWorkflowRequest {
  return typeof body.domain === "string"
    && DOMAIN.test(body.domain)
    && body.domain.includes(".")
    && !body.domain.includes("..")
    && typeof body.repository === "string"
    && REPOSITORY.test(body.repository)
    && typeof body.branch === "string"
    && BRANCH.test(body.branch)
    && typeof body.port === "string"
    && /^[0-9]+$/.test(body.port)
    && Number(body.port) >= 1024
    && Number(body.port) <= 65535;
}

function workflowContent(owner: string, { domain, branch, port }: ValidWorkflowRequest) {
  return [
    "name: Deploy",
    "",
    "on:",
    "  push:",
    `    branches: [${branch}]`,
    "  workflow_dispatch:",
    "",
    "permissions:",
    "  contents: read",
    "",
    "jobs:",
    "  deploy:",
    `    uses: ${owner}/.github/.github/workflows/deploy-vps-reusable.yml@main`,
    "    with:",
    `      domain: ${domain}`,
    `      port: "${port}"`,
    `      branch: ${branch}`,
    "      health_path: /",
    "    secrets: inherit",
    "",
  ].join("\n");
}

function githubHeaders(token: string) {
  return {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "vps-dashboard",
    "Content-Type": "application/json",
  };
}

export async function POST(request: NextRequest) {
  if (!await getSession()) return NextResponse.json({ message: "Relace vypršela." }, { status: 401 });
  if (!sameOrigin(request)) return NextResponse.json({ message: "Neplatný původ požadavku." }, { status: 403 });

  const body = await request.json().catch(() => null) as WorkflowRequest | null;
  if (!body || !validRequest(body)) return NextResponse.json({ message: "Neplatné údaje pro deploy workflow." }, { status: 400 });

  const token = process.env.GITHUB_DEPLOY_TOKEN;
  if (!token) return NextResponse.json({ message: "Na serveru není nastavena proměnná GITHUB_DEPLOY_TOKEN." }, { status: 503 });

  const [, owner, repo] = REPOSITORY.exec(body.repository)!;
  const fileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${WORKFLOW_PATH}`;
  try {
    const existing = await fetch(`${fileUrl}?ref=${encodeURIComponent(body.branch)}`, { headers: githubHeaders(token) });
    if (existing.ok) return NextResponse.json({ created: false });
    if (existing.status !== 404) throw new Error(`GitHub API returned ${existing.status} when checking ${WORKFLOW_PATH}`);

    const response = await fetch(fileUrl, {
      method: "PUT",
      headers: githubHeaders(token),
      body: JSON.stringify({
        message: `Add automatic deploy workflow for ${body.domain}`,
        content: Buffer.from(workflowContent(owner, body), "utf8").toString("base64"),
        branch: body.branch,
      }),
    });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status} when creating ${WORKFLOW_PATH}`);
    return NextResponse.json({ created: true });
  } catch (error) {
    console.error("Failed to create deploy workflow", error instanceof Error ? error.message : error);
    return NextResponse.json({ message: "Deploy workflow se nepodařilo v repozitáři vytvořit." }, { status: 502 });
  }
}
