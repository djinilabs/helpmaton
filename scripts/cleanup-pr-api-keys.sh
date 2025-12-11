#!/bin/bash

# Script to cleanup API Gateway API Keys for closed PRs
# Uses gh CLI to get open PRs and compares with existing API Gateway API Keys

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_highlight() {
    echo -e "${CYAN}[HIGHLIGHT]${NC} $1"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [--dry-run] [--force] [--debug]"
    echo ""
    echo "Options:"
    echo "  --dry-run    Show what would be deleted without actually deleting"
    echo "  --force      Skip confirmation prompts"
    echo "  --debug      Enable debug output"
    echo ""
    echo "This script will:"
    echo "  1. Get all open PRs using GitHub CLI"
    echo "  2. List all API Gateway API Keys with HelpmatonStagingPR prefix"
    echo "  3. Find API keys for closed PRs"
    echo "  4. Delete those API keys"
    echo ""
    echo "Prerequisites:"
    echo "  - GitHub CLI (gh) installed and authenticated"
    echo "  - AWS CLI configured with appropriate permissions"
}

# Parse arguments
DRY_RUN=false
FORCE=false
DEBUG=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --force)
            FORCE=true
            shift
            ;;
        --debug)
            DEBUG=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Set variables
AWS_REGION="eu-west-2"
API_KEY_PREFIX="HelpmatonStagingPR"

print_highlight "Starting cleanup of API Gateway API Keys for closed PRs"
print_status "AWS region: $AWS_REGION"
print_status "API key prefix: $API_KEY_PREFIX"

if [ "$DRY_RUN" = true ]; then
    print_warning "DRY RUN MODE - No actual deletions will be performed"
fi

# Check prerequisites
print_status "Checking prerequisites..."

# Check if gh CLI is available
if ! command -v gh &> /dev/null; then
    print_error "GitHub CLI (gh) is not installed or not in PATH"
    print_error "Install it from: https://cli.github.com/"
    exit 1
fi

# Check if AWS CLI is available
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed or not in PATH"
    exit 1
fi

# Check gh authentication
if ! gh auth status &> /dev/null; then
    print_error "GitHub CLI is not authenticated"
    print_error "Run: gh auth login"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    print_error "AWS credentials not configured or invalid"
    exit 1
fi

print_success "All prerequisites met"

# Get repository name
REPO_NAME=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")
if [ -z "$REPO_NAME" ]; then
    print_error "Could not determine repository name. Are you in a git repository?"
    exit 1
fi

print_status "Repository: $REPO_NAME"

# Step 1: Get all open PRs
print_status "Fetching open PRs..."
OPEN_PRS=$(gh pr list --state open --json number -q '.[].number' 2>/dev/null || echo "")
if [ -z "$OPEN_PRS" ]; then
    print_warning "No open PRs found or error fetching PRs"
    OPEN_PRS=""
fi

# Convert to array for easier processing, filtering out empty lines
OPEN_PRS_ARRAY=()
if [ -n "$OPEN_PRS" ]; then
    while IFS= read -r line; do
        if [ -n "$line" ] && [[ "$line" =~ ^[0-9]+$ ]]; then
            OPEN_PRS_ARRAY+=("$line")
        fi
    done <<< "$OPEN_PRS"
fi

print_status "Found ${#OPEN_PRS_ARRAY[@]} open PRs: ${OPEN_PRS_ARRAY[*]}"

# Step 2: Get all API Gateway API Keys with HelpmatonStagingPR prefix
print_status "Fetching API Gateway API Keys with prefix: $API_KEY_PREFIX"
# Use --name-query to filter by prefix, then extract id and name
API_KEYS_JSON=$(aws apigateway get-api-keys \
    --region "$AWS_REGION" \
    --name-query "$API_KEY_PREFIX" \
    --include-values \
    --query "items[*].[id,name]" \
    --output json 2>/dev/null || echo "[]")

if [ -z "$API_KEYS_JSON" ] || [ "$API_KEYS_JSON" = "[]" ]; then
    print_warning "No API Gateway API Keys found with prefix: $API_KEY_PREFIX"
    API_KEYS_JSON="[]"
fi

# Parse JSON and convert to arrays
# Using jq if available, otherwise fall back to manual parsing
if command -v jq &> /dev/null; then
    # Use jq to parse JSON
    API_KEY_IDS=($(echo "$API_KEYS_JSON" | jq -r '.[] | .[0]' 2>/dev/null || echo ""))
    API_KEY_NAMES=($(echo "$API_KEYS_JSON" | jq -r '.[] | .[1]' 2>/dev/null || echo ""))
else
    # Fallback: manual parsing (basic, may not handle all edge cases)
    print_warning "jq not found, using basic JSON parsing (may be less reliable)"
    # Extract IDs and names using grep and awk
    API_KEY_IDS=($(echo "$API_KEYS_JSON" | grep -o '"[^"]*"' | sed 's/"//g' | awk 'NR%2==1' || echo ""))
    API_KEY_NAMES=($(echo "$API_KEYS_JSON" | grep -o '"[^"]*"' | sed 's/"//g' | awk 'NR%2==0' || echo ""))
fi

# Create associative array mapping names to IDs
declare -A API_KEY_MAP
for i in "${!API_KEY_IDS[@]}"; do
    if [ -n "${API_KEY_IDS[$i]}" ] && [ -n "${API_KEY_NAMES[$i]}" ]; then
        API_KEY_MAP["${API_KEY_NAMES[$i]}"]="${API_KEY_IDS[$i]}"
    fi
done

print_status "Found ${#API_KEY_IDS[@]} API Gateway API Keys"

# Step 3: Find API keys for closed PRs
print_status "Identifying API keys for closed PRs..."

CLOSED_PR_API_KEYS=()

for API_KEY_NAME in "${!API_KEY_MAP[@]}"; do
    if [ -n "$API_KEY_NAME" ]; then
        # Debug output
        if [ "$DEBUG" = true ]; then
            print_status "Processing API key: '$API_KEY_NAME'"
        fi
        
        # Extract PR number from API key name
        # Pattern: HelpmatonStagingPR{PR_NUMBER} or HelpmatonStagingPR{PR_NUMBER}-*
        if [[ "$API_KEY_NAME" =~ ^${API_KEY_PREFIX}([0-9]+) ]]; then
            PR_NUMBER="${BASH_REMATCH[1]}"
            if [ "$DEBUG" = true ]; then
                print_status "Extracted PR number: '$PR_NUMBER' from API key '$API_KEY_NAME'"
            fi
        else
            if [ "$DEBUG" = true ]; then
                print_warning "Skipping API key '$API_KEY_NAME' - does not match expected pattern '${API_KEY_PREFIX}[number]' or '${API_KEY_PREFIX}[number]-*'"
            fi
            continue
        fi
        
        # Check if this PR number is in the open PRs list
        IS_OPEN=false
        for OPEN_PR in "${OPEN_PRS_ARRAY[@]}"; do
            if [ "$PR_NUMBER" = "$OPEN_PR" ]; then
                IS_OPEN=true
                break
            fi
        done
        
        if [ "$IS_OPEN" = false ]; then
            CLOSED_PR_API_KEYS+=("${API_KEY_MAP[$API_KEY_NAME]}")
            print_warning "PR #$PR_NUMBER is closed but API key '$API_KEY_NAME' (ID: ${API_KEY_MAP[$API_KEY_NAME]}) still exists"
        else
            if [ "$DEBUG" = true ]; then
                print_status "PR #$PR_NUMBER is still open, keeping API key '$API_KEY_NAME'"
            fi
        fi
    fi
done

# Step 4: Process closed PR API keys
if [ ${#CLOSED_PR_API_KEYS[@]} -eq 0 ]; then
    print_success "No closed PR API keys found to cleanup"
    exit 0
fi

print_highlight "Found ${#CLOSED_PR_API_KEYS[@]} closed PR API keys to cleanup:"
for API_KEY_ID in "${CLOSED_PR_API_KEYS[@]}"; do
    # Find the name for this ID
    for name in "${!API_KEY_MAP[@]}"; do
        if [ "${API_KEY_MAP[$name]}" = "$API_KEY_ID" ]; then
            print_warning "  - $name (ID: $API_KEY_ID)"
            break
        fi
    done
done

# Debug: Show what will be deleted
if [ "$DEBUG" = true ]; then
    print_status "Debug: CLOSED_PR_API_KEYS array contents:"
    for i in "${!CLOSED_PR_API_KEYS[@]}"; do
        print_status "  [$i] = '${CLOSED_PR_API_KEYS[$i]}'"
    done
fi

# Confirmation prompt (unless --force is used)
if [ "$FORCE" = false ] && [ "$DRY_RUN" = false ]; then
    echo ""
    print_warning "This will permanently delete the following API Gateway API Keys:"
    for API_KEY_ID in "${CLOSED_PR_API_KEYS[@]}"; do
        # Find the name for this ID
        for name in "${!API_KEY_MAP[@]}"; do
            if [ "${API_KEY_MAP[$name]}" = "$API_KEY_ID" ]; then
                print_warning "  - $name (ID: $API_KEY_ID)"
                break
            fi
        done
    done
    echo ""
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_status "Operation cancelled"
        exit 0
    fi
fi

# Step 5: Delete each closed PR API key
SUCCESS_COUNT=0
FAILED_COUNT=0

for API_KEY_ID in "${CLOSED_PR_API_KEYS[@]}"; do
    # Find the name for this ID for display
    API_KEY_NAME=""
    for name in "${!API_KEY_MAP[@]}"; do
        if [ "${API_KEY_MAP[$name]}" = "$API_KEY_ID" ]; then
            API_KEY_NAME="$name"
            break
        fi
    done
    
    print_highlight "Processing API key: ${API_KEY_NAME:-$API_KEY_ID} (ID: $API_KEY_ID)"
    
    if [ "$DRY_RUN" = true ]; then
        print_status "DRY RUN: Would delete API key: ${API_KEY_NAME:-$API_KEY_ID} (ID: $API_KEY_ID)"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
        if aws apigateway delete-api-key \
            --api-key "$API_KEY_ID" \
            --region "$AWS_REGION" 2>/dev/null; then
            print_success "Successfully deleted API key: ${API_KEY_NAME:-$API_KEY_ID} (ID: $API_KEY_ID)"
            SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        else
            print_error "Failed to delete API key: ${API_KEY_NAME:-$API_KEY_ID} (ID: $API_KEY_ID)"
            FAILED_COUNT=$((FAILED_COUNT + 1))
        fi
    fi
done

# Summary
print_highlight "Cleanup Summary:"
print_status "Total closed PR API keys found: ${#CLOSED_PR_API_KEYS[@]}"
print_success "Successfully processed: $SUCCESS_COUNT"

if [ "$FAILED_COUNT" -gt 0 ]; then
    print_error "Failed to process: $FAILED_COUNT"
    exit 1
fi

if [ "$DRY_RUN" = true ]; then
    print_warning "This was a dry run - no actual deletions were performed"
    print_status "Run without --dry-run to perform actual cleanup"
else
    print_success "Cleanup completed successfully"
fi

