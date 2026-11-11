#!/usr/bin/env bash
set -euo pipefail

# Deploy the built output to the deploy branch while preserving the source tree on the original branch.
# The script enforces a clean state, rebuilds artifacts from main, publishes them to deploy,
# and restores the original branch when finished.

if ! command -v git >/dev/null 2>&1; then
  echo "git is required to run this script" >&2
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required to run this script" >&2
  exit 1
fi

# Ensure subsequent filesystem operations target the repository root regardless of invocation location.
repo_root=$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)
cd "$repo_root"

# Bail out if the checkout is dirty so we do not lose local work during resets or branch switches.
if [[ -n $(git status --porcelain) ]]; then
  echo "Working tree has uncommitted changes. Please commit or stash before deploying." >&2
  exit 1
fi

if ! original_branch=$(git symbolic-ref --quiet --short HEAD); then
  echo "Check out a branch before deploying; detached HEAD is not supported." >&2
  exit 1
fi

if [[ "$original_branch" == deploy ]]; then
  echo "Run this script from a source branch, not deploy." >&2
  exit 1
fi

git rev-parse --verify main >/dev/null

restore_branch() {
  local status=$?
  if ! git checkout "$original_branch"; then
    echo "Could not restore $original_branch; inspect the working tree before switching manually." >&2
    exit 1
  fi
  exit "$status"
}

# Move onto the deploy branch and align it with main as the starting point.
git fetch origin
trap restore_branch EXIT
if git show-ref --verify --quiet refs/heads/deploy; then
  git checkout deploy
else
  git checkout -b deploy
fi
git reset --hard main

# Produce a fresh build so the deploy branch contains exactly what Vite outputs.
npx --no-install tsc --noEmit
npx --no-install vite build --base=./ --outDir docs --emptyOutDir

# Confirm the build succeeded.
if [[ ! -f docs/index.html ]]; then
  echo "docs/index.html not found after build" >&2
  exit 1
fi

# Serve the prebuilt files without Jekyll processing.
touch docs/.nojekyll

# Commit and update the remote deploy branch.
git add --force docs/
if ! git diff --cached --quiet; then
  git commit -m "Deploy $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
fi
git push --force-with-lease -u origin deploy
