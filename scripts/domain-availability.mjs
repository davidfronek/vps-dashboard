import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const pausedRoot = "/etc/nginx/vps-dashboard-paused";

function configTokens(config) {
  // Tokenize quoted strings and comments so braces in regexes are not treated as blocks.
  return [...config.matchAll(/#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{};]|(?:\\.|[^\s{};#"'\\])+/g)]
    .filter(([token]) => !token.startsWith("#"));
}

export function guardConfig(config, domain) {
  const path = `${pausedRoot}/${domain}/*.conf`;
  const include = `include ${path};`;
  const previous = configTokens(config);
  for (let i = previous.length - 3; i >= 0; i -= 1) {
    if (previous[i][0] !== "include" || previous[i + 1][0].replace(/^(['"])(.*)\1$/, "$2") !== path || previous[i + 2][0] !== ";") continue;
    const index = previous[i].index;
    const lineStart = config.lastIndexOf("\n", index) + 1;
    const start = lineStart > 0 && !config.slice(lineStart, index).trim() ? lineStart - 1 : index;
    config = config.slice(0, start) + config.slice(previous[i + 2].index + 1);
  }
  const tokens = configTokens(config);
  const insertions = [];
  let servers = 0;
  let depth = 0;
  let server = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const [token] = tokens[i];
    if (token === "{") {
      if (depth === 0 && tokens[i - 1]?.[0] === "server") {
        server = { start: tokens[i].index + 1, names: [] };
        servers += 1;
      }
      depth += 1;
    } else if (token === "}") {
      depth -= 1;
      if (depth === 0 && server) {
        if (!server.names.length || server.names.some((name) => name !== domain && name !== `www.${domain}`)) {
          throw new Error("Konfigurace obsahuje jinou doménu nebo nemá server_name.");
        }
        insertions.push(server.start);
        server = null;
      }
    } else if (server && depth === 1 && token === "server_name") {
      while (tokens[++i]?.[0] !== ";") {
        if (!tokens[i]) throw new Error("Neplatná konfigurace server_name.");
        server.names.push(tokens[i][0].replace(/^(['"])(.*)\1$/, "$2"));
      }
    }
  }
  if (depth !== 0 || !servers) throw new Error("Konfigurace neobsahuje platný server blok.");
  for (const index of insertions.reverse()) config = `${config.slice(0, index)}\n    ${include}${config.slice(index)}`;
  return config;
}

export const pausedConfig = `# VPS dashboard: paused
if ($uri !~ "^/\\\\.well-known/acme-challenge/[A-Za-z0-9_-]+$") {
    return 503;
}
location ^~ /.well-known/acme-challenge/ {
    root /var/lib/letsencrypt;
    try_files $uri =404;
}
`;

function atomicWrite(path, content) {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, content, { mode: 0o644 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function changeAvailability(domain, paused) {
  if (domain.replace(/^www\./, "") === "onremote.cz") throw new Error("Správcovskou doménu nelze pozastavit.");
  const originals = new Map();
  for (const name of [domain, `www.${domain}`]) {
    const enabled = `/etc/nginx/sites-enabled/${name}`;
    if (!existsSync(enabled)) continue;
    const path = realpathSync(enabled);
    if (path !== `/etc/nginx/sites-available/${name}` && path !== `/etc/nginx/sites-available/${domain}`) {
      throw new Error(`Nepodporovaná cesta konfigurace: ${enabled}`);
    }
    originals.set(path, readFileSync(path, "utf8"));
  }
  if (!originals.size) throw new Error("Doména nemá aktivní konfiguraci Nginx.");
  const prepared = new Map([...originals].map(([path, config]) => [path, guardConfig(config, domain)]));
  const directory = `${pausedRoot}/${domain}`;
  const state = `${directory}/paused.conf`;
  const previous = existsSync(state) ? readFileSync(state, "utf8") : null;
  mkdirSync(directory, { recursive: true, mode: 0o755 });
  const reload = () => {
    execFileSync("nginx", ["-t"], { stdio: "inherit" });
    execFileSync("systemctl", ["reload", "nginx"], { stdio: "inherit" });
  };
  try {
    for (const [path, config] of prepared) atomicWrite(path, config);
    if (paused) atomicWrite(state, pausedConfig);
    else if (existsSync(state)) unlinkSync(state);
    reload();
  } catch (error) {
    for (const [path, config] of originals) atomicWrite(path, config);
    if (previous !== null) atomicWrite(state, previous);
    else if (existsSync(state)) unlinkSync(state);
    try {
      reload();
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Změna i obnovení konfigurace Nginx selhaly.");
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [action, domain, path] = process.argv.slice(2);
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain ?? "") || !domain.includes(".") || domain.includes("..")) {
    throw new Error("Invalid domain.");
  }
  if (action === "guard" && path) atomicWrite(path, guardConfig(readFileSync(path, "utf8"), domain));
  else if (action === "pause" || action === "resume") changeAvailability(domain, action === "pause");
  else throw new Error("Unsupported availability operation.");
}
