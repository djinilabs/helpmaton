#!/bin/bash

# Script to cleanup CloudWatch log groups for closed PRs
# Uses gh CLI to get open PRs and compares with existing CloudWatch log groups

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
    echo "  2. List all CloudWatch log groups with /aws/lambda/HelpmatonStagingPR prefix"
    echo "  3. Find log groups for closed PRs"
    echo "  4. Delete those log groups"
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
LOG_GROUP_PREFIX="/aws/lambda/HelpmatonStagingPR"

print_highlight "Starting cleanup of CloudWatch log groups for closed PRs"
print_status "AWS region: $AWS_REGION"
print_status "Log group prefix: $LOG_GROUP_PREFIX"

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

# Step 2: Get all CloudWatch log groups with HelpmatonStagingPR prefix
print_status "Fetching CloudWatch log groups with prefix: $LOG_GROUP_PREFIX"
LOG_GROUPS=$(aws logs describe-log-groups \
    --region "$AWS_REGION" \
    --log-group-name-prefix "$LOG_GROUP_PREFIX" \
    --query "logGroups[*].logGroupName" \
    --output text 2>/dev/null || echo "")

if [ -z "$LOG_GROUPS" ]; then
    print_warning "No CloudWatch log groups found with prefix: $LOG_GROUP_PREFIX"
    LOG_GROUPS=""
fi

# Convert to array, handling space-separated values
LOG_GROUPS_ARRAY=()
if [ -n "$LOG_GROUPS" ]; then
    # Split by spaces and filter out empty elements
    for log_group in $LOG_GROUPS; do
        if [ -n "$log_group" ]; then
            LOG_GROUPS_ARRAY+=("$log_group")
        fi
    done
fi

print_status "Found ${#LOG_GROUPS_ARRAY[@]} CloudWatch log groups: ${LOG_GROUPS_ARRAY[*]}"

# Step 3: Find log groups for closed PRs
print_status "Identifying log groups for closed PRs..."

CLOSED_PR_LOG_GROUPS=()

for LOG_GROUP in "${LOG_GROUPS_ARRAY[@]}"; do
    if [ -n "$LOG_GROUP" ]; then
        # Debug output
        if [ "$DEBUG" = true ]; then
            print_status "Processing log group: '$LOG_GROUP'"
        fi
        
        # Extract PR number from log group name (/aws/lambda/HelpmatonStagingPR123-* -> 123)
        # Pattern: /aws/lambda/HelpmatonStagingPR{PR_NUMBER}-*
        if [[ "$LOG_GROUP" =~ ^${LOG_GROUP_PREFIX}([0-9]+)- ]]; then
            PR_NUMBER="${BASH_REMATCH[1]}"
            if [ "$DEBUG" = true ]; then
                print_status "Extracted PR number: '$PR_NUMBER' from log group '$LOG_GROUP'"
            fi
        else
            if [ "$DEBUG" = true ]; then
                print_warning "Skipping log group '$LOG_GROUP' - does not match expected pattern '${LOG_GROUP_PREFIX}[number]-*'"
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
            CLOSED_PR_LOG_GROUPS+=("$LOG_GROUP")
            print_warning "PR #$PR_NUMBER is closed but log group $LOG_GROUP still exists"
        else
            if [ "$DEBUG" = true ]; then
                print_status "PR #$PR_NUMBER is still open, keeping log group $LOG_GROUP"
            fi
        fi
    fi
done

# Step 4: Process closed PR log groups
if [ ${#CLOSED_PR_LOG_GROUPS[@]} -eq 0 ]; then
    print_success "No closed PR log groups found to cleanup"
    exit 0
fi

print_highlight "Found ${#CLOSED_PR_LOG_GROUPS[@]} closed PR log groups to cleanup:"
for LOG_GROUP in "${CLOSED_PR_LOG_GROUPS[@]}"; do
    print_warning "  - $LOG_GROUP"
done

# Debug: Show what will be deleted
if [ "$DEBUG" = true ]; then
    print_status "Debug: CLOSED_PR_LOG_GROUPS array contents:"
    for i in "${!CLOSED_PR_LOG_GROUPS[@]}"; do
        print_status "  [$i] = '${CLOSED_PR_LOG_GROUPS[$i]}'"
    done
fi

# Confirmation prompt (unless --force is used)
if [ "$FORCE" = false ] && [ "$DRY_RUN" = false ]; then
    echo ""
    print_warning "This will permanently delete the following CloudWatch log groups:"
    for LOG_GROUP in "${CLOSED_PR_LOG_GROUPS[@]}"; do
        print_warning "  - $LOG_GROUP"
    done
    echo ""
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_status "Operation cancelled"
        exit 0
    fi
fi

# Step 5: Delete each closed PR log group
SUCCESS_COUNT=0
FAILED_COUNT=0

for LOG_GROUP in "${CLOSED_PR_LOG_GROUPS[@]}"; do
    print_highlight "Processing log group: $LOG_GROUP"
    
    if [ "$DRY_RUN" = true ]; then
        print_status "DRY RUN: Would delete log group: $LOG_GROUP"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
        if aws logs delete-log-group \
            --log-group-name "$LOG_GROUP" \
            --region "$AWS_REGION" 2>/dev/null; then
            print_success "Successfully deleted log group: $LOG_GROUP"
            SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        else
            print_error "Failed to delete log group: $LOG_GROUP"
            FAILED_COUNT=$((FAILED_COUNT + 1))
        fi
    fi
done

# Summary
print_highlight "Cleanup Summary:"
print_status "Total closed PR log groups found: ${#CLOSED_PR_LOG_GROUPS[@]}"
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

