#!/usr/bin/env bash
# Publishes the source of one build to the public repository (AGPL-3.0
# section 13). The private repository keeps the full history; the public one
# gets one snapshot commit per deploy, tagged build-<private commit>, which is
# what the main menu's source link points at (src/client/GameVersion.ts).
#
# Usage: scripts/publish-source.sh <tree-ish> [<private commit sha>]
#   Without a sha, the snapshot is committed but not tagged.
#   SOURCE_REMOTE overrides the public repository's URL.
set -euo pipefail

REV="${1:?usage: publish-source.sh <tree-ish> [<commit sha>]}"
SHA="${2:-}"
REMOTE="${SOURCE_REMOTE:-https://github.com/hatemets/landwar-source.git}"

# Private notes that are not part of the source.
EXCLUDE=(BUSINESS-TEST-PLAN.md docs/PREMIUM-UI-PLAN.md)

REPO="$(git rev-parse --show-toplevel)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git -C "$WORK" init -q
git -C "$WORK" remote add origin "$REMOTE"
# A redeploy of the same commit is already published.
if [ -n "$SHA" ] && [ -n "$(git -C "$WORK" ls-remote --tags origin "build-$SHA")" ]; then
  echo "build-$SHA is already published"
  exit 0
fi
if git -C "$WORK" fetch -q --depth 1 origin main 2>/dev/null; then
  git -C "$WORK" checkout -q -B main FETCH_HEAD
  git -C "$WORK" rm -rq --ignore-unmatch .
else
  git -C "$WORK" checkout -q -b main
fi

git -C "$REPO" archive "$REV" | tar -x -C "$WORK"
for path in "${EXCLUDE[@]}"; do
  rm -rf "${WORK:?}/$path"
done

git -C "$WORK" add -A -f
git -C "$WORK" \
  -c user.name="Kleopolis" -c user.email="noreply@github.com" \
  commit -q --allow-empty -m "Source of build ${SHA:-$REV}"

if [ -n "$SHA" ]; then
  git -C "$WORK" tag "build-$SHA"
  git -C "$WORK" push -q origin main "refs/tags/build-$SHA"
else
  git -C "$WORK" push -q origin main
fi
