"use server";

import { execFileSync } from "node:child_process";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";

const HELPER = "/usr/local/sbin/vps-dashboard-domains";
const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const TARGET_PATTERN = /^(?:127\.0\.0\.1|localhost|\[::1\]):(?:[0-9]{4,5})$/;
const REPOSITORY_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export type DomainActionResult = { ok: boolean; message: string };
type DomainOptions = { domain: string; forceHttps: boolean; wwwRedirect: boolean; automaticSsl: boolean };

function validateDomain(domain: string) {
  return domain.includes(".") && !domain.includes("..") && DOMAIN_PATTERN.test(domain);
}

async function execute(args: string[], successMessage: string): Promise<DomainActionResult> {
  if (!await getSession()) return { ok: false, message: "Relace vypršela. Přihlaste se znovu." };
  try {
    execFileSync("sudo", ["-n", HELPER, ...args], { encoding: "utf8", timeout: 10 * 60 * 1000, stdio: ["ignore", "pipe", "pipe"] });
    revalidatePath("/");
    return { ok: true, message: successMessage };
  } catch (error) {
    console.error("Domain operation failed", error instanceof Error ? error.message : "Unknown error");
    return { ok: false, message: "Operace na serveru selhala. Zkontrolujte Nginx, DNS a systémový log." };
  }
}

export async function upsertDomain(options: DomainOptions & { target: string }) {
  const domain = options.domain.trim().toLowerCase();
  const target = options.target.trim();
  if (!validateDomain(domain) || !TARGET_PATTERN.test(target)) return { ok: false, message: "Doména nebo lokální cíl není platný." };
  return execute(["upsert", domain, target, Number(options.forceHttps).toString(), Number(options.wwwRedirect).toString(), Number(options.automaticSsl).toString()], `Konfigurace ${domain} byla uložena.`);
}

export async function deployDomain(options: DomainOptions & { repository: string; branch: string; port: number }) {
  const domain = options.domain.trim().toLowerCase();
  const repository = options.repository.trim();
  const branch = options.branch.trim();
  if (!validateDomain(domain) || !REPOSITORY_PATTERN.test(repository) || !BRANCH_PATTERN.test(branch) || !Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    return { ok: false, message: "Údaje pro nasazení nejsou platné." };
  }
  return execute(["deploy", domain, repository, branch, String(options.port), Number(options.forceHttps).toString(), Number(options.wwwRedirect).toString(), Number(options.automaticSsl).toString()], `Aplikace ${domain} byla nasazena.`);
}

export async function renewDomainCertificate(domainValue: string) {
  const domain = domainValue.trim().toLowerCase();
  if (!validateDomain(domain)) return { ok: false, message: "Doména není platná." };
  return execute(["renew", domain], `Certifikát pro ${domain} byl obnoven.`);
}

export async function deleteDomainFromServer(domainValue: string) {
  const domain = domainValue.trim().toLowerCase();
  if (!validateDomain(domain) || domain === "onremote.cz") return { ok: false, message: "Správcovskou doménu onremote.cz nelze odstranit z dashboardu." };
  return execute(["delete", domain], `Doména ${domain}, její služba a data byly odstraněny.`);
}