#!/bin/bash

# Script to recreate LanceDB tables with correct metadata schema
# This fixes the issue where tables were created with nullable metadata fields

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== LanceDB Table Recreation Script ===${NC}"
echo ""
echo "This script will:"
echo "1. Delete existing vector databases (LanceDB tables)"
echo "2. The tables will be recreated with correct schema on next write"
echo ""

# Get stack name from argument or default to production
STACK_NAME="${1:-helpmaton-production}"
echo "Stack: $STACK_NAME"
echo ""

# Determine S3 bucket name based on stack
if [[ "$STACK_NAME" == "helpmaton-production" ]]; then
  BUCKET_NAME="helpmaton-vector-db-production"
elif [[ "$STACK_NAME" =~ ^helpmaton-pr- ]]; then
  # Extract PR number from stack name (e.g., helpmaton-pr-123)
  PR_NUM=$(echo "$STACK_NAME" | sed 's/helpmaton-pr-//')
  BUCKET_NAME="helpmaton-vector-db-pr-${PR_NUM}"
else
  echo -e "${RED}❌ Unknown stack name: $STACK_NAME${NC}"
  echo "Expected 'helpmaton-production' or 'helpmaton-pr-XXX'"
  exit 1
fi

echo "S3 Bucket: $BUCKET_NAME"
echo ""

# Check if bucket exists
if ! aws s3 ls "s3://$BUCKET_NAME" &> /dev/null; then
  echo -e "${RED}❌ Bucket does not exist: $BUCKET_NAME${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Bucket found${NC}"
echo ""

# Optional: Specify an agent ID to delete only that agent's databases
AGENT_ID="${2:-}"

if [ -n "$AGENT_ID" ]; then
  echo -e "${YELLOW}Deleting databases for specific agent: $AGENT_ID${NC}"
  PREFIX="agents/$AGENT_ID/"
else
  echo -e "${YELLOW}Deleting ALL agent databases${NC}"
  PREFIX="agents/"
fi

# List what will be deleted
echo ""
echo "Listing databases to be deleted:"
aws s3 ls "s3://$BUCKET_NAME/$PREFIX" --recursive | head -20

TOTAL_OBJECTS=$(aws s3 ls "s3://$BUCKET_NAME/$PREFIX" --recursive | wc -l)
echo ""
echo -e "${YELLOW}Total objects to delete: $TOTAL_OBJECTS${NC}"

if [ "$TOTAL_OBJECTS" -eq 0 ]; then
  echo -e "${GREEN}✅ No objects to delete (databases are empty or don't exist)${NC}"
  exit 0
fi

# Confirm deletion
echo ""
echo -e "${RED}⚠️  WARNING: This will DELETE all vector databases!${NC}"
echo "You will lose all stored embeddings and they will need to be regenerated."
echo ""
read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

# Delete the databases
echo ""
echo "Deleting databases..."
aws s3 rm "s3://$BUCKET_NAME/$PREFIX" --recursive

echo ""
echo -e "${GREEN}✅ Deletion complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Deploy the updated code with the metadata schema fix"
echo "2. Create new conversations - they will recreate the tables with correct schema"
echo "3. Or run: pnpm run-all-memory-summaries (to regenerate from existing conversations)"
echo ""
echo "To verify the fix:"
echo "  ./scripts/test-lancedb-metadata.mjs <workspaceId> <agentId>"
