#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run this script as root or with sudo." >&2
  exit 1
fi

DOMAIN="${1:-}"
REPOSITORY="${2:-}"
BRANCH="${3:-main}"
PORT="${4:-3000}"

if [[ ! $DOMAIN =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ || $DOMAIN != *.* ]]; then
  echo "Invalid domain name." >&2
  exit 1
fi
if [[ ! $REPOSITORY =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(\.git)?$ ]]; then
  echo "Only HTTPS GitHub repository URLs are accepted." >&2
  exit 1
fi
if [[ ! $BRANCH =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]]; then
  echo "Invalid Git branch." >&2
  exit 1
fi
if [[ ! $PORT =~ ^[0-9]+$ ]] || ((PORT < 1024 || PORT > 65535)); then
  echo "Port must be between 1024 and 65535." >&2
  exit 1
fi

for command in git npm nginx systemctl; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done

APP_SLUG="${DOMAIN//./-}"
APP_DIR="/srv/apps/$DOMAIN"
SERVICE_NAME="vps-app-$APP_SLUG"
NGINX_CONFIG="/etc/nginx/sites-available/$DOMAIN"
NPM_BIN="$(command -v npm)"

mkdir -p /srv/apps
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" remote set-url origin "$REPOSITORY"
  git -C "$APP_DIR" fetch --prune origin "$BRANCH"
  git -C "$APP_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
else
  rm -rf "$APP_DIR"
  git clone --branch "$BRANCH" --single-branch -- "$REPOSITORY" "$APP_DIR"
fi

cd "$APP_DIR"
[[ -f package-lock.json ]] || { echo "The repository must contain package-lock.json." >&2; exit 1; }
npm ci
npm run build
chown -R www-data:www-data "$APP_DIR"

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
ExecStart=$NPM_BIN start -- --port $PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat > "$NGINX_CONFIG" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
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

ln -sfn "$NGINX_CONFIG" "/etc/nginx/sites-enabled/$DOMAIN"
nginx -t
systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"
systemctl reload nginx

echo "Deployment completed: http://$DOMAIN -> 127.0.0.1:$PORT"