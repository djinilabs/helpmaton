#!/bin/bash

# Script to cleanup CloudFormation stacks for closed PRs
# Uses gh CLI to get open PRs and compares with existing CloudFormation stacks

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
    echo "  2. List all CloudFormation stacks with HelpmatonStagingPR prefix"
    echo "  3. Find stacks for closed PRs"
    echo "  4. Undeploy those stacks using undeploy-pr.sh"
    echo ""
    echo "Prerequisites:"
    echo "  - GitHub CLI (gh) installed and authenticated"
    echo "  - AWS CLI configured with appropriate permissions"
    echo "  - undeploy-pr.sh script in the same directory"
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
STACK_PREFIX="HelpmatonStagingPR"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNDEPLOY_SCRIPT="$SCRIPT_DIR/undeploy-pr.sh"

print_highlight "Starting cleanup of closed PR stacks"
print_status "AWS region: $AWS_REGION"
print_status "Stack prefix: $STACK_PREFIX"

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

# Check if undeploy script exists
if [ ! -f "$UNDEPLOY_SCRIPT" ]; then
    print_error "undeploy-pr.sh script not found at: $UNDEPLOY_SCRIPT"
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

# Step 2: Get all CloudFormation stacks with HelpmatonStagingPR prefix
print_status "Fetching CloudFormation stacks with prefix: $STACK_PREFIX"
STACKS=$(aws cloudformation list-stacks \
    --region "$AWS_REGION" \
    --query "StackSummaries[?starts_with(StackName, '$STACK_PREFIX') && StackStatus != 'DELETE_COMPLETE'].StackName" \
    --output text 2>/dev/null || echo "")

if [ -z "$STACKS" ]; then
    print_warning "No CloudFormation stacks found with prefix: $STACK_PREFIX"
    STACKS=""
fi

# Convert to array, handling space-separated values
STACKS_ARRAY=()
if [ -n "$STACKS" ]; then
    # Split by spaces and filter out empty elements
    for stack in $STACKS; do
        if [ -n "$stack" ]; then
            STACKS_ARRAY+=("$stack")
        fi
    done
fi

print_status "Found ${#STACKS_ARRAY[@]} CloudFormation stacks: ${STACKS_ARRAY[*]}"

# Step 3: Find stacks for closed PRs
print_status "Identifying stacks for closed PRs..."

CLOSED_PR_STACKS=()

for STACK in "${STACKS_ARRAY[@]}"; do
    if [ -n "$STACK" ]; then
        # Debug output
        if [ "$DEBUG" = true ]; then
            print_status "Processing stack: '$STACK'"
        fi
        
        # Extract PR number from stack name (HelpmatonStagingPR123 -> 123)
        # Use a more robust extraction method
        if [[ "$STACK" =~ ^${STACK_PREFIX}([0-9]+)$ ]]; then
            PR_NUMBER="${BASH_REMATCH[1]}"
            if [ "$DEBUG" = true ]; then
                print_status "Extracted PR number: '$PR_NUMBER'"
            fi
        else
            print_warning "Skipping stack '$STACK' - does not match expected pattern '${STACK_PREFIX}[number]'"
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
            CLOSED_PR_STACKS+=("$PR_NUMBER")
            print_warning "PR #$PR_NUMBER is closed but stack $STACK still exists"
        else
            print_status "PR #$PR_NUMBER is still open, keeping stack $STACK"
        fi
    fi
done

# Step 4: Process closed PR stacks
if [ ${#CLOSED_PR_STACKS[@]} -eq 0 ]; then
    print_success "No closed PR stacks found to cleanup"
    exit 0
fi

print_highlight "Found ${#CLOSED_PR_STACKS[@]} closed PR stacks to cleanup: ${CLOSED_PR_STACKS[*]}"

# Debug: Show what will be passed to undeploy script
if [ "$DEBUG" = true ]; then
    print_status "Debug: CLOSED_PR_STACKS array contents:"
    for i in "${!CLOSED_PR_STACKS[@]}"; do
        print_status "  [$i] = '${CLOSED_PR_STACKS[$i]}'"
    done
fi

# Confirmation prompt (unless --force is used)
if [ "$FORCE" = false ] && [ "$DRY_RUN" = false ]; then
    echo ""
    print_warning "This will permanently delete the following PR stacks:"
    for PR_NUMBER in "${CLOSED_PR_STACKS[@]}"; do
        print_warning "  - HelpmatonStagingPR$PR_NUMBER"
    done
    echo ""
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_status "Operation cancelled"
        exit 0
    fi
fi

# Step 5: Undeploy each closed PR stack
SUCCESS_COUNT=0
FAILED_COUNT=0

for PR_NUMBER in "${CLOSED_PR_STACKS[@]}"; do
    print_highlight "Processing PR #$PR_NUMBER..."
    
    # Debug: Show what we're passing to the undeploy script
    if [ "$DEBUG" = true ]; then
        print_status "Debug: About to call undeploy script with PR_NUMBER='$PR_NUMBER'"
    fi
    
    if [ "$DRY_RUN" = true ]; then
        print_status "DRY RUN: Would undeploy PR #$PR_NUMBER"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
        # Build arguments for undeploy script
        UNDEPLOY_ARGS=("$PR_NUMBER")
        if [ "$FORCE" = true ]; then
            UNDEPLOY_ARGS+=("--force")
        fi

        if "$UNDEPLOY_SCRIPT" "${UNDEPLOY_ARGS[@]}"; then
            print_success "Successfully undeployed PR #$PR_NUMBER"
            SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        else
            print_error "Failed to undeploy PR #$PR_NUMBER"
            FAILED_COUNT=$((FAILED_COUNT + 1))
        fi
    fi
    
    echo ""  # Add spacing between PRs
done

# Summary
print_highlight "Cleanup Summary:"
print_status "Total closed PR stacks found: ${#CLOSED_PR_STACKS[@]}"
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

