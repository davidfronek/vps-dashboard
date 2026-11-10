import { readFile } from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import sodium from "libsodium-wrappers";
import { getSession } from "@/lib/auth";

const DOMAIN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const REPOSITORY = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const WORKFLOW_PATH = ".github/workflows/deploy.yml";
const DEPLOY_KEY_FILE = process.env.DEPLOY_SSH_KEY_FILE ?? "/var/lib/vps-dashboard/deploy-key";

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

async function deploySecretValues() {
  const privateKey = await readFile(DEPLOY_KEY_FILE, "utf8").catch(() => null);
  if (!privateKey) return null;
  return {
    SSH_HOST: process.env.DEPLOY_SSH_HOST ?? "46.28.108.112",
    SSH_USER: process.env.DEPLOY_SSH_USER ?? "root",
    SSH_PORT: process.env.DEPLOY_SSH_PORT ?? "22",
    SSH_PRIVATE_KEY: privateKey,
  };
}

async function setRepositorySecrets(token: string, owner: string, repo: string) {
  const values = await deploySecretValues();
  if (!values) {
    console.error(`Deploy key file ${DEPLOY_KEY_FILE} is missing; repository secrets were not set`);
    return false;
  }
  const keyResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/public-key`, { headers: githubHeaders(token) });
  if (!keyResponse.ok) {
    console.error(`GitHub API returned ${keyResponse.status} when reading the secrets public key`);
    return false;
  }
  const { key_id: keyId, key } = await keyResponse.json() as { key_id: string; key: string };
  await sodium.ready;
  const publicKey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
  for (const [name, value] of Object.entries(values)) {
    const encrypted = sodium.to_base64(sodium.crypto_box_seal(sodium.from_string(value), publicKey), sodium.base64_variants.ORIGINAL);
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/${name}`, {
      method: "PUT",
      headers: githubHeaders(token),
      body: JSON.stringify({ encrypted_value: encrypted, key_id: keyId }),
    });
    if (!response.ok) {
      console.error(`GitHub API returned ${response.status} when setting the ${name} secret`);
      return false;
    }
  }
  return true;
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
    const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: githubHeaders(token) });
    if (!repoResponse.ok) throw new Error(`GitHub API returned ${repoResponse.status} when reading the repository`);
    const { private: isPrivate } = await repoResponse.json() as { private: boolean };

    // Org secrets nejsou na Free plánu dostupné privátním repozitářům, proto se kopírují na úroveň repa.
    const secretsSet = isPrivate ? await setRepositorySecrets(token, owner, repo) : null;

    const existing = await fetch(`${fileUrl}?ref=${encodeURIComponent(body.branch)}`, { headers: githubHeaders(token) });
    if (existing.ok) return NextResponse.json({ created: false, secretsSet });
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
    return NextResponse.json({ created: true, secretsSet });
  } catch (error) {
    console.error("Failed to create deploy workflow", error instanceof Error ? error.message : error);
    return NextResponse.json({ message: "Deploy workflow se nepodařilo v repozitáři vytvořit." }, { status: 502 });
  }
}
