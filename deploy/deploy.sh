#!/bin/sh
# Under a Dark Star: deploy the current code to the one server (Launch doc
# H4). Runs ON the server, from its checkout at /opt/darkstar/repo:
#
#   ssh root@<server> /opt/darkstar/repo/deploy/deploy.sh
#
# Pulls the deploy branch, builds the image from it, restarts the game
# container (cloudflared keeps running, so the tunnel never drops), waits for
# the health check, and prunes images from earlier builds. The account
# database and signing key live on a named volume and survive every deploy.
#
# Settings come from /opt/darkstar/.env (H3): DEPLOY_BRANCH names the branch
# to deploy (default main); everything else is the containers' environment.
set -eu

ROOT="${DARKSTAR_ROOT:-/opt/darkstar}"
ENV_FILE="${DARKSTAR_ENV_FILE:-$ROOT/.env}"
REPO="$ROOT/repo"
COMPOSE="docker compose -f $REPO/deploy/docker-compose.yml --env-file $ENV_FILE"

if [ ! -f "$ENV_FILE" ]; then
    echo "missing $ENV_FILE (see deploy/env.example)" >&2
    exit 1
fi

# The branch to deploy, from the env file, without exporting the rest of it.
BRANCH="$(grep -E '^DEPLOY_BRANCH=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '\r"' || true)"
BRANCH="${BRANCH:-main}"

echo "== fetching $BRANCH"
cd "$REPO"
git fetch -q origin "$BRANCH"
git checkout -q -B "$BRANCH" "origin/$BRANCH"
COMMIT="$(git rev-parse HEAD)"
echo "== at $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"

echo "== building the image"
GIT_COMMIT="$COMMIT" $COMPOSE build game

echo "== starting"
GIT_COMMIT="$COMMIT" $COMPOSE up -d --no-build

echo "== waiting for the health check"
i=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$($COMPOSE ps -q game)" 2> /dev/null)" = "healthy" ]; do
    i=$((i + 1))
    if [ "$i" -gt 24 ]; then
        echo "the game container did not become healthy; recent logs:" >&2
        $COMPOSE logs --tail=40 game >&2
        exit 1
    fi
    sleep 5
done
echo "== healthy"

echo "== pruning old images"
docker image prune -f > /dev/null

echo "== deployed $COMMIT"
