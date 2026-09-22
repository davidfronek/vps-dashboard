import "server-only";

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statfsSync } from "node:fs";
import { networkInterfaces, cpus, freemem, hostname, loadavg, platform, release, totalmem, uptime } from "node:os";
import { parse } from "node:path";

export type Metric = {
  label: string;
  value: string;
  detail: string;
  tone: "blue" | "green" | "amber" | "violet";
};

export type ServiceStatus = {
  name: string;
  detail: string;
  state: "Online" | "V pořádku" | "Nedostupné";
};

export type DomainStatus = {
  name: string;
  target: string;
  ssl: "Aktivní" | "Neaktivní";
  status: "Online" | "Nedostupné" | "Přesměrování";
  automaticSsl: boolean;
  forceHttps: boolean;
  wwwRedirect: boolean;
  deployment?: {
    repository: string;
    branch: string;
    port: number;
  };
};

export type DatabaseCluster = {
  name: string;
  version: string;
  port: number;
  owner: string;
  size: string;
  status: "Online" | "Neaktivní";
  managed: boolean;
};

export type SystemUser = {
  username: string;
  uid: number;
  home: string;
  shell: string;
  sshKeys: number | null;
  managed: boolean;
  status: "Aktivní" | "Blokovaný";
};

export type ServerSnapshot = {
  collectedAt: string;
  metrics: Metric[];
  services: ServiceStatus[];
  domains: DomainStatus[];
  databases: DatabaseCluster[];
  users: SystemUser[];
  server: {
    ipAddress: string;
    operatingSystem: string;
    virtualization: string;
    uptime: string;
    hostname: string;
    kernel: string;
  };
};

function run(command: string, args: string[] = []) {
  try {
    return execFileSync(command, args, { encoding: "utf8", timeout: 2_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function formatBytes(value: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} ${units[unit]}`;
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return days > 0 ? `${days} d ${hours} h` : `${hours} h ${minutes} min`;
}

function readOperatingSystem() {
  try {
    const values = Object.fromEntries(readFileSync("/etc/os-release", "utf8").split("\n").map((line) => line.split("=", 2)).filter((entry) => entry.length === 2));
    return (values.PRETTY_NAME ?? `${platform()} ${release()}`).replace(/^"|"$/g, "");
  } catch {
    return `${platform()} ${release()}`;
  }
}

function readVirtualization() {
  try {
    return readFileSync("/sys/class/dmi/id/product_name", "utf8").trim() || "Nezjištěno";
  } catch {
    return "Nezjištěno";
  }
}

function readIpAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    const address = addresses?.find((entry) => entry.family === "IPv4" && !entry.internal);
    if (address) return address.address;
  }
  return "Nezjištěna";
}

function serviceState(unit: string) {
  return run("systemctl", ["is-active", unit]) === "active";
}

function readDomains(): DomainStatus[] {
  if (platform() !== "linux") return [];

  try {
    const files = readdirSync("/etc/nginx/sites-enabled");
    const domains = new Map<string, DomainStatus>();
    for (const file of files) {
      const config = readFileSync(`/etc/nginx/sites-enabled/${file}`, "utf8");
      const names = [...config.matchAll(/server_name\s+([^;]+);/g)].flatMap((match) => match[1].trim().split(/\s+/));
      const target = config.match(/proxy_pass\s+https?:\/\/([^;]+);/)?.[1] ?? "Přesměrování";
      const hasTls = /listen\s+(?:\[[^\]]+\]:)?443\s+ssl/.test(config);
      const redirectsToHttps = /return\s+30[1278]\s+https:\/\//.test(config);
      const listening = target === "Přesměrování" || run("sh", ["-c", `ss -ltnH | grep -q ':${target.split(":").at(-1)} ' && echo yes`]) === "yes";

      for (const name of names.filter((value) => value !== "_" && !value.includes("$"))) {
        let deployment: DomainStatus["deployment"];
        try {
          const [repository, branch, port] = readFileSync(`/var/lib/vps-dashboard/apps/${name.replace(/^www\./, "")}`, "utf8").trim().split("\t");
          if (repository && branch && Number.isInteger(Number(port))) deployment = { repository, branch, port: Number(port) };
        } catch {}
        domains.set(name, {
          name,
          target,
          ssl: hasTls ? "Aktivní" : "Neaktivní",
          status: target === "Přesměrování" ? "Přesměrování" : listening ? "Online" : "Nedostupné",
          automaticSsl: config.includes("managed by Certbot") || config.includes("/etc/letsencrypt/"),
          forceHttps: redirectsToHttps,
          wwwRedirect: name.startsWith("www.") && target === "Přesměrování",
          deployment,
        });
      }
    }
    return [...domains.values()].sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

function readDatabases(): DatabaseCluster[] {
  return run("pg_lsclusters", ["--no-header"]).split("\n").filter(Boolean).flatMap((line) => {
    const [version, name, port, status, owner, dataDirectory] = line.trim().split(/\s+/);
    if (!version || !name || !port || !status || !owner) return [];
    const size = dataDirectory ? run("du", ["-sh", dataDirectory]).split(/\s+/)[0] : "";
    return [{ name, version, port: Number(port), owner, size: size || "Nezjištěno", status: status === "online" ? "Online" as const : "Neaktivní" as const, managed: existsSync(`/var/lib/vps-dashboard/clusters/${version}-${name}`) }];
  });
}

function readUsers(): SystemUser[] {
  try {
    return readFileSync("/etc/passwd", "utf8").split("\n").filter(Boolean).flatMap((line) => {
      const [username, , uidText, , , home, shell] = line.split(":");
      const uid = Number(uidText);
      if (!username || !Number.isFinite(uid) || (uid !== 0 && uid < 1000) || !shell) return [];
      const blocked = shell.endsWith("/nologin") || shell.endsWith("/false");
      let sshKeys: number | null = null;
      try {
        sshKeys = readFileSync(`${home}/.ssh/authorized_keys`, "utf8").split("\n").filter((entry) => entry.trim() && !entry.trim().startsWith("#")).length;
      } catch {}
      return [{ username, uid, home, shell, sshKeys, status: blocked ? "Blokovaný" as const : "Aktivní" as const, managed: existsSync(`/var/lib/vps-dashboard/users/${username}`) }];
    });
  } catch {
    return [];
  }
}

export function getServerSnapshot(): ServerSnapshot {
  const cpuCount = cpus().length;
  const loadPercent = Math.min(999, Math.round((loadavg()[0] / Math.max(cpuCount, 1)) * 100));
  const totalMemory = totalmem();
  const usedMemory = totalMemory - freemem();
  const diskRoot = platform() === "win32" ? parse(process.cwd()).root : "/";
  const disk = statfsSync(diskRoot, { bigint: true });
  const diskTotal = Number(disk.blocks * disk.bsize);
  const diskUsed = diskTotal - Number(disk.bavail * disk.bsize);
  const failedUnits = run("systemctl", ["--failed", "--no-legend", "--plain"]).split("\n").filter(Boolean).length;
  const nginxOnline = serviceState("nginx");
  const postgresOnline = serviceState("postgresql");
  const appOnline = serviceState("vps-app-onremote-cz");

  return {
    collectedAt: new Date().toISOString(),
    metrics: [
      { label: "Zátěž CPU", value: `${loadPercent} %`, detail: `${cpuCount} vCPU · 1 min`, tone: "blue" },
      { label: "Operační paměť", value: formatBytes(usedMemory), detail: `z ${formatBytes(totalMemory)}`, tone: "green" },
      { label: "Kořenový disk", value: formatBytes(diskUsed), detail: `z ${formatBytes(diskTotal)}`, tone: "amber" },
      { label: "Doba provozu", value: formatUptime(uptime()), detail: "od posledního startu", tone: "violet" },
    ],
    services: [
      { name: "Systémové služby", detail: failedUnits === 0 ? "Žádné selhané systemd jednotky" : `${failedUnits} selhaných jednotek`, state: failedUnits === 0 ? "V pořádku" : "Nedostupné" },
      { name: "Nginx", detail: nginxOnline ? "Reverzní proxy je aktivní" : "Služba není aktivní", state: nginxOnline ? "Online" : "Nedostupné" },
      { name: "PostgreSQL", detail: postgresOnline ? "Databázová služba je aktivní" : "Služba není aktivní", state: postgresOnline ? "Online" : "Nedostupné" },
      { name: "Next.js aplikace", detail: appOnline ? "systemd služba vps-app-onremote-cz běží" : "Služba není aktivní", state: appOnline ? "Online" : "Nedostupné" },
    ],
    domains: readDomains(),
    databases: readDatabases(),
    users: readUsers(),
    server: {
      ipAddress: readIpAddress(),
      operatingSystem: readOperatingSystem(),
      virtualization: readVirtualization(),
      uptime: formatUptime(uptime()),
      hostname: hostname(),
      kernel: release(),
    },
  };
}