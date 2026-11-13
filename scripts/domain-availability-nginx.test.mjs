import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { pausedConfig } from "./domain-availability.mjs";

const nginx = process.env.NGINX_BINARY;
const bash = process.env.BASH_BINARY;
const openssl = process.env.OPENSSL_BINARY;
const scripts = dirname(fileURLToPath(import.meta.url));
const nginxPath = (path) => path.replaceAll("\\", "/");

function request(port, path, host = "app.example.cz", tls = false) {
  return new Promise((resolve, reject) => {
    const req = (tls ? https : http).get({
      hostname: "127.0.0.1", port, path, headers: { Host: host, Connection: "close" },
      rejectUnauthorized: false, agent: false, timeout: 2_000,
    }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
  });
}

async function unusedPort() {
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("real Nginx: generated static, proxy and split sites stay paused across deploy and restart", {
  skip: !nginx || !bash || !openssl ? "Set NGINX_BINARY, BASH_BINARY and OPENSSL_BINARY to run the local integration test." : false,
  timeout: 90_000,
}, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "vps-availability-"));
  const prefix = `${nginxPath(directory)}/`;
  const upstream = http.createServer((_req, res) => res.end("application running"));
  let processHandle;
  const args = ["-p", prefix, "-c", "nginx.conf"];
  async function stopNginx() {
    if (!processHandle || processHandle.exitCode !== null) return;
    const exited = once(processHandle, "exit");
    execFileSync(nginx, [...args, "-s", "quit"], { stdio: "pipe" });
    const timer = setTimeout(() => processHandle.kill(), 5_000);
    try { await exited; } finally { clearTimeout(timer); }
  }
  t.after(async () => {
    try { await stopNginx(); } finally {
      await new Promise((resolve) => upstream.close(resolve));
      rmSync(directory, { recursive: true, force: true });
    }
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamPort = upstream.address().port;
  const httpPort = await unusedPort();
  const httpsPort = await unusedPort();
  for (const name of ["logs", "temp", "available", "enabled", "web", "paused/app.example.cz"]) mkdirSync(join(directory, name), { recursive: true });
  writeFileSync(join(directory, "web", "index.html"), "static application");
  writeFileSync(join(directory, "web", "asset.txt"), "static asset");
  execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem"), "-days", "1", "-subj", "/CN=app.example.cz"], { stdio: "pipe" });
  const source = readFileSync(join(scripts, "domain-admin.sh"), "utf8");
  const validation = source.slice(source.indexOf("valid_target() {"), source.indexOf("valid_username() {"));
  const functions = source.slice(source.indexOf("write_proxy_config() {"), source.indexOf("# Direct deployments"));
  const fixture = join(directory, "generate.sh");
  writeFileSync(fixture, `set -Eeuo pipefail
SUBJECT=app.example.cz
NGINX_AVAILABLE="$TEST_ROOT/available"
NGINX_ENABLED="$TEST_ROOT/enabled"
step() { :; }
nginx() { :; }
systemctl() { :; }
run_certbot() { :; }
node() { command node "$GUARD_MODULE" "\${@:2}"; }
${validation}
${functions}
case "$1" in
static) write_static_config 0 1 0 ;;
proxy) write_proxy_config "127.0.0.1:$UPSTREAM_PORT" 0 1 0 ;;
split) write_split_config "127.0.0.1:$UPSTREAM_PORT" 0 1 0 ;;
esac
`);
  function generate(mode) {
    execFileSync(bash, [nginxPath(fixture), mode], { env: {
      ...process.env, TEST_ROOT: nginxPath(directory), GUARD_MODULE: nginxPath(resolve(scripts, "domain-availability.mjs")), UPSTREAM_PORT: String(upstreamPort),
    }, stdio: "pipe" });
    const generated = readFileSync(join(directory, "available", "app.example.cz"), "utf8");
    assert.equal(generated.match(/include \/etc\/nginx\/vps-dashboard-paused\/app\.example\.cz\/\*\.conf;/g)?.length, 2, mode);
    const web = nginxPath(join(directory, "web"));
    const local = generated.replaceAll("server_name app.example.cz;", 'server_name app.example.cz;\nlocation = /.well-known/acme-challenge/validation-token { return 200 "validation"; }')
      .replaceAll("/srv/apps/app.example.cz/client/dist", web).replaceAll("/srv/apps/app.example.cz", web)
      .replaceAll("/etc/nginx/vps-dashboard-paused", nginxPath(join(directory, "paused"))).replaceAll("listen [::]:80;", "");
    const tls = local.replaceAll("listen 80;", `listen 127.0.0.1:${httpsPort} ssl;\nssl_certificate "${prefix}cert.pem";\nssl_certificate_key "${prefix}key.pem";`);
    const plain = local.replaceAll("listen 80;", `listen 127.0.0.1:${httpPort};`);
    writeFileSync(join(directory, "nginx.conf"), `worker_processes 1;
error_log logs/error.log notice;
pid logs/nginx.pid;
events { worker_connections 64; }
http {
${plain}
${tls}
server { listen 127.0.0.1:${httpPort}; server_name other.example.cz; location / { return 200 "unaffected"; } }
}`);
    execFileSync(nginx, [...args, "-t"], { stdio: "pipe" });
  }
  async function waitForStatus(expected) {
    let last;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        last = await request(httpPort, "/");
        if (last === expected) return;
      } catch (error) { last = error.message; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail(`Expected ${expected}, got ${last}\n${readFileSync(join(directory, "logs", "error.log"), "utf8")}`);
  }
  async function startNginx(expected) {
    processHandle = spawn(nginx, args, { stdio: "ignore" });
    await waitForStatus(expected);
  }
  async function reload(expected) {
    execFileSync(nginx, [...args, "-t"], { stdio: "pipe" });
    execFileSync(nginx, [...args, "-s", "reload"], { stdio: "pipe" });
    await waitForStatus(expected);
  }
  const state = join(directory, "paused", "app.example.cz", "paused.conf");
  for (const mode of ["static", "proxy", "split"]) {
    generate(mode);
    if (processHandle) await reload(200);
    else await startNginx(200);
    writeFileSync(state, pausedConfig);
    await reload(503);
    for (const host of ["app.example.cz", "www.app.example.cz"]) {
      for (const path of ["/", "/asset.txt", "/api/users"]) {
        assert.equal(await request(httpPort, path, host), 503, `${mode} HTTP ${host}${path}`);
        assert.equal(await request(httpsPort, path, host, true), 503, `${mode} HTTPS ${host}${path}`);
      }
    }
    assert.equal(await request(httpPort, "/.well-known/acme-challenge/nonexistent-token"), 404);
    assert.equal(await request(httpPort, "/.well-known/acme-challenge/validation-token"), 200);
    assert.equal(await request(httpsPort, "/.well-known/acme-challenge/validation-token", "app.example.cz", true), 200);
    assert.equal(await request(httpPort, "/", "other.example.cz"), 200);
    assert.equal(await request(upstreamPort, "/"), 200);
    generate(mode);
    await reload(503);
    await stopNginx();
    await startNginx(503);
    unlinkSync(state);
    await reload(200);
    assert.equal(await request(httpsPort, "/", "app.example.cz", true), 200);
  }
});
