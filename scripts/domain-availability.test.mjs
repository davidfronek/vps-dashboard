import assert from "node:assert/strict";
import { test } from "node:test";
import { guardConfig, pausedConfig } from "./domain-availability.mjs";

test("guards HTTP, HTTPS and www before redirects without altering application routes", () => {
  const config = `server {
    listen 80;
    server_name app.example.cz www.app.example.cz;
    return 301 https://app.example.cz$request_uri;
}
server {
    listen 443 ssl;
    server_name app.example.cz;
    location /api/ { proxy_pass http://127.0.0.1:3001; }
    location / { try_files $uri /index.html; }
}`;
  const guarded = guardConfig(config, "app.example.cz");
  assert.equal(guarded.split("include /etc/nginx/vps-dashboard-paused/app.example.cz/*.conf;").length - 1, 2);
  assert.ok(guarded.indexOf("include ") < guarded.indexOf("return 301"));
  assert.equal(guarded.replaceAll("\n    include /etc/nginx/vps-dashboard-paused/app.example.cz/*.conf;", ""), config);
  assert.equal(guardConfig(guarded, "app.example.cz"), guarded);
});

test("repositions the guard ahead of Certbot redirects without duplicating it", () => {
  const config = `server {
    if ($host = app.example.cz) { return 301 https://$host$request_uri; }
        include "/etc/nginx/vps-dashboard-paused/app.example.cz/*.conf";
    server_name app.example.cz;
}`;
  const guarded = guardConfig(config, "app.example.cz");
  assert.ok(guarded.indexOf("include ") < guarded.indexOf("if ($host"));
  assert.equal(guarded.match(/include /g).length, 1);
});

test("handles quoted braces and comments, rejects shared and unsupported configs", () => {
  assert.doesNotThrow(() => guardConfig(`server {
    # server { ignored
    server_name "app.example.cz";
    location ~ "^/a{2}#b$" { return 404; }
}`, "app.example.cz"));
  assert.throws(() => guardConfig("server { server_name onremote.cz app.example.cz; }", "app.example.cz"), /jinou doménu/);
  assert.throws(() => guardConfig("server { listen 80; }", "app.example.cz"), /server_name/);
  assert.throws(() => guardConfig("# no server", "app.example.cz"), /server blok/);
});

test("only ACME token paths bypass 503 and are served from a dedicated root, not the app", () => {
  const pattern = pausedConfig.match(/if \(\$uri !~ "(.+)"\)/)[1].replaceAll("\\\\", "\\");
  const allowed = new RegExp(pattern);
  assert.ok(allowed.test("/.well-known/acme-challenge/valid_TOKEN-123"));
  for (const uri of ["/", "/api/users", "/index.html", "/.well-known/acme-challenge/", "/xwell-known/acme-challenge/token", "/.well-known/acme-challenge/token/api"]) {
    assert.equal(allowed.test(uri), false, uri);
  }
  assert.match(pausedConfig, /location \^~ \/\.well-known\/acme-challenge\/ \{\s+root \/var\/lib\/letsencrypt;\s+try_files \$uri =404;/);
});
