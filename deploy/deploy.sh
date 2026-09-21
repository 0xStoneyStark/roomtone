#!/usr/bin/env bash
# Ship Roomtone to a VPS and (re)start it under pm2. Run from a POSIX shell (Git Bash on Windows):
#   ROOMTONE_HOST=user@your-vps bash deploy/deploy.sh
#   ROOMTONE_HOST=user@your-vps ROOMTONE_SSH_KEY=~/.ssh/id_ed25519 bash deploy/deploy.sh
# Requires node 20.12+ and pm2 on the server. The server's $APP_DIR/.env (TYPESAFE_API_KEY, PORT,
# TRUST_PROXY, TOKEN_BUDGET_PER_HOUR) is never touched; create it once by hand.
set -euo pipefail
HOST="${ROOMTONE_HOST:?set ROOMTONE_HOST=user@host}"
SSH_OPTS=()
[ -n "${ROOMTONE_SSH_KEY:-}" ] && SSH_OPTS=(-i "$ROOMTONE_SSH_KEY")
APP_DIR="${ROOMTONE_APP_DIR:-/opt/roomtone}"

cd "$(dirname "$0")/.."
tar czf /tmp/roomtone.tgz --exclude=node_modules --exclude=cert --exclude=.env --exclude=.git --exclude=media --exclude=frames .
scp -q "${SSH_OPTS[@]}" /tmp/roomtone.tgz "$HOST:/tmp/roomtone.tgz"
ssh "${SSH_OPTS[@]}" "$HOST" APP_DIR="$APP_DIR" 'bash -s' <<'REMOTE'
set -euo pipefail
mkdir -p "$APP_DIR"
tar xzf /tmp/roomtone.tgz -C "$APP_DIR"
rm /tmp/roomtone.tgz
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
[ -f .env ] || echo "WARNING: $APP_DIR/.env is missing (TYPESAFE_API_KEY, PORT, TRUST_PROXY=1)"
if pm2 describe roomtone >/dev/null 2>&1; then pm2 restart roomtone --update-env >/dev/null; else pm2 start server.mjs --name roomtone >/dev/null; fi
pm2 save >/dev/null
sleep 1.5
PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2)
curl -s "localhost:${PORT:-8790}/api/health"; echo
pm2 ls | grep -E 'roomtone'
REMOTE
