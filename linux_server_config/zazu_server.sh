#!/usr/bin/env bash
# Sets up nginx + Let's Encrypt TLS for this app on the VPS, fronting port 4000.
# Run on the server: bash zazu_server.sh
set -euo pipefail

PORT=4000
IP="$(curl -4 -s ifconfig.me)"
HOSTNAME="$(echo "$IP" | tr '.' '-').sslip.io"
SITE_CONF="/etc/nginx/sites-available/zazu"

echo "Server IP: $IP"
echo "Hostname:  $HOSTNAME"

if ! command -v nginx >/dev/null 2>&1 || ! command -v certbot >/dev/null 2>&1; then
  echo "Installing nginx + certbot..."
  sudo apt-get update -y
  sudo apt-get install -y nginx certbot python3-certbot-nginx
fi

echo "Writing nginx config to $SITE_CONF"
sudo tee "$SITE_CONF" >/dev/null <<EOF
server {
    listen 80;
    server_name $HOSTNAME;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

if [ ! -L "/etc/nginx/sites-enabled/zazu" ]; then
  sudo ln -s "$SITE_CONF" /etc/nginx/sites-enabled/zazu
fi

sudo nginx -t
sudo systemctl reload nginx

echo "Requesting Let's Encrypt certificate for $HOSTNAME ..."
sudo certbot --nginx -d "$HOSTNAME" --non-interactive --agree-tos -m "${CERTBOT_EMAIL:?Set CERTBOT_EMAIL env var to your email before running, e.g. CERTBOT_EMAIL=you@example.com bash zazu_server.sh}"

echo
echo "Done. Set these in your app environment before starting it:"
echo "  export PUBLIC_URL=\"https://$HOSTNAME\""
echo "  export INTERNAL_URL=\"http://127.0.0.1:$PORT\""
