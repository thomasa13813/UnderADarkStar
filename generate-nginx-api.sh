#!/bin/sh
# generate-nginx-api.sh
#
# Under a Dark Star: the account API's nginx server block, written at
# container start from API_DOMAIN (docs/DarkStar-Accounts.md §9). The API is
# the third program in the container (supervisord.conf), on 127.0.0.1:8787.
# With API_DOMAIN set (production: darkstar-api.january-games.com), requests
# that arrive for that hostname go to it; every other hostname falls through
# to the game's default server block in nginx.conf. Without API_DOMAIN (a
# local production-mode audit on one PC, DOMAIN=localhost) no block is
# written: the browser and the game server reach the API on the published
# port 8787 directly, which is what the code derives for localhost.
#
# Usage: generate-nginx-api.sh [output_path]
set -eu

OUT="${1:-/etc/nginx/conf.d/10-api.conf}"

case "${API_DOMAIN:-}" in
    "" | localhost | localhost:*)
        # No API_DOMAIN, or a localhost one (an audit reaches the API on its
        # published port directly): no server block.
        : > "$OUT"
        exit 0
        ;;
esac

cat > "$OUT" <<EOF
server {
    listen 80;
    server_name ${API_DOMAIN};

    absolute_redirect off;
    large_client_header_buffers 4 32k;

    access_log /var/log/nginx/api-access.log;
    error_log /var/log/nginx/api-error.log;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
