#!/usr/bin/env bash
# Force-pulls latest main from GitHub, rebuilds, and restarts the zazu service.
# Run on the server from the repo root: bash linux_server_config/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Fetching latest from origin..."
git fetch origin

echo "Force-resetting local main to origin/main (discards local changes)..."
git reset --hard origin/main

echo "Installing dependencies..."
npm install

echo "Building..."
npm run build

echo "Restarting zazu service..."
sudo systemctl restart zazu
sudo systemctl status zazu --no-pager
