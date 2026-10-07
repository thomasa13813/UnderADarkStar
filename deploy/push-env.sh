#!/bin/sh
# Under a Dark Star: write the server's environment file (Launch doc H3) from
# the secrets already in the developer's local .env, and copy it to the
# server. Run from the repository root on the developer's PC:
#
#   sh deploy/push-env.sh root@<server> ~/.ssh/<key>
#
# Reads DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, TURNSTILE_SITE_KEY,
# TURNSTILE_SECRET_KEY and TUNNEL_TOKEN from ./.env (git-ignored), generates
# a fresh API_KEY, fills in deploy/env.example's fixed values, and uploads the
# result to /opt/darkstar/.env (mode 600). Nothing is printed: no secret ever
# appears in a terminal or a chat log. An existing server file is kept as
# /opt/darkstar/.env.previous, and its API_KEY is reused so a re-push does not
# break the running containers' shared key.
set -eu

HOST="${1:?usage: push-env.sh user@host [ssh-key-file]}"
KEY="${2:-}"
SSH="ssh -o BatchMode=yes"
SCP="scp -q"
if [ -n "$KEY" ]; then
    SSH="$SSH -i $KEY"
    SCP="$SCP -i $KEY"
fi

LOCAL_ENV="${DARKSTAR_LOCAL_ENV:-.env}"
[ -f "$LOCAL_ENV" ] || { echo "no $LOCAL_ENV in $(pwd)" >&2; exit 1; }

# The value of KEY= in the local env file, without quotes or CR.
val() {
    grep -E "^$1=" "$LOCAL_ENV" | tail -n1 | cut -d= -f2- | tr -d '\r"'
}
need() {
    v="$(val "$1")"
    if [ -z "$v" ]; then
        echo "$1 is not set in $LOCAL_ENV" >&2
        exit 1
    fi
    printf '%s' "$v"
}

DISCORD_CLIENT_ID="$(need DISCORD_CLIENT_ID)"
DISCORD_CLIENT_SECRET="$(need DISCORD_CLIENT_SECRET)"
TURNSTILE_SITE_KEY="$(need TURNSTILE_SITE_KEY)"
TURNSTILE_SECRET_KEY="$(need TURNSTILE_SECRET_KEY)"
TUNNEL_TOKEN="$(need TUNNEL_TOKEN)"
DEPLOY_BRANCH="$(val DEPLOY_BRANCH)"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

# Keep the server's existing shared key, if there is one.
API_KEY="$($SSH "$HOST" "grep -E '^API_KEY=' /opt/darkstar/.env 2>/dev/null | cut -d= -f2-" || true)"
if [ -z "$API_KEY" ]; then
    API_KEY="$(openssl rand -hex 32)"
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
cat > "$TMP" <<EOF
# Under a Dark Star production environment. Written by deploy/push-env.sh on
# $(date -u +%Y-%m-%dT%H:%MZ); see deploy/env.example for what each key is.
DEPLOY_BRANCH=$DEPLOY_BRANCH
TUNNEL_TOKEN=$TUNNEL_TOKEN

GAME_ENV=prod
DOMAIN=darkstar.january-games.com
API_DOMAIN=darkstar-api.january-games.com
NUM_WORKERS=2
INSTANCE_LETTER=a
API_KEY=$API_KEY
TURNSTILE_SITE_KEY=$TURNSTILE_SITE_KEY
TURNSTILE_SECRET_KEY=$TURNSTILE_SECRET_KEY
DISCORD_CLIENT_ID=$DISCORD_CLIENT_ID
DISCORD_CLIENT_SECRET=$DISCORD_CLIENT_SECRET
DATA_DIR=/data
EOF

$SSH "$HOST" "mkdir -p /opt/darkstar && { [ -f /opt/darkstar/.env ] && cp /opt/darkstar/.env /opt/darkstar/.env.previous || true; }"
$SCP "$TMP" "$HOST:/opt/darkstar/.env"
$SSH "$HOST" "chmod 600 /opt/darkstar/.env && wc -l < /opt/darkstar/.env"
echo "server env written (line count above); secrets were not displayed"
