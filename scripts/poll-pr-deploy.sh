#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <pr-number> [--interval <seconds>] [--timeout <seconds>]" >&2
  exit 1
fi

PR_NUMBER="$1"
shift

INTERVAL_SECONDS=20
TIMEOUT_SECONDS=1800

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval)
      INTERVAL_SECONDS="$2"
      shift 2
      ;;
    --timeout)
      TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

START_TIME="$(date +%s)"
HEAD_BRANCH="$(gh pr view "$PR_NUMBER" --json headRefName --jq .headRefName)"

echo "Polling Deploy PR workflow for PR #${PR_NUMBER} (branch: ${HEAD_BRANCH})"

while true; do
  sleep 5
  NOW="$(date +%s)"
  ELAPSED=$((NOW - START_TIME))
  if [[ $ELAPSED -ge $TIMEOUT_SECONDS ]]; then
    echo "Timed out after ${TIMEOUT_SECONDS}s waiting for Deploy PR workflow." >&2
    exit 1
  fi

  RUN_JSON="$(gh run list --workflow "Deploy PR" --branch "$HEAD_BRANCH" --limit 1 --json status,conclusion,displayTitle,createdAt,updatedAt,url)"
  RUN_COUNT="$(echo "$RUN_JSON" | jq 'length')"
  if [[ "$RUN_COUNT" -eq 0 ]]; then
    echo "No Deploy PR runs found yet. Waiting..."
    sleep "$INTERVAL_SECONDS"
    continue
  fi

  STATUS="$(echo "$RUN_JSON" | jq -r '.[0].status')"
  CONCLUSION="$(echo "$RUN_JSON" | jq -r '.[0].conclusion')"
  URL="$(echo "$RUN_JSON" | jq -r '.[0].url')"
  UPDATED_AT="$(echo "$RUN_JSON" | jq -r '.[0].updatedAt')"

  echo "Deploy PR status: ${STATUS} (conclusion: ${CONCLUSION}) at ${UPDATED_AT}"
  echo "Run: ${URL}"

  if [[ "$STATUS" == "completed" ]]; then
    if [[ "$CONCLUSION" == "success" ]]; then
      exit 0
    fi
    exit 2
  fi

  sleep "$INTERVAL_SECONDS"
done
