#!/usr/bin/env bash
set -Eeuo pipefail

[[ $EUID -eq 0 ]] || { echo "Root privileges are required." >&2; exit 1; }

ACTION="${1:-}"
DOMAIN="${2:-}"
NGINX_AVAILABLE="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"

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

valid_domain "$DOMAIN" || { echo "Invalid domain." >&2; exit 1; }

write_proxy_config() {
  local target="$1" force_https="$2" www_redirect="$3"
  valid_target "$target" || { echo "Invalid upstream target." >&2; exit 1; }
  valid_flag "$force_https" || exit 1
  valid_flag "$www_redirect" || exit 1

  local config="$NGINX_AVAILABLE/$DOMAIN"
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
  nginx -t
  systemctl reload nginx

  if [[ ${4:-0} == "1" ]]; then
    local certbot_args=(--nginx --non-interactive --cert-name "$DOMAIN" -d "$DOMAIN")
    [[ $www_redirect == "1" ]] && certbot_args+=(-d "www.$DOMAIN")
    [[ $force_https == "1" ]] && certbot_args+=(--redirect) || certbot_args+=(--no-redirect)
    certbot "${certbot_args[@]}"
  fi
}

case "$ACTION" in
  upsert)
    write_proxy_config "${3:-}" "${4:-}" "${5:-}" "${6:-}"
    ;;
  deploy)
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
    ss -ltnH "sport = :$PORT" | grep -q . && { echo "Port $PORT is already in use." >&2; exit 1; }

    APP_DIR="/srv/apps/$DOMAIN"
    SERVICE_NAME="vps-app-${DOMAIN//./-}"
    [[ ! -e $APP_DIR ]] || { echo "Application directory already exists." >&2; exit 1; }
    TEMP_DIR="/srv/apps/.${DOMAIN}.deploy.$$"
    trap 'rm -rf -- "$TEMP_DIR"' EXIT
    mkdir -p /srv/apps "$TEMP_DIR"
    chown www-data:www-data "$TEMP_DIR"
    runuser -u www-data -- git clone --branch "$BRANCH" --single-branch -- "$REPOSITORY" "$TEMP_DIR"
    [[ -f $TEMP_DIR/package-lock.json ]] || { echo "package-lock.json is required." >&2; exit 1; }
    runuser -u www-data -- env HOME="$TEMP_DIR" npm_config_cache="$TEMP_DIR/.npm" npm --prefix "$TEMP_DIR" ci
    runuser -u www-data -- env HOME="$TEMP_DIR" npm_config_cache="$TEMP_DIR/.npm" npm --prefix "$TEMP_DIR" run build
    mv "$TEMP_DIR" "$APP_DIR"
    trap - EXIT

    cat > "/etc/systemd/system/$SERVICE_NAME.service" <<EOF
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
    write_proxy_config "127.0.0.1:$PORT" "$FORCE_HTTPS" "$WWW_REDIRECT" "$AUTOMATIC_SSL"
    ;;
  renew)
    certbot renew --cert-name "$DOMAIN" --force-renewal --non-interactive
    nginx -t
    systemctl reload nginx
    ;;
  delete)
    [[ $DOMAIN != "onremote.cz" ]] || { echo "The management domain cannot be deleted." >&2; exit 1; }
    SERVICE_NAME="vps-app-${DOMAIN//./-}"
    systemctl disable --now "$SERVICE_NAME" 2>/dev/null || true
    rm -f "/etc/systemd/system/$SERVICE_NAME.service"
    rm -f "$NGINX_ENABLED/$DOMAIN" "$NGINX_ENABLED/www.$DOMAIN"
    rm -f "$NGINX_AVAILABLE/$DOMAIN" "$NGINX_AVAILABLE/www.$DOMAIN"
    rm -rf -- "/srv/apps/$DOMAIN"
    certbot delete --cert-name "$DOMAIN" --non-interactive 2>/dev/null || true
    systemctl daemon-reload
    nginx -t
    systemctl reload nginx
    ;;
  *)
    echo "Unsupported action." >&2
    exit 1
    ;;
esac