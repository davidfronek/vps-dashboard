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
CLUSTER_STATE_DIR="$STATE_DIR/clusters"
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
    cluster-create) echo "Vytvoření PostgreSQL clusteru $2/$3" ;;
    cluster-update) echo "Změna PostgreSQL clusteru $2/$3" ;;
    cluster-delete) echo "Odstranění PostgreSQL clusteru $2/$3" ;;
    cluster-start) echo "Spuštění PostgreSQL clusteru $2/$3" ;;
    cluster-stop) echo "Zastavení PostgreSQL clusteru $2/$3" ;;
    cluster-restart) echo "Restart PostgreSQL clusteru $2/$3" ;;
    *) echo "Správa serveru" ;;
  esac
}

if [[ $ACTION == "status" ]]; then
  JOB_ID="$SUBJECT"
  [[ $JOB_ID =~ ^[a-f0-9]{32}$ ]] || exit 1
  cat "$JOB_DIR/$JOB_ID"
  exit
fi

if [[ $ACTION == "enqueue" ]]; then
  JOB_ID="$SUBJECT"
  OPERATION="${3:-}"
  shift 3
  [[ $JOB_ID =~ ^[a-f0-9]{32}$ ]] || { echo "Invalid job id." >&2; exit 1; }
  [[ $OPERATION =~ ^(domain-(upsert|deploy|renew|delete)|user-(create|update|delete)|cluster-(create|update|delete|start|stop|restart))$ ]] || { echo "Unsupported operation." >&2; exit 1; }
  install -d -o root -g www-data -m 0750 "$JOB_DIR" "$APP_STATE_DIR" "$USER_STATE_DIR" "$CLUSTER_STATE_DIR" "$LOCK_DIR"
  find "$JOB_DIR" -type f -mtime +7 -delete
  JOB_FILE="$JOB_DIR/$JOB_ID"
  install -o root -g www-data -m 0640 /dev/null "$JOB_FILE"
  job_line STATUS queued
  job_line TITLE "$(job_title "$OPERATION" "${1:-}" "${2:-}")"
  systemd-run --quiet --collect --unit="vps-dashboard-job-$JOB_ID" "$0" run-job "$JOB_ID" "$OPERATION" "$@"
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
    write_proxy_config "${3:-}" "${4:-}" "${5:-}" "${6:-}"
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
    APP_DIR="/srv/apps/$DOMAIN"
    SERVICE_NAME="vps-app-${DOMAIN//./-}"
    TEMP_DIR="/srv/apps/.${DOMAIN}.deploy.$$"
    SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"
    SERVICE_BACKUP="/tmp/$SERVICE_NAME.service.$$"
    NGINX_BACKUP="/tmp/$SERVICE_NAME.nginx.$$"
    trap 'rm -rf -- "$TEMP_DIR"' EXIT
    if ss -ltnH "sport = :$PORT" | grep -q . && ! systemctl is-active --quiet "$SERVICE_NAME"; then
      echo "Port $PORT is already in use." >&2
      exit 1
    fi

    step "Klonuji repozitář $BRANCH"
    mkdir -p /srv/apps "$TEMP_DIR"
    chown www-data:www-data "$TEMP_DIR"
    runuser -u www-data -- git clone --branch "$BRANCH" --single-branch -- "$REPOSITORY" "$TEMP_DIR"
    [[ -f $TEMP_DIR/package-lock.json ]] || { echo "package-lock.json is required." >&2; exit 1; }
    step "Instaluji závislosti"
    runuser -u www-data -- env HOME="$TEMP_DIR" npm_config_cache="$TEMP_DIR/.npm" npm --prefix "$TEMP_DIR" ci
    step "Sestavuji aplikaci"
    runuser -u www-data -- env HOME="$TEMP_DIR" npm_config_cache="$TEMP_DIR/.npm" npm --prefix "$TEMP_DIR" run build
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
    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Web application for $DOMAIN
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
ExecStart=$(command -v npm) start -- --port $PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable --now "$SERVICE_NAME"
    for _ in {1..15}; do
      curl --fail --silent "http://127.0.0.1:$PORT/" >/dev/null && break
      sleep 1
    done
    curl --fail --silent "http://127.0.0.1:$PORT/" >/dev/null
    write_proxy_config "127.0.0.1:$PORT" "$FORCE_HTTPS" "$WWW_REDIRECT" "$AUTOMATIC_SSL"
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
    rm -f "$APP_STATE_DIR/$DOMAIN"
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
  cluster-create)
    VERSION="$SUBJECT"; CLUSTER="${3:-}"; PORT="${4:-}"
    valid_cluster "$VERSION" "$CLUSTER" && valid_port "$PORT" || { echo "Invalid cluster settings." >&2; exit 1; }
    [[ $CLUSTER != main ]] || { echo "The main cluster is protected." >&2; exit 1; }
    step "Vytvářím PostgreSQL cluster"
    pg_createcluster --port "$PORT" --start "$VERSION" "$CLUSTER"
    install -o root -g www-data -m 0640 /dev/null "$CLUSTER_STATE_DIR/$VERSION-$CLUSTER"
    ;;
  cluster-update)
    VERSION="$SUBJECT"; CLUSTER="${3:-}"; PORT="${4:-}"
    valid_cluster "$VERSION" "$CLUSTER" && valid_port "$PORT" || { echo "Invalid cluster settings." >&2; exit 1; }
    [[ $CLUSTER != main ]] || { echo "The main cluster is protected." >&2; exit 1; }
    [[ -f $CLUSTER_STATE_DIR/$VERSION-$CLUSTER ]] || { echo "Cluster is not managed by the dashboard." >&2; exit 1; }
    ! ss -ltnH "sport = :$PORT" | grep -q . || { echo "Port is already in use." >&2; exit 1; }
    OLD_PORT="$(pg_conftool "$VERSION" "$CLUSTER" show port)"
    trap 'pg_conftool "$VERSION" "$CLUSTER" set port "$OLD_PORT"; pg_ctlcluster "$VERSION" "$CLUSTER" restart' ERR
    step "Ukládám nový port clusteru"
    pg_conftool "$VERSION" "$CLUSTER" set port "$PORT"
    step "Restartuji PostgreSQL cluster"
    pg_ctlcluster "$VERSION" "$CLUSTER" restart
    trap - ERR
    ;;
  cluster-start|cluster-stop|cluster-restart)
    VERSION="$SUBJECT"; CLUSTER="${3:-}"; COMMAND="${ACTION#cluster-}"
    valid_cluster "$VERSION" "$CLUSTER" || { echo "Invalid cluster." >&2; exit 1; }
    [[ $CLUSTER != main || $COMMAND == restart ]] || { echo "The main cluster cannot be stopped from the dashboard." >&2; exit 1; }
    [[ $CLUSTER == main || -f $CLUSTER_STATE_DIR/$VERSION-$CLUSTER ]] || { echo "Cluster is not managed by the dashboard." >&2; exit 1; }
    step "Provádím akci $COMMAND"
    pg_ctlcluster "$VERSION" "$CLUSTER" "$COMMAND"
    ;;
  cluster-delete)
    VERSION="$SUBJECT"; CLUSTER="${3:-}"
    valid_cluster "$VERSION" "$CLUSTER" || { echo "Invalid cluster." >&2; exit 1; }
    [[ $CLUSTER != main ]] || { echo "The main cluster is protected." >&2; exit 1; }
    [[ -f $CLUSTER_STATE_DIR/$VERSION-$CLUSTER ]] || { echo "Cluster is not managed by the dashboard." >&2; exit 1; }
    step "Zastavuji a odstraňuji PostgreSQL cluster"
    pg_dropcluster --stop "$VERSION" "$CLUSTER"
    rm -f "$CLUSTER_STATE_DIR/$VERSION-$CLUSTER"
    ;;
  *)
    echo "Unsupported action." >&2
    exit 1
    ;;
esac