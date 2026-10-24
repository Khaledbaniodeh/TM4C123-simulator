#!/usr/bin/env bash
# Publishes this CI run's PNG screenshots to the ci-artifacts branch, in the
# run's own directory (<dest>/, e.g. feat/clean-wire-routing/), and leaves
# every other directory as it is.
#
# Several runs can publish at the same moment (different branches finishing
# together), so a push can be rejected because another run pushed first. Each
# attempt therefore starts from the branch's latest tip: fetch it, replace
# only <dest>/ with this run's screenshots and README, commit, and push. The
# push is never forced, so other runs' screenshots and the branch history are
# kept. A failed attempt waits a bounded, growing delay and tries again on the
# new tip; when every attempt fails, the script fails.
#
# Usage: publish-screenshots.sh <results-dir> <dest> <readme-line>
#   results-dir  where the run's screenshots are (searched recursively for *.png)
#   dest         directory on the branch for this run (the branch name)
#   readme-line  first line of <dest>/README.md (run, commit, test result)
#
# Environment:
#   PUBLISH_REMOTE       git remote URL or path; required, never printed
#   PUBLISH_BRANCH       branch to publish to (default ci-artifacts)
#   PUBLISH_ATTEMPTS     attempts before giving up (default 5)
#   PUBLISH_BACKOFF      seconds; attempt n waits n x this plus up to 1 s (default 3)
#   PUBLISH_BEFORE_PUSH  test hook: shell command run before each push, with
#                        PUBLISH_ATTEMPT set to the attempt number
#
# Exit status: 0 published, unchanged, or no screenshots; 1 not published
# after every attempt; 2 invalid arguments.
set -euo pipefail
shopt -s globstar nullglob

if [ $# -ne 3 ]; then
  echo "usage: publish-screenshots.sh <results-dir> <dest> <readme-line>" >&2
  exit 2
fi
results=$1
dest=$2
readme=$3
remote=${PUBLISH_REMOTE:?PUBLISH_REMOTE is required}
branch=${PUBLISH_BRANCH:-ci-artifacts}
attempts=${PUBLISH_ATTEMPTS:-5}
backoff=${PUBLISH_BACKOFF:-3}

# <dest> is a relative path inside the branch: no absolute path, no "..", no .git.
case "/$dest/" in
  //|*/../*|*/./*|*/.git/*|*//*) echo "::error title=Screenshots not published::Invalid directory name '$dest'." >&2; exit 2 ;;
esac
if [ "${dest#/}" != "$dest" ]; then
  echo "::error title=Screenshots not published::Invalid directory name '$dest'." >&2
  exit 2
fi

files=()
if [ -d "$results" ]; then
  results=$(cd "$results" && pwd)
  files=("$results"/**/*.png)
fi
if [ ${#files[@]} -eq 0 ]; then
  echo "No screenshots produced."
  exit 0
fi

# Git output is shown only when a step fails, with the remote (which carries
# the token in CI) replaced.
redact() {
  local text=$1
  printf '%s\n' "${text//"$remote"/<remote>}"
}
quiet() {
  local output
  if ! output=$(git "$@" 2>&1); then
    redact "$output" >&2
    return 1
  fi
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# One attempt, in a fresh repository: returns 0 when published or unchanged,
# 1 to try again. (It runs in a subshell inside `if`, where `set -e` does not
# apply, so every step checks its own status.)
attempt_publish() {
  local attempt=$1 repo="$work/attempt-$1" status=0 heads file
  git init -q "$repo" && cd "$repo" || return 1
  git config user.name "github-actions[bot]" || return 1
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com" || return 1
  git config core.autocrlf false || return 1 # files are stored exactly as produced

  heads=$(git ls-remote --exit-code "$remote" "refs/heads/$branch" 2>&1) || status=$?
  if [ $status -eq 0 ]; then
    quiet fetch -q --depth=1 "$remote" "refs/heads/$branch" || { echo "Attempt $attempt: could not fetch $branch."; return 1; }
    quiet checkout -q -B "$branch" FETCH_HEAD || return 1
  elif [ $status -eq 2 ]; then
    echo "Branch $branch does not exist yet; it will be created."
    git checkout -q --orphan "$branch" || return 1
  else
    redact "$heads" >&2
    echo "Attempt $attempt: could not read $branch."
    return 1
  fi

  # Replace this run's directory only; everything else stays as fetched.
  rm -rf -- "$dest" && mkdir -p -- "$dest" || return 1
  for file in "${files[@]}"; do
    cp -- "$file" "$dest/$(basename -- "$file")" || return 1
  done
  printf '%s\n' "$readme" > "$dest/README.md" || return 1
  git add -A -- "$dest" || return 1
  if git diff --cached --quiet; then
    echo "Screenshots in $branch/$dest are unchanged; nothing to publish."
    return 0
  fi
  git commit -q -m "screenshots: $dest${GITHUB_SHA:+ @ ${GITHUB_SHA::7}}" || return 1

  if [ -n "${PUBLISH_BEFORE_PUSH:-}" ]; then
    PUBLISH_ATTEMPT=$attempt bash -c "$PUBLISH_BEFORE_PUSH"
  fi
  if quiet push -q "$remote" "HEAD:refs/heads/$branch"; then
    echo "Published ${#files[@]} screenshot(s) to $branch/$dest (attempt $attempt of $attempts)."
    return 0
  fi
  echo "Attempt $attempt: push rejected (another run may have published first)."
  return 1
}

for ((attempt = 1; attempt <= attempts; attempt++)); do
  if (attempt_publish "$attempt"); then
    if [ -n "${GITHUB_REPOSITORY:-}" ]; then
      echo "::notice title=Screenshots::https://github.com/${GITHUB_REPOSITORY}/tree/$branch/$dest"
    fi
    exit 0
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    delay=$((attempt * backoff))
    jitter=$((RANDOM % 1000))
    echo "Retrying on the latest $branch in ${delay}.$(printf '%03d' "$jitter") s."
    sleep "${delay}.$(printf '%03d' "$jitter")"
  fi
done
echo "::error title=Screenshots not published::Could not publish to $branch/$dest after $attempts attempts; the test result is unaffected." >&2
exit 1
