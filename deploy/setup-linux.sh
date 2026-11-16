#!/usr/bin/env bash
# Sets up Venture Atlas as an always-on server on a Raspberry Pi (64-bit OS) or any Linux machine with systemd,
# reachable from your phone over Tailscale. Run from the project folder:   bash deploy/setup-linux.sh
# Safe to run again: it rebuilds, rewrites the service and restarts it.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="$(pwd)"; USER_NAME="$(id -un)"; PORT="${PORT:-5173}"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

say "1/5  Checking Node.js (22.12 or newer)"
if ! command -v node >/dev/null || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)'; then
  die "Node.js 22.12+ is needed. On Raspberry Pi OS / Debian / Ubuntu:
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
then run this script again."
fi
[ "$(uname -m)" = "armv7l" ] && die "This is a 32-bit OS. The build tools need a 64-bit OS (Raspberry Pi OS 64-bit)."
node -v

say "2/5  Checking Tailscale"
command -v tailscale >/dev/null || die "Install Tailscale first:  curl -fsSL https://tailscale.com/install.sh | sh  &&  sudo tailscale up"
tailscale status >/dev/null 2>&1 || die "Tailscale is installed but not connected. Run:  sudo tailscale up"

say "3/5  Installing and building"
npm ci
npm run build
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Add an AI key to it (e.g. ANTHROPIC_API_KEY=...) for research; browsing works without one."
fi

say "4/5  Installing the systemd service (asks for your password)"
sudo tee /etc/systemd/system/venture-atlas.service >/dev/null <<EOF
[Unit]
Description=Venture Atlas
After=network-online.target
Wants=network-online.target

[Service]
User=$USER_NAME
WorkingDirectory=$DIR
ExecStart=$(command -v node) server/index.mjs --prod
Environment=NODE_ENV=production
Environment=PORT=$PORT
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable venture-atlas >/dev/null
sudo systemctl restart venture-atlas
for _ in $(seq 1 30); do curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null && break; sleep 1; done
curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null || die "The service did not start. See:  journalctl -u venture-atlas -n 50"

say "5/5  Publishing it on your tailnet (HTTPS, tailnet only)"
sudo tailscale serve --bg "$PORT"
URL="https://$(tailscale status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,"")))')"

say "Done. Venture Atlas runs at  $URL"
echo "- On your phone (Tailscale on): open that address, then Share → Add to Home Screen (iPhone) or Install app (Android)."
echo "- Or add it as a server in an app installed elsewhere (status dot, top right)."
echo "- It starts on boot. Logs: journalctl -u venture-atlas -f   Update: git pull && bash deploy/setup-linux.sh"
