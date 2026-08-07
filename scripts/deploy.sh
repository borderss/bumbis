#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${BUMBIS_REPO_DIR:-/var/www/bumbis}"
BRANCH="${BUMBIS_BRANCH:-main}"
NODE_BIN_DIR="${BUMBIS_NODE_BIN_DIR:-}"

log() {
  printf '\n== %s ==\n' "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "Repo not found at $REPO_DIR" >&2
  exit 1
fi

cd "$REPO_DIR"

if [ -n "$NODE_BIN_DIR" ]; then
  export PATH="$NODE_BIN_DIR:$PATH"
elif [ -d /root/.nvm/versions/node ]; then
  LATEST_NODE_BIN="$(find /root/.nvm/versions/node -maxdepth 2 -mindepth 2 -type d -name bin | sort | tail -n1 || true)"
  if [ -n "$LATEST_NODE_BIN" ]; then
    export PATH="$LATEST_NODE_BIN:$PATH"
  fi
fi

require_cmd git
require_cmd nginx
require_cmd systemctl
require_cmd corepack
require_cmd node

log "repo state"
git status --short

if [ -n "$(git status --porcelain)" ]; then
  STASH_NAME="bumbis-deploy-$(date +%F-%H%M%S)"
  git stash push -u -m "$STASH_NAME"
  echo "Stashed local changes as $STASH_NAME"
fi

log "update source"
git fetch origin
git pull --ff-only origin "$BRANCH"

log "toolchain"
corepack enable
corepack prepare yarn@1.22.22 --activate
node -v
yarn -v

log "install deps"
yarn install --frozen-lockfile

log "build"
yarn build-only

log "matchmaking api"
if [ -f "$REPO_DIR/server/package.json" ]; then
  ( cd "$REPO_DIR/server" && yarn install --frozen-lockfile )

  # Generate + (re)install the systemd unit every deploy. Regenerating keeps
  # ExecStart pointed at the node binary this script actually resolved, so the
  # service survives nvm/node upgrades that move the path. To customise env
  # (PORT, etc.) without it being clobbered, use a drop-in:
  #   /etc/systemd/system/bumbis-api.service.d/override.conf
  NODE_BIN="$(command -v node)"
  cat > /etc/systemd/system/bumbis-api.service <<EOF
[Unit]
Description=Bumbis matchmaking API
After=network.target

[Service]
Type=simple
WorkingDirectory=$REPO_DIR/server
ExecStart=$NODE_BIN src/index.js
Environment=PORT=8787
Environment=BUMBIS_DB=$REPO_DIR/server/data/bumbis.db
Environment=GIPHY_API_KEY=${GIPHY_API_KEY:-}
Environment=KLIPY_API_KEY=${KLIPY_API_KEY:-}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable bumbis-api >/dev/null 2>&1 || true
  systemctl restart bumbis-api
  echo "bumbis-api running ($NODE_BIN)"

  # The nginx /api -> :8787 reverse proxy is NOT auto-edited: the live config
  # lives outside this repo and a bad rewrite could take the whole site down.
  # It is a one-time manual step; warn loudly until it is in place.
  if ! nginx -T 2>/dev/null | grep -q ':8787'; then
    echo "!! nginx is not proxying /api -> 127.0.0.1:8787 yet."
    echo "!! Matchmaking will NOT work until you add the block from"
    echo "!!   server/nginx-api.conf.example  into your live server { } block,"
    echo "!!   then: nginx -t && systemctl reload nginx"
  fi
fi

log "nginx verify"
nginx -t

log "reload nginx"
systemctl reload nginx

log "done"
echo "Bumbis deployed successfully"
