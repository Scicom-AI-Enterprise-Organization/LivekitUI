#!/usr/bin/env bash
# Tag the next patch release and push it.
#
# Pushing a vX.Y.Z tag is the ONLY thing that builds and publishes an image
# (.github/workflows/ci.yml). A push to main runs the cheap checks and stops.
#
# Finds the highest existing vX.Y.Z tag, bumps the patch number, creates an
# annotated tag in the usual "vX.Y.Z: <summary>" format and pushes it.
#
# Usage:
#   ./release.sh                    # summary = latest commit subject
#   ./release.sh "runtime livekit url"  # explicit summary
#   ./release.sh --dry-run          # show what would happen, change nothing
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

dry_run=0
msg=""
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) dry_run=1 ;;
    *) msg="$arg" ;;
  esac
done

# The tag must capture exactly what's in the repo — refuse a dirty tree.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: uncommitted changes — commit (or stash) first" >&2
  exit 1
fi

branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$branch" != "main" ]]; then
  echo "error: on branch '$branch' — releases are tagged from main" >&2
  exit 1
fi

# Sync tags + main so the bump is computed against reality. If local main
# is behind origin the tag would miss commits — bail. If it's ahead, push
# it as part of the release so the tag never points at an unpushed commit.
git fetch origin main --tags --quiet
if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "error: local main is behind origin/main — git pull first" >&2
  exit 1
fi

latest=$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | head -1)
if [[ -n "$latest" ]]; then
  IFS=. read -r major minor patch <<<"${latest#v}"
  next="v${major}.${minor}.$((patch + 1))"
else
  next="v1.0.0"
fi

[[ -n "$msg" ]] || msg=$(git log -1 --format=%s)

echo "latest tag : ${latest:-<none>}"
echo "new tag    : $next"
echo "annotation : $next: $msg"
echo "commit     : $(git log -1 --format='%h %s')"

if [[ $dry_run -eq 1 ]]; then
  echo "(dry run — nothing tagged or pushed)"
  exit 0
fi

git push origin main --quiet
git tag -a "$next" -m "$next: $msg"
git push origin "$next"

echo "done. CI will publish ${next#v} + latest to ECR:"
echo "  https://github.com/Scicom-AI-Enterprise-Organization/LivekitUI/actions"
echo
echo "Rolling it out is a separate step — the workflow has no deploy job."
echo "The container needs LIVEKIT_PUBLIC_URL=wss://<livekit-host> set, or the"
echo "browser falls back to ws://localhost:7880."
