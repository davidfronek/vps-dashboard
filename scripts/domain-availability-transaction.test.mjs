import assert from "node:assert/strict";
import { mock, test } from "node:test";

const domain = "app.example.cz";
const configPath = `/etc/nginx/sites-available/${domain}`;
const statePath = `/etc/nginx/vps-dashboard-paused/${domain}/paused.conf`;
const initialConfig = `server { server_name ${domain}; location / { proxy_pass http://127.0.0.1:3001; } }`;
const files = new Map();
const calls = [];
let failures = 0;
let failCommand = "nginx";

mock.module("node:fs", { namedExports: {
  existsSync: (path) => files.has(path),
  mkdirSync: () => {},
  readFileSync: (path) => {
    if (!files.has(path)) throw new Error(`Missing file: ${path}`);
    return files.get(path);
  },
  realpathSync: (path) => path.replace("sites-enabled", "sites-available"),
  renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from); },
  unlinkSync: (path) => files.delete(path),
  writeFileSync: (path, content) => files.set(path, content),
} });
mock.module("node:child_process", { namedExports: {
  execFileSync: (command, args) => {
    calls.push([command, ...args]);
    if (failures > 0 && command === failCommand) { failures -= 1; throw new Error("Nginx failed"); }
  },
} });
const { changeAvailability, guardConfig } = await import("./domain-availability.mjs");

function reset() {
  files.clear();
  files.set(`/etc/nginx/sites-enabled/${domain}`, "");
  files.set(configPath, initialConfig);
  calls.length = 0;
  failures = 0;
  failCommand = "nginx";
}

test("pause persists through regenerated config, resume preserves routes and never stops the app", () => {
  reset();
  changeAvailability(domain, true);
  assert.ok(files.has(statePath));
  const guarded = files.get(configPath);
  files.set(configPath, guardConfig(initialConfig, domain));
  assert.equal(files.get(configPath), guarded);
  assert.ok(files.has(statePath));
  changeAvailability(domain, true);
  assert.equal(files.get(configPath), guarded);
  changeAvailability(domain, false);
  assert.equal(files.has(statePath), false);
  assert.equal(files.get(configPath), guarded);
  assert.deepEqual(calls, Array.from({ length: 3 }, () => [["nginx", "-t"], ["systemctl", "reload", "nginx"]]).flat());
});

test("failed pause or resume restores both config and prior availability", () => {
  for (const command of ["nginx", "systemctl"]) {
    reset();
    failCommand = command;
    failures = 1;
    assert.throws(() => changeAvailability(domain, true), /Nginx failed/);
    assert.equal(files.get(configPath), initialConfig);
    assert.equal(files.has(statePath), false);
    changeAvailability(domain, true);
    const previous = files.get(statePath);
    failures = 1;
    assert.throws(() => changeAvailability(domain, false), /Nginx failed/);
    assert.equal(files.get(statePath), previous);
    assert.equal(files.get(configPath), guardConfig(initialConfig, domain));
  }
});

test("rollback failure is explicit; protected and shared domains are unchanged", () => {
  reset();
  failures = 2;
  assert.throws(() => changeAvailability(domain, true), AggregateError);
  reset();
  assert.throws(() => changeAvailability("onremote.cz", true), /Správcovskou/);
  assert.throws(() => changeAvailability("www.onremote.cz", true), /Správcovskou/);
  files.set(configPath, "server { server_name onremote.cz; }");
  assert.throws(() => changeAvailability(domain, true), /jinou doménu/);
  assert.equal(files.has(statePath), false);
  assert.equal(calls.length, 0);
});
