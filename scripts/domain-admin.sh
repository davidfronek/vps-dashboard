#!/usr/bin/env bash
set -Eeuo pipefail

[[ $EUID -eq 0 ]] || { echo "Root privileges are required." >&2; exit 1; }

ACTION="${1:-}"
SUBJECT="${2:-}"
NGINX_AVAILABLE="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"
STATE_DIR="/var/lib/vps-dashboard"
JOB_DIR="$STATE_DIR/jobs"
APP_STATE_DIR="$STATE_DIR/apps"
USER_STATE_DIR="$STATE_DIR/users"
DATABASE_STATE_DIR="$STATE_DIR/databases"
LOCK_DIR="$STATE_DIR/locks"

job_line() {
  [[ -n ${JOB_FILE:-} ]] || return 0
  printf '%s|%s\n' "$1" "$2" >> "$JOB_FILE"
}

step() {
  job_line STEP "$1"
}

job_title() {
  case "$1" in
    domain-upsert) echo "Konfigurace domény $2" ;;
    domain-deploy) echo "Nasazení aplikace $2" ;;
    domain-renew) echo "Obnova SSL certifikátu $2" ;;
    domain-delete) echo "Odstranění domény $2" ;;
    user-create) echo "Vytvoření uživatele $2" ;;
    user-update) echo "Změna přístupu uživatele $2" ;;
    user-delete) echo "Odstranění uživatele $2" ;;
    database-create) echo "Vytvoření PostgreSQL databáze $2" ;;
    database-delete) echo "Odstranění PostgreSQL databáze $2" ;;
    *) echo "Správa serveru" ;;
  esac
}

if [[ $ACTION == "status" ]]; then
  JOB_ID="$SUBJECT"
  [[ $JOB_ID =~ ^[a-f0-9]{32}$ ]] || exit 1
  cat "$JOB_DIR/$JOB_ID"
  exit
fi

if [[ $ACTION == "database-list" ]]; then
  runuser -u postgres -- psql --dbname postgres --no-align --tuples-only --field-separator=$'\t' --command="SELECT d.datname, pg_get_userbyid(d.datdba), pg_size_pretty(pg_database_size(d.datname)), (SELECT count(*) FROM pg_stat_activity a WHERE a.datname = d.datname) FROM pg_database d WHERE NOT d.datistemplate ORDER BY d.datname"
  exit
fi

if [[ $ACTION == "domain-env-set" || $ACTION == "domain-env-delete" ]]; then
  DOMAIN="$SUBJECT"
  KEY="${3:-}"
  [[ $DOMAIN =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ && $DOMAIN == *.* && $DOMAIN != *..* ]] || { echo "Invalid domain." >&2; exit 1; }
  [[ $KEY =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "Invalid environment variable name." >&2; exit 1; }
  [[ -f $APP_STATE_DIR/$DOMAIN ]] || { echo "Domain is not a managed deployment." >&2; exit 1; }
  install -d -o root -g www-data -m 0750 "$APP_STATE_DIR"
  ENV_FILE="$APP_STATE_DIR/$DOMAIN.env"
  TEMP_FILE="$(mktemp "$APP_STATE_DIR/.${DOMAIN}.env.XXXXXX")"
  trap 'rm -f "$TEMP_FILE"' EXIT
  VALUE=""
  if [[ $ACTION == "domain-env-set" ]]; then
    IFS= read -r VALUE || [[ -n $VALUE ]]
    ((${#VALUE} <= 8192)) || { echo "Environment variable value is too long." >&2; exit 1; }
  fi
  ENV_FILE="$ENV_FILE" TEMP_FILE="$TEMP_FILE" KEY="$KEY" VALUE="$VALUE" ACTION="$ACTION" node <<'NODE'
const fs = require("node:fs");
const { ACTION, ENV_FILE, KEY, TEMP_FILE, VALUE } = process.env;
const lines = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/) : [];
const prefix = `${KEY}=`;
const next = lines.filter((line) => line && !line.startsWith(prefix));
if (ACTION === "domain-env-set") {
  const escaped = VALUE.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  next.push(`${KEY}="${escaped}"`);
}
fs.writeFileSync(TEMP_FILE, next.length ? `${next.join("\n")}\n` : "");
NODE
  install -o root -g www-data -m 0640 "$TEMP_FILE" "$ENV_FILE"
  rm -f "$TEMP_FILE"
  trap - EXIT
  systemctl restart "vps-app-${DOMAIN//./-}"
  systemctl is-active --quiet "vps-app-${DOMAIN//./-}"
  exit
fi

if [[ $ACTION == "enqueue" ]]; then
  JOB_ID="$SUBJECT"
  OPERATION="${3:-}"
  shift 3
  [[ $JOB_ID =~ ^[a-f0-9]{32}$ ]] || { echo "Invalid job id." >&2; exit 1; }
  [[ $OPERATION =~ ^(domain-(upsert|deploy|renew|delete)|user-(create|update|delete)|database-(create|delete))$ ]] || { echo "Unsupported operation." >&2; exit 1; }
  install -d -o root -g www-data -m 0750 "$JOB_DIR" "$APP_STATE_DIR" "$USER_STATE_DIR" "$DATABASE_STATE_DIR" "$LOCK_DIR"
  find "$JOB_DIR" -type f -mtime +7 -delete
  JOB_FILE="$JOB_DIR/$JOB_ID"
  install -o root -g www-data -m 0640 /dev/null "$JOB_FILE"
  job_line STATUS queued
  job_line TITLE "$(job_title "$OPERATION" "${1:-}" "${2:-}")"
  if [[ $OPERATION == database-create ]]; then
    SECRET_FILE="$JOB_DIR/$JOB_ID.secret"
    IFS= read -r PASSWORD || [[ -n $PASSWORD ]]
    install -o root -g root -m 0600 /dev/null "$SECRET_FILE"
    printf '%s' "$PASSWORD" > "$SECRET_FILE"
    unset PASSWORD
    set -- "$1" "$2" "$SECRET_FILE"
  fi
  if ! systemd-run --quiet --collect --unit="vps-dashboard-job-$JOB_ID" "$0" run-job "$JOB_ID" "$OPERATION" "$@"; then
    rm -f "${SECRET_FILE:-}"
    exit 1
  fi
  echo "$JOB_ID"
  exit
fi

if [[ $ACTION == "run-job" ]]; then
  JOB_ID="$SUBJECT"
  OPERATION="${3:-}"
  shift 3
  [[ $JOB_ID =~ ^[a-f0-9]{32}$ ]] || exit 1
  export JOB_FILE="$JOB_DIR/$JOB_ID"
  job_line STATUS running
  trap 'job_line STATUS failed; job_line MESSAGE "Operace byla přerušena."; exit 1' HUP INT TERM
  RESOURCE_KIND="${OPERATION%%-*}"
  RESOURCE_ID="${1:-}-${2:-}"
  exec 9>"$LOCK_DIR/${RESOURCE_KIND}-${RESOURCE_ID//[^a-zA-Z0-9_.-]/_}.lock"
  if ! flock -n 9; then
    job_line STATUS failed
    job_line MESSAGE "Na stejném objektu právě probíhá jiná operace."
    exit 1
  fi
  if "$0" "$OPERATION" "$@"; then
    job_line STATUS succeeded
    job_line MESSAGE "Operace byla úspěšně dokončena."
    exit 0
  else
    job_line STATUS failed
    job_line MESSAGE "Operace na serveru selhala. Zkontrolujte systémový log jobu."
    exit 1
  fi
fi

valid_domain() {
  [[ $1 =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ && $1 == *.* && $1 != *..* ]]
}

valid_target() {
  [[ $1 =~ ^(127\.0\.0\.1|localhost|\[::1\]):([0-9]{4,5})$ ]] || return 1
  local port="${BASH_REMATCH[2]}"
  ((port >= 1024 && port <= 65535))
}

valid_flag() {
  [[ $1 == "0" || $1 == "1" ]]
}

valid_username() {
  [[ $1 =~ ^[a-z_][a-z0-9_-]{0,30}$ ]]
}

protected_user() {
  [[ $1 =~ ^(root|www-data|postgres|vps-dashboard|deploy|debian|ubuntu)$ ]]
}

valid_cluster() {
  [[ $1 =~ ^[0-9]{2}$ && $2 =~ ^[a-z][a-z0-9_-]{0,30}$ && -x /usr/lib/postgresql/$1/bin/postgres ]]
}

valid_port() {
  [[ $1 =~ ^[0-9]+$ ]] && (( $1 >= 1024 && $1 <= 65535 ))
}

valid_database_name() {
  [[ $1 =~ ^[a-z][a-z0-9_]{0,62}$ ]]
}

if [[ $ACTION == "database-editor" ]]; then
  DATABASE="$SUBJECT"
  valid_database_name "$DATABASE" || { echo "Invalid database." >&2; exit 1; }
  [[ -f $DATABASE_STATE_DIR/$DATABASE ]] || { echo "Database is not managed by the dashboard." >&2; exit 1; }
  exec node /usr/local/lib/vps-dashboard/database-editor.mjs "${3:-}" "$DATABASE" "${@:4}"
fi

wedos_request() {
  local command="$1" data="$2" output="$3"
  local hour password_hash auth request_file
  hour="$(TZ=Europe/Prague date +%H)"
  password_hash="$(printf '%s' "$WEDOS_WAPI_PASSWORD" | sha1sum | cut -d' ' -f1)"
  auth="$(printf '%s%s%s' "$WEDOS_WAPI_USER" "$password_hash" "$hour" | sha1sum | cut -d' ' -f1)"
  request_file="$output.request"
  WEDOS_AUTH="$auth" WEDOS_DATA="$data" node -e 'process.stdout.write(JSON.stringify({request:{user:process.env.WEDOS_WAPI_USER,auth:process.env.WEDOS_AUTH,command:process.argv[1],clTRID:`vps-dashboard-${Date.now()}`,data:JSON.parse(process.env.WEDOS_DATA)}}))' "$command" > "$request_file"
  chmod 0600 "$request_file"
  curl -4 --fail --silent --show-error --max-time 60 -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode "request@$request_file" "$WEDOS_WAPI_ENDPOINT" > "$output"
  rm -f "$request_file"
  node -e 'let x;try{x=require(process.argv[1])}catch{console.error("WAPI returned invalid JSON");process.exit(1)}const r=x?.response;if(Number(r?.code)!==1000){console.error(`WAPI ${r?.code??"?"}: ${r?.result??"invalid response"}`);process.exit(1)}' "$output"
}

ensure_wedos_a_record() (
  local domain="$1" ip="46.28.108.112" config="/etc/vps-dashboard/wedos.env"
  [[ -f $config ]] || return 0
  set -a
  source "$config"
  set +a
  local workdir zone record_name action row_id
  workdir="$(mktemp -d)"
  trap 'rm -rf -- "$workdir"' EXIT
  wedos_request dns-domains-list '{}' "$workdir/domains.json"
  zone="$(node -e 'const d=require(process.argv[1]).response.data?.domain??[];const list=Array.isArray(d)?d:Object.values(d);const h=process.argv[2];const z=list.map(x=>x.name).filter(x=>h===x||h.endsWith(`.${x}`)).sort((a,b)=>b.length-a.length);process.stdout.write(z[0]??"")' "$workdir/domains.json" "$domain")"
  [[ -n $zone ]] || { echo "WAPI DNS zone for $domain was not found." >&2; return 1; }
  record_name="${domain%.$zone}"
  [[ $record_name != "$domain" ]] || record_name=""
  wedos_request dns-rows-list "$(node -e 'process.stdout.write(JSON.stringify({domain:process.argv[1]}))' "$zone")" "$workdir/rows.json"
  IFS='|' read -r action row_id < <(node -e 'const d=require(process.argv[1]).response.data??{};const r=d.row??d;const rows=Array.isArray(r)?r:Object.values(r).filter(x=>x&&typeof x==="object"&&!Array.isArray(x));const n=process.argv[2],ip=process.argv[3];const row=rows.find(x=>String(x.name??"")===n&&String(x.rdtype??x.type??"").toUpperCase()==="A");process.stdout.write((row?(String(row.rdata)===ip?"keep|":"update|"+row.ID):"add|")+"\n")' "$workdir/rows.json" "$record_name" "$ip")
  if [[ $action == add ]]; then
    wedos_request dns-row-add "$(node -e 'process.stdout.write(JSON.stringify({domain:process.argv[1],name:process.argv[2],ttl:"300",type:"A",rdata:process.argv[3],author_comment:"VPS dashboard"}))' "$zone" "$record_name" "$ip")" "$workdir/change.json"
  elif [[ $action == update ]]; then
    wedos_request dns-row-update "$(node -e 'process.stdout.write(JSON.stringify({domain:process.argv[1],row_id:process.argv[2],ttl:"300",rdata:process.argv[3],author_comment:"VPS dashboard"}))' "$zone" "$row_id" "$ip")" "$workdir/change.json"
  else
    return 0
  fi
  wedos_request dns-domain-commit "$(node -e 'process.stdout.write(JSON.stringify({name:process.argv[1]}))' "$zone")" "$workdir/commit.json"
)

delete_wedos_a_record() (
  local domain="$1" ip="46.28.108.112" config="/etc/vps-dashboard/wedos.env"
  [[ -f $config ]] || return 0
  set -a
  source "$config"
  set +a
  local workdir zone record_name row_id
  workdir="$(mktemp -d)"
  trap 'rm -rf -- "$workdir"' EXIT
  wedos_request dns-domains-list '{}' "$workdir/domains.json"
  zone="$(node -e 'const d=require(process.argv[1]).response.data?.domain??[];const list=Array.isArray(d)?d:Object.values(d);const h=process.argv[2];const z=list.map(x=>x.name).filter(x=>h===x||h.endsWith(`.${x}`)).sort((a,b)=>b.length-a.length);process.stdout.write(z[0]??"")' "$workdir/domains.json" "$domain")"
  [[ -n $zone ]] || { echo "WAPI DNS zone for $domain was not found." >&2; return 1; }
  record_name="${domain%.$zone}"
  [[ $record_name != "$domain" ]] || record_name=""
  wedos_request dns-rows-list "$(node -e 'process.stdout.write(JSON.stringify({domain:process.argv[1]}))' "$zone")" "$workdir/rows.json"
  row_id="$(node -e 'const d=require(process.argv[1]).response.data??{};const r=d.row??d;const rows=Array.isArray(r)?r:Object.values(r).filter(x=>x&&typeof x==="object"&&!Array.isArray(x));const n=process.argv[2],ip=process.argv[3];const row=rows.find(x=>String(x.name??"")===n&&String(x.rdtype??x.type??"").toUpperCase()==="A"&&String(x.rdata??"")===ip);process.stdout.write(String(row?.ID??""))' "$workdir/rows.json" "$record_name" "$ip")"
  [[ -n $row_id ]] || return 0
  wedos_request dns-row-delete "$(node -e 'process.stdout.write(JSON.stringify({domain:process.argv[1],row_id:process.argv[2]}))' "$zone" "$row_id")" "$workdir/delete.json"
  wedos_request dns-domain-commit "$(node -e 'process.stdout.write(JSON.stringify({name:process.argv[1]}))' "$zone")" "$workdir/commit.json"
)

write_proxy_config() {
  local DOMAIN="$SUBJECT"
  local target="$1" force_https="$2" www_redirect="$3"
  valid_target "$target" || { echo "Invalid upstream target." >&2; exit 1; }
  valid_flag "$force_https" || exit 1
  valid_flag "$www_redirect" || exit 1

  local config="$NGINX_AVAILABLE/$DOMAIN"
  step "Připravuji konfiguraci Nginx"
  cat > "$config" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://$target;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

  if [[ $www_redirect == "1" ]]; then
    cat >> "$config" <<EOF

server {
    listen 80;
    listen [::]:80;
    server_name www.$DOMAIN;
    return 301 http://$DOMAIN\$request_uri;
}
EOF
  fi

  ln -sfn "$config" "$NGINX_ENABLED/$DOMAIN"
  rm -f "$NGINX_ENABLED/www.$DOMAIN"
  step "Ověřuji a načítám konfiguraci Nginx"
  nginx -t
  systemctl reload nginx

  if [[ ${4:-0} == "1" ]]; then
    step "Vystavuji SSL certifikát"
    local certbot_args=(--nginx --non-interactive --cert-name "$DOMAIN" -d "$DOMAIN")
    [[ $www_redirect == "1" ]] && certbot_args+=(-d "www.$DOMAIN")
    [[ $force_https == "1" ]] && certbot_args+=(--redirect) || certbot_args+=(--no-redirect)
    certbot "${certbot_args[@]}"
  fi
}

write_static_config() {
  local DOMAIN="$SUBJECT"
  local force_https="$1" www_redirect="$2"
  valid_flag "$force_https" || exit 1
  valid_flag "$www_redirect" || exit 1

  local config="$NGINX_AVAILABLE/$DOMAIN"
  step "Připravuji konfiguraci Nginx"
  cat > "$config" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    root /srv/apps/$DOMAIN;
    index index.html;

    location / {
        try_files \$uri \$uri/ =404;
    }
}
EOF

  if [[ $www_redirect == "1" ]]; then
    cat >> "$config" <<EOF

server {
    listen 80;
    listen [::]:80;
    server_name www.$DOMAIN;
    return 301 http://$DOMAIN\$request_uri;
}
EOF
  fi

  ln -sfn "$config" "$NGINX_ENABLED/$DOMAIN"
  rm -f "$NGINX_ENABLED/www.$DOMAIN"
  step "Ověřuji a načítám konfiguraci Nginx"
  nginx -t
  systemctl reload nginx

  if [[ ${3:-0} == "1" ]]; then
    step "Vystavuji SSL certifikát"
    local certbot_args=(--nginx --non-interactive --cert-name "$DOMAIN" -d "$DOMAIN")
    [[ $www_redirect == "1" ]] && certbot_args+=(-d "www.$DOMAIN")
    [[ $force_https == "1" ]] && certbot_args+=(--redirect) || certbot_args+=(--no-redirect)
    certbot "${certbot_args[@]}"
  fi
}

write_split_config() {
  local DOMAIN="$SUBJECT"
  local target="$1" force_https="$2" www_redirect="$3"
  valid_target "$target" || { echo "Invalid upstream target." >&2; exit 1; }
  valid_flag "$force_https" || exit 1
  valid_flag "$www_redirect" || exit 1

  local config="$NGINX_AVAILABLE/$DOMAIN"
  step "Připravuji konfiguraci Nginx"
  cat > "$config" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    root /srv/apps/$DOMAIN/client/dist;
    index index.html;

    location /api/ {
        proxy_pass http://$target;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

  if [[ $www_redirect == "1" ]]; then
    cat >> "$config" <<EOF

server {
    listen 80;
    listen [::]:80;
    server_name www.$DOMAIN;
    return 301 http://$DOMAIN\$request_uri;
}
EOF
  fi

  ln -sfn "$config" "$NGINX_ENABLED/$DOMAIN"
  rm -f "$NGINX_ENABLED/www.$DOMAIN"
  step "Ověřuji a načítám konfiguraci Nginx"
  nginx -t
  systemctl reload nginx

  if [[ ${4:-0} == "1" ]]; then
    step "Vystavuji SSL certifikát"
    local certbot_args=(--nginx --non-interactive --cert-name "$DOMAIN" -d "$DOMAIN")
    [[ $www_redirect == "1" ]] && certbot_args+=(-d "www.$DOMAIN")
    [[ $force_https == "1" ]] && certbot_args+=(--redirect) || certbot_args+=(--no-redirect)
    certbot "${certbot_args[@]}"
  fi
}

case "$ACTION" in
  upsert|domain-upsert)
    DOMAIN="$SUBJECT"
    valid_domain "$DOMAIN" || { echo "Invalid domain." >&2; exit 1; }
    step "Ověřuji nastavení domény"
    APP_DIR="/srv/apps/$DOMAIN"
    step "Zakládám prostor /srv/apps/$DOMAIN"
    install -d -o www-data -g www-data -m 0750 "$APP_DIR"
    if [[ ! -e $APP_DIR/index.html ]]; then
      cat > "$APP_DIR/index.html" <<EOF
<!doctype html>
<html lang="cs">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>$DOMAIN</title></head>
<body><main><h1>$DOMAIN</h1><p>Prostor domény je připraven.</p></main></body>
</html>
EOF
      chown www-data:www-data "$APP_DIR/index.html"
      chmod 0640 "$APP_DIR/index.html"
    fi
    step "Nastavuji A záznam ve WEDOS DNS"
    ensure_wedos_a_record "$DOMAIN"
    write_static_config "${3:-}" "${4:-}" "${5:-}"
    rm -f "$APP_STATE_DIR/$DOMAIN"
    ;;
  deploy|domain-deploy)
    DOMAIN="$SUBJECT"
    valid_domain "$DOMAIN" || { echo "Invalid domain." >&2; exit 1; }
    REPOSITORY="${3:-}"
    BRANCH="${4:-main}"
    PORT="${5:-}"
    FORCE_HTTPS="${6:-0}"
    WWW_REDIRECT="${7:-0}"
    AUTOMATIC_SSL="${8:-0}"
    [[ $REPOSITORY =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(\.git)?$ ]] || { echo "Invalid repository." >&2; exit 1; }
    [[ $BRANCH =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || { echo "Invalid branch." >&2; exit 1; }
    [[ $PORT =~ ^[0-9]+$ ]] && ((PORT >= 1024 && PORT <= 65535)) || { echo "Invalid port." >&2; exit 1; }
    valid_flag "$FORCE_HTTPS" && valid_flag "$WWW_REDIRECT" && valid_flag "$AUTOMATIC_SSL" || exit 1
    SSH_REPOSITORY="git@github.com:${REPOSITORY#https://github.com/}"
    [[ $SSH_REPOSITORY == *.git ]] || SSH_REPOSITORY="${SSH_REPOSITORY}.git"
    APP_DIR="/srv/apps/$DOMAIN"
    SERVICE_NAME="vps-app-${DOMAIN//./-}"
    TEMP_DIR="/srv/apps/.${DOMAIN}.deploy.$$"
    SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"
    SERVICE_BACKUP="/tmp/$SERVICE_NAME.service.$$"
    NGINX_BACKUP="/tmp/$SERVICE_NAME.nginx.$$"
    trap 'rm -rf -- "$TEMP_DIR"' EXIT
    if ! systemctl is-active --quiet "$SERVICE_NAME"; then
      while ss -ltnH "sport = :$PORT" | grep -q .; do
        ((PORT < 65535)) || { echo "No available application port was found." >&2; exit 1; }
        PORT=$((PORT + 1))
      done
    fi

    step "Klonuji repozitář $BRANCH"
    mkdir -p /srv/apps "$TEMP_DIR"
    chown www-data:www-data "$TEMP_DIR"
    runuser -u www-data -- git clone --branch "$BRANCH" --single-branch -- "$SSH_REPOSITORY" "$TEMP_DIR"
    APP_MODE=""
    if [[ -s $TEMP_DIR/package.json && -s $TEMP_DIR/package-lock.json ]]; then
      APP_MODE="root"
      step "Instaluji závislosti"
      runuser -u www-data -- env HOME="$TEMP_DIR" npm_config_cache="$TEMP_DIR/.npm" npm --prefix "$TEMP_DIR" ci
      step "Sestavuji aplikaci"
      runuser -u www-data -- env HOME="$TEMP_DIR" npm_config_cache="$TEMP_DIR/.npm" npm --prefix "$TEMP_DIR" run build
    elif [[ -s $TEMP_DIR/client/package.json && -s $TEMP_DIR/client/package-lock.json && -s $TEMP_DIR/server/package.json && -s $TEMP_DIR/server/package-lock.json ]]; then
      APP_MODE="split"
      step "Instaluji závislosti klienta"
      runuser -u www-data -- env HOME="$TEMP_DIR" npm_config_cache="$TEMP_DIR/.npm" npm --prefix "$TEMP_DIR/client" ci
      step "Sestavuji klienta"
      runuser -u www-data -- env HOME="$TEMP_DIR" npm_config_cache="$TEMP_DIR/.npm" npm --prefix "$TEMP_DIR/client" run build
      [[ -f $TEMP_DIR/client/dist/index.html ]] || { echo "Client build did not create client/dist/index.html." >&2; exit 1; }
      step "Instaluji závislosti serveru"
      runuser -u www-data -- env HOME="$TEMP_DIR" npm_config_cache="$TEMP_DIR/.npm" npm --prefix "$TEMP_DIR/server" ci --omit=dev
      SERVER_ENTRY="$TEMP_DIR/server/src/index.js"
      [[ -f $SERVER_ENTRY ]] || { echo "server/src/index.js is required for split applications." >&2; exit 1; }
      if ! grep -q 'process\.env\.PORT' "$SERVER_ENTRY"; then
        node -e 'const fs=require("fs"),p=process.argv[1];let s=fs.readFileSync(p,"utf8");const n=s.replace(/\b(const|let|var)\s+PORT\s*=\s*([0-9]+)\s*;/,`const PORT = Number(process.env.PORT || $2);`);if(n===s)process.exit(1);fs.writeFileSync(p,n)' "$SERVER_ENTRY" || { echo "Split server must use process.env.PORT or declare a numeric PORT constant." >&2; exit 1; }
        chown www-data:www-data "$SERVER_ENTRY"
      fi
    else
      echo "Repository must contain package.json and package-lock.json in its root, or in both client/ and server/." >&2
      exit 1
    fi
    step "Nastavuji A záznam ve WEDOS DNS"
    ensure_wedos_a_record "$DOMAIN"
    BACKUP_DIR=""
    [[ ! -f $SERVICE_FILE ]] || cp -a "$SERVICE_FILE" "$SERVICE_BACKUP"
    [[ ! -f $NGINX_AVAILABLE/$DOMAIN ]] || cp -a "$NGINX_AVAILABLE/$DOMAIN" "$NGINX_BACKUP"
    if [[ -e $APP_DIR ]]; then
      BACKUP_DIR="/srv/apps/.${DOMAIN}.previous.$$"
      systemctl stop "$SERVICE_NAME" 2>/dev/null || true
      mv "$APP_DIR" "$BACKUP_DIR"
    fi
    mv "$TEMP_DIR" "$APP_DIR"
    trap - EXIT
    rollback_deploy() {
      trap - ERR
      systemctl stop "$SERVICE_NAME" 2>/dev/null || true
      rm -rf -- "$APP_DIR"
      [[ -z $BACKUP_DIR ]] || mv "$BACKUP_DIR" "$APP_DIR"
      rm -f "$SERVICE_FILE" "$NGINX_AVAILABLE/$DOMAIN" "$NGINX_ENABLED/$DOMAIN"
      [[ ! -f $SERVICE_BACKUP ]] || cp -a "$SERVICE_BACKUP" "$SERVICE_FILE"
      [[ ! -f $NGINX_BACKUP ]] || cp -a "$NGINX_BACKUP" "$NGINX_AVAILABLE/$DOMAIN"
      [[ ! -f $NGINX_AVAILABLE/$DOMAIN ]] || ln -sfn "$NGINX_AVAILABLE/$DOMAIN" "$NGINX_ENABLED/$DOMAIN"
      systemctl daemon-reload
      [[ -z $BACKUP_DIR ]] || systemctl start "$SERVICE_NAME" 2>/dev/null || true
      nginx -t && systemctl reload nginx || true
      rm -f "$SERVICE_BACKUP" "$NGINX_BACKUP"
    }
    trap rollback_deploy ERR

    step "Aktivuji systemd službu"
    if [[ $APP_MODE == "split" ]]; then
      SERVICE_WORKING_DIRECTORY="$APP_DIR/server"
      SERVICE_EXEC_START="$(command -v npm) start"
    else
      SERVICE_WORKING_DIRECTORY="$APP_DIR"
      SERVICE_EXEC_START="$(command -v npm) start -- --port $PORT"
    fi
    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Web application for $DOMAIN
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=$SERVICE_WORKING_DIRECTORY
EnvironmentFile=-$APP_STATE_DIR/$DOMAIN.env
Environment=NODE_ENV=production
Environment=PORT=$PORT
ExecStart=$SERVICE_EXEC_START
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable --now "$SERVICE_NAME"
    for _ in {1..15}; do
      ss -ltnH "sport = :$PORT" | grep -q . && break
      sleep 1
    done
    ss -ltnH "sport = :$PORT" | grep -q .
    if [[ $APP_MODE == "split" ]]; then
      write_split_config "127.0.0.1:$PORT" "$FORCE_HTTPS" "$WWW_REDIRECT" "$AUTOMATIC_SSL"
    else
      write_proxy_config "127.0.0.1:$PORT" "$FORCE_HTTPS" "$WWW_REDIRECT" "$AUTOMATIC_SSL"
    fi
    install -d -o root -g www-data -m 0750 "$APP_STATE_DIR"
    printf '%s\t%s\t%s\n' "$REPOSITORY" "$BRANCH" "$PORT" > "$APP_STATE_DIR/$DOMAIN"
    chown root:www-data "$APP_STATE_DIR/$DOMAIN"
    chmod 0640 "$APP_STATE_DIR/$DOMAIN"
    [[ -z $BACKUP_DIR ]] || rm -rf -- "$BACKUP_DIR"
    rm -f "$SERVICE_BACKUP" "$NGINX_BACKUP"
    trap - ERR
    ;;
  renew|domain-renew)
    DOMAIN="$SUBJECT"
    valid_domain "$DOMAIN" || { echo "Invalid domain." >&2; exit 1; }
    step "Obnovuji certifikát pomocí Certbotu"
    certbot renew --cert-name "$DOMAIN" --force-renewal --non-interactive
    step "Ověřuji a načítám konfiguraci Nginx"
    nginx -t
    systemctl reload nginx
    ;;
  delete|domain-delete)
    DOMAIN="$SUBJECT"
    valid_domain "$DOMAIN" || { echo "Invalid domain." >&2; exit 1; }
    [[ $DOMAIN != "onremote.cz" ]] || { echo "The management domain cannot be deleted." >&2; exit 1; }
    SERVICE_NAME="vps-app-${DOMAIN//./-}"
    step "Odstraňuji A záznam z WEDOS DNS"
    delete_wedos_a_record "$DOMAIN"
    step "Zastavuji aplikační službu"
    systemctl disable --now "$SERVICE_NAME" 2>/dev/null || true
    rm -f "/etc/systemd/system/$SERVICE_NAME.service"
    rm -f "$NGINX_ENABLED/$DOMAIN" "$NGINX_ENABLED/www.$DOMAIN"
    rm -f "$NGINX_AVAILABLE/$DOMAIN" "$NGINX_AVAILABLE/www.$DOMAIN"
    step "Odstraňuji konfiguraci a data"
    rm -rf -- "/srv/apps/$DOMAIN"
    rm -f "$APP_STATE_DIR/$DOMAIN" "$APP_STATE_DIR/$DOMAIN.env"
    certbot delete --cert-name "$DOMAIN" --non-interactive 2>/dev/null || true
    systemctl daemon-reload
    step "Ověřuji a načítám konfiguraci Nginx"
    nginx -t
    systemctl reload nginx
    ;;
  user-create)
    USERNAME="$SUBJECT"
    SSH_KEY="${3:-}"
    valid_username "$USERNAME" && ! protected_user "$USERNAME" || { echo "Invalid or protected user." >&2; exit 1; }
    [[ $SSH_KEY =~ ^ssh-(ed25519|rsa)[[:space:]][A-Za-z0-9+/=]+([[:space:]].*)?$ ]] || { echo "Invalid SSH public key." >&2; exit 1; }
    ! id "$USERNAME" &>/dev/null || { echo "User already exists." >&2; exit 1; }
    step "Vytvářím systémový účet"
    useradd --create-home --shell /bin/bash -- "$USERNAME"
    trap 'userdel --remove -- "$USERNAME" 2>/dev/null || true' ERR
    step "Instaluji veřejný SSH klíč"
    install -d -o "$USERNAME" -g "$USERNAME" -m 0700 "/home/$USERNAME/.ssh"
    printf '%s\n' "$SSH_KEY" > "/home/$USERNAME/.ssh/authorized_keys"
    chown "$USERNAME:$USERNAME" "/home/$USERNAME/.ssh/authorized_keys"
    chmod 0600 "/home/$USERNAME/.ssh/authorized_keys"
    install -o root -g www-data -m 0640 /dev/null "$USER_STATE_DIR/$USERNAME"
    trap - ERR
    ;;
  user-update)
    USERNAME="$SUBJECT"
    ENABLED="${3:-}"
    valid_username "$USERNAME" && valid_flag "$ENABLED" && ! protected_user "$USERNAME" || { echo "Invalid or protected user." >&2; exit 1; }
    [[ -f $USER_STATE_DIR/$USERNAME ]] || { echo "User is not managed by the dashboard." >&2; exit 1; }
    id "$USERNAME" &>/dev/null || { echo "User does not exist." >&2; exit 1; }
    step "Měním přístupový shell"
    [[ $ENABLED == "1" ]] && usermod --shell /bin/bash -- "$USERNAME" || usermod --shell /usr/sbin/nologin -- "$USERNAME"
    [[ $ENABLED == "1" ]] || loginctl terminate-user "$USERNAME" 2>/dev/null || true
    ;;
  user-delete)
    USERNAME="$SUBJECT"
    valid_username "$USERNAME" && ! protected_user "$USERNAME" || { echo "Invalid or protected user." >&2; exit 1; }
    [[ -f $USER_STATE_DIR/$USERNAME ]] || { echo "User is not managed by the dashboard." >&2; exit 1; }
    [[ $(id -u "$USERNAME") -ne 0 ]] || { echo "UID 0 is protected." >&2; exit 1; }
    step "Ukončuji procesy uživatele"
    loginctl terminate-user "$USERNAME" 2>/dev/null || true
    step "Odstraňuji účet a domovský adresář"
    userdel --remove -- "$USERNAME"
    rm -f "$USER_STATE_DIR/$USERNAME"
    ;;
  database-create)
    DATABASE="$SUBJECT"; OWNER="${3:-}"; SECRET_FILE="${4:-}"
    valid_database_name "$DATABASE" && valid_database_name "$OWNER" || { echo "Invalid database settings." >&2; exit 1; }
    [[ $SECRET_FILE == "$JOB_DIR/"*.secret && -f $SECRET_FILE ]] || { echo "Database password is unavailable." >&2; exit 1; }
    PASSWORD="$(cat "$SECRET_FILE")"
    rm -f "$SECRET_FILE"
    (( ${#PASSWORD} >= 12 && ${#PASSWORD} <= 128 )) || { echo "Invalid password length." >&2; exit 1; }
    [[ $DATABASE != postgres && $DATABASE != template0 && $DATABASE != template1 ]] || { echo "System database is protected." >&2; exit 1; }
    ! runuser -u postgres -- psql --dbname postgres --tuples-only --no-align --command="SELECT 1 FROM pg_database WHERE datname = '$DATABASE'" | grep -q 1 || { echo "Database already exists." >&2; exit 1; }
    ROLE_EXISTED="$(runuser -u postgres -- psql --dbname postgres --tuples-only --no-align --command="SELECT 1 FROM pg_roles WHERE rolname = '$OWNER'")"
    SQL_FILE="$(mktemp)"
    printf '%s\n' "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', '$OWNER', :'password') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$OWNER') \\gexec" > "$SQL_FILE"
    chown postgres:postgres "$SQL_FILE"
    chmod 0600 "$SQL_FILE"
    trap 'rm -f "$SQL_FILE"; [[ -n $ROLE_EXISTED ]] || runuser -u postgres -- dropuser --if-exists -- "$OWNER" 2>/dev/null || true' ERR
    step "Vytvářím databázového uživatele"
    runuser -u postgres -- psql --dbname postgres --set=ON_ERROR_STOP=1 --set=password="$PASSWORD" --file="$SQL_FILE"
    unset PASSWORD
    rm -f "$SQL_FILE"
    step "Vytvářím PostgreSQL databázi"
    runuser -u postgres -- createdb --owner="$OWNER" --encoding=UTF8 -- "$DATABASE"
    install -d -o root -g www-data -m 0750 "$DATABASE_STATE_DIR"
    printf '%s\n' "$OWNER" > "$DATABASE_STATE_DIR/$DATABASE"
    chown root:www-data "$DATABASE_STATE_DIR/$DATABASE"
    chmod 0640 "$DATABASE_STATE_DIR/$DATABASE"
    trap - ERR
    ;;
  database-delete)
    DATABASE="$SUBJECT"
    valid_database_name "$DATABASE" || { echo "Invalid database." >&2; exit 1; }
    [[ -f $DATABASE_STATE_DIR/$DATABASE ]] || { echo "Database is not managed by the dashboard." >&2; exit 1; }
    OWNER="$(cat "$DATABASE_STATE_DIR/$DATABASE")"
    step "Ukončuji připojení k databázi"
    runuser -u postgres -- psql --dbname postgres --set=ON_ERROR_STOP=1 --command="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DATABASE' AND pid <> pg_backend_pid()"
    step "Odstraňuji PostgreSQL databázi"
    runuser -u postgres -- dropdb --if-exists -- "$DATABASE"
    if valid_database_name "$OWNER" && ! runuser -u postgres -- psql --dbname postgres --tuples-only --no-align --command="SELECT 1 FROM pg_database WHERE pg_get_userbyid(datdba) = '$OWNER'" | grep -q 1; then
      runuser -u postgres -- dropuser --if-exists -- "$OWNER"
    fi
    rm -f "$DATABASE_STATE_DIR/$DATABASE"
    ;;
  *)
    echo "Unsupported action." >&2
    exit 1
    ;;
esac
