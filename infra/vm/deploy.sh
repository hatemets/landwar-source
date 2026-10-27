#!/bin/bash
# deploy.sh [image-tag] - Start or update LandWar on this VM.
# The deploy workflow runs it over IAP SSH with the new tag. The startup
# script runs it with no tag at boot, which reuses the last deployed tag.
# Config comes from instance metadata (Terraform) and Secret Manager.
set -euo pipefail

DIR=/opt/landwar
TAG_FILE="$DIR/current-tag"
MD=http://metadata.google.internal/computeMetadata/v1/instance/attributes

md() {
    curl -fsS -H "Metadata-Flavor: Google" "$MD/$1" || true
}

exec 9>"$DIR/deploy.lock"
flock 9

TAG="${1:-}"
if [ -z "$TAG" ] && [ -f "$TAG_FILE" ]; then
    TAG="$(cat "$TAG_FILE")"
fi
if [ -z "$TAG" ]; then
    echo "No image tag yet. Run the deploy workflow."
    exit 0
fi
case "$TAG" in
    *[!A-Za-z0-9._-]*)
        echo "Bad image tag: $TAG" >&2
        exit 1
        ;;
esac

IMAGE="$(md landwar-image)"
CLOUDSQL="$(md landwar-cloudsql)"

# Server env: plain values from metadata, then each secret.
umask 077
{
    md landwar-env
    echo
    for pair in $(md landwar-secrets); do
        name="${pair%%=*}"
        secret="${pair#*=}"
        value="$(gcloud secrets versions access latest --secret="$secret")"
        printf '%s=%s\n' "$name" "$value"
    done
} > "$DIR/app.env.new"
mv "$DIR/app.env.new" "$DIR/app.env"

{
    echo "LANDWAR_IMAGE=$IMAGE:$TAG"
    echo "DOMAIN=$(md landwar-domain)"
    echo "ACME_EMAIL=$(md landwar-acme-email)"
    echo "CLOUDSQL_CONNECTION=$CLOUDSQL"
    if [ -n "$CLOUDSQL" ]; then
        echo "COMPOSE_PROFILES=cloudsql"
    fi
} > "$DIR/.env"

cd "$DIR"
# The 20 GB disk holds only a few images: drop the unused ones first, or the
# pull fails with "no space left on device". Rollback pulls from the registry.
docker image prune -af > /dev/null
docker compose pull --quiet
docker compose up -d --remove-orphans

# Wait for the app health check. Keep the old tag on failure.
for _ in $(seq 1 60); do
    status="$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q app)" 2>/dev/null || echo starting)"
    if [ "$status" = healthy ]; then
        echo "$TAG" > "$TAG_FILE"
        docker image prune -af > /dev/null
        echo "Deployed $IMAGE:$TAG"
        exit 0
    fi
    sleep 3
done

echo "App did not become healthy. Logs:" >&2
docker compose logs --tail 100 app >&2
exit 1
