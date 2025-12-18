#!/bin/bash

# Script to debug LanceDB metadata issues
# Checks CloudWatch logs for write and read operations to see where metadata gets lost

set -e

# Default to production stack
STACK_NAME="${1:-helpmaton-production}"

echo "=== LanceDB Metadata Debugging ==="
echo "Stack: $STACK_NAME"
echo ""

# Get the write queue Lambda name
WRITE_LAMBDA=$(aws cloudformation describe-stack-resources \
  --stack-name "$STACK_NAME" \
  --query "StackResources[?contains(LogicalResourceId, 'AgentTemporalGrainQueue')].PhysicalResourceId" \
  --output text 2>/dev/null | head -1)

if [ -z "$WRITE_LAMBDA" ]; then
  echo "❌ Could not find write queue Lambda function"
  echo "Searching for Lambda functions in stack..."
  aws cloudformation describe-stack-resources \
    --stack-name "$STACK_NAME" \
    --query "StackResources[?ResourceType=='AWS::Lambda::Function'].LogicalResourceId" \
    --output text
  exit 1
fi

echo "Write Lambda: $WRITE_LAMBDA"
echo ""

# Get recent write logs showing metadata being created
echo "=== Recent Write Logs (Creating metadata) ==="
aws logs filter-log-events \
  --log-group-name "/aws/lambda/$WRITE_LAMBDA" \
  --filter-pattern "[Memory Write] Created record with metadata" \
  --start-time $(($(date +%s) - 3600))000 \
  --limit 3 \
  --query 'events[*].message' \
  --output text 2>/dev/null | head -20

echo ""
echo "=== Recent Write Logs (Sample record metadata being inserted) ==="
aws logs filter-log-events \
  --log-group-name "/aws/lambda/$WRITE_LAMBDA" \
  --filter-pattern "[Write Server] Sample record metadata being inserted" \
  --start-time $(($(date +%s) - 3600))000 \
  --limit 3 \
  --query 'events[*].message' \
  --output text 2>/dev/null | head -20

echo ""
echo "=== Recent Write Logs (Creating table with sample record metadata) ==="
aws logs filter-log-events \
  --log-group-name "/aws/lambda/$WRITE_LAMBDA" \
  --filter-pattern "[Write Server] Creating table with sample record metadata" \
  --start-time $(($(date +%s) - 3600))000 \
  --limit 3 \
  --query 'events[*].message' \
  --output text 2>/dev/null | head -20

echo ""
echo "=== Finding Lambda functions that might read from LanceDB ==="
# Look for functions that contain stream, test, or agent in the name
aws cloudformation describe-stack-resources \
  --stack-name "$STACK_NAME" \
  --query "StackResources[?ResourceType=='AWS::Lambda::Function' && (contains(LogicalResourceId, 'Stream') || contains(LogicalResourceId, 'Test') || contains(LogicalResourceId, 'Agent'))].{Name:LogicalResourceId,Physical:PhysicalResourceId}" \
  --output table

echo ""
echo "=== Instructions ==="
echo "1. Check if write logs show correct metadata (conversationId, workspaceId, agentId with actual values)"
echo "2. If write logs show null values, the issue is in writeToWorkingMemory()"
echo "3. If write logs show correct values but read logs show null, the issue is in LanceDB storage/retrieval"
echo "4. Check the read logs from the Lambda function that uses search_memory or agent memory tools"
echo ""
echo "To check read logs for a specific Lambda, run:"
echo "  aws logs tail /aws/lambda/LAMBDA_FUNCTION_NAME --follow"
