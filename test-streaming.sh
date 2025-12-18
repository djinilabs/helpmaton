#!/bin/bash

# Test script for streaming Lambda function
# Usage: ./test-streaming.sh <workspace-id> <agent-id> <secret> [message]

STREAM_URL="https://47oy6ijpdkmgwlxr6ydflaschu0jtbnf.lambda-url.eu-west-2.on.aws"
WORKSPACE_ID="${1:-test-workspace}"
AGENT_ID="${2:-test-agent}"
SECRET="${3:-test-secret}"
MESSAGE="${4:-Hello, this is a test message}"

echo "Testing streaming endpoint..."
echo "URL: ${STREAM_URL}/api/streams/${WORKSPACE_ID}/${AGENT_ID}/${SECRET}"
echo "Message: ${MESSAGE}"
echo "---"

curl -N -X POST "${STREAM_URL}/api/streams/${WORKSPACE_ID}/${AGENT_ID}/${SECRET}" \
  -H "Content-Type: application/json" \
  -H "Origin: https://app.helpmaton.com" \
  -d "[{\"role\":\"user\",\"content\":\"${MESSAGE}\"}]" \
  2>&1 | while IFS= read -r line; do
    echo "$line"
    # Stop after receiving done event or error
    if [[ "$line" == *"\"type\":\"done\""* ]] || [[ "$line" == *"\"type\":\"error\""* ]]; then
      break
    fi
  done

echo ""
echo "---"
echo "Test complete"


