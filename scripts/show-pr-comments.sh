#!/bin/bash

# Script to extract and display all non-dismissed comments from a PR
# Uses gh CLI to fetch comments and displays them in a human-readable format

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
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

print_comment() {
    echo -e "${MAGENTA}$1${NC}"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 <PR_NUMBER>"
    echo ""
    echo "Extracts and displays all non-dismissed comments from a GitHub PR."
    echo ""
    echo "Arguments:"
    echo "  PR_NUMBER    The number of the pull request"
    echo ""
    echo "Options:"
    echo "  -h, --help   Show this help message"
    echo ""
    echo "Prerequisites:"
    echo "  - GitHub CLI (gh) installed and authenticated"
    echo "  - jq installed (for JSON processing)"
    echo ""
    echo "Example:"
    echo "  $0 123"
}

# Parse arguments
if [ $# -eq 0 ]; then
    print_error "PR number is required"
    show_usage
    exit 1
fi

if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_usage
    exit 0
fi

PR_NUMBER="$1"

# Validate PR number is numeric
if ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
    print_error "PR number must be a positive integer"
    exit 1
fi

print_highlight "Fetching comments for PR #$PR_NUMBER"

# Check prerequisites
print_status "Checking prerequisites..."

# Check if gh CLI is available
if ! command -v gh &> /dev/null; then
    print_error "GitHub CLI (gh) is not installed or not in PATH"
    print_error "Install it from: https://cli.github.com/"
    exit 1
fi

# Check if jq is available
if ! command -v jq &> /dev/null; then
    print_error "jq is not installed or not in PATH"
    print_error "Install it from: https://stedolan.github.io/jq/"
    exit 1
fi

# Check gh authentication
if ! gh auth status &> /dev/null; then
    print_error "GitHub CLI is not authenticated"
    print_error "Run: gh auth login"
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

# Verify PR exists
print_status "Verifying PR #$PR_NUMBER exists..."
if ! gh pr view "$PR_NUMBER" --json number,title,state > /dev/null 2>&1; then
    print_error "PR #$PR_NUMBER not found or you don't have access to it"
    exit 1
fi

# Get PR info
PR_INFO=$(gh pr view "$PR_NUMBER" --json number,title,state,author --jq '{number: .number, title: .title, state: .state, author: .author.login}')
PR_TITLE=$(echo "$PR_INFO" | jq -r '.title')
PR_STATE=$(echo "$PR_INFO" | jq -r '.state')
PR_AUTHOR=$(echo "$PR_INFO" | jq -r '.author')

echo ""
print_highlight "═══════════════════════════════════════════════════════════════"
print_highlight "PR #$PR_NUMBER: $PR_TITLE"
print_highlight "State: $PR_STATE | Author: $PR_AUTHOR"
print_highlight "═══════════════════════════════════════════════════════════════"
echo ""

# Function to format date (handles ISO 8601 format from GitHub API)
format_date() {
    local date_str="$1"
    # Try macOS date format first (BSD date)
    if date -j -f "%Y-%m-%dT%H:%M:%SZ" "$date_str" "+%Y-%m-%d %H:%M:%S" 2>/dev/null; then
        return
    fi
    # Try GNU date format (Linux)
    if date -d "$date_str" "+%Y-%m-%d %H:%M:%S" 2>/dev/null; then
        return
    fi
    # Fallback: just show the original date
    echo "$date_str"
}

# Function to display a comment
display_comment() {
    local comment_type="$1"
    local author="$2"
    local body="$3"
    local created_at="$4"
    local path="$5"
    local original_line="$6"
    local original_start_line="$7"
    local line="$8"
    local start_line="$9"
    local diff_hunk="${10}"
    local side="${11}"
    local state="${12}"
    
    echo ""
    print_comment "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    print_comment "Type: $comment_type"
    if [ -n "$path" ] && [ "$path" != "null" ]; then
        print_comment "File: $path"
        
        # Display line information
        local line_info=""
        # Check if it's a multi-line comment (has both start and end)
        if [ -n "$start_line" ] && [ "$start_line" != "null" ] && [ -n "$line" ] && [ "$line" != "null" ] && [ "$start_line" != "$line" ]; then
            # Multi-line comment in diff
            line_info="Lines: $start_line-$line (in diff)"
            if [ -n "$original_start_line" ] && [ "$original_start_line" != "null" ] && [ -n "$original_line" ] && [ "$original_line" != "null" ]; then
                if [ "$original_start_line" != "$original_line" ]; then
                    line_info="$line_info | Original: $original_start_line-$original_line"
                else
                    line_info="$line_info | Original: $original_line"
                fi
            fi
        elif [ -n "$original_start_line" ] && [ "$original_start_line" != "null" ] && [ -n "$original_line" ] && [ "$original_line" != "null" ] && [ "$original_start_line" != "$original_line" ]; then
            # Multi-line comment in original file
            line_info="Lines: $original_start_line-$original_line (original)"
            if [ -n "$start_line" ] && [ "$start_line" != "null" ] && [ -n "$line" ] && [ "$line" != "null" ]; then
                line_info="$line_info | Diff: $start_line-$line"
            fi
        elif [ -n "$line" ] && [ "$line" != "null" ]; then
            # Single line comment in diff
            line_info="Line: $line (in diff)"
            if [ -n "$original_line" ] && [ "$original_line" != "null" ] && [ "$original_line" != "$line" ]; then
                line_info="$line_info | Original: $original_line"
            fi
        elif [ -n "$original_line" ] && [ "$original_line" != "null" ]; then
            # Single line comment in original file
            line_info="Line: $original_line (original)"
            if [ -n "$line" ] && [ "$line" != "null" ] && [ "$line" != "$original_line" ]; then
                line_info="$line_info | Diff: $line"
            fi
        fi
        
        if [ -n "$line_info" ]; then
            print_comment "$line_info"
        fi
        
        if [ -n "$side" ] && [ "$side" != "null" ]; then
            local side_label=""
            case "$side" in
                "LEFT") side_label="Original code" ;;
                "RIGHT") side_label="Proposed changes" ;;
                *) side_label="$side" ;;
            esac
            print_comment "Side: $side_label"
        fi
        
        # Display code snippet if available
        if [ -n "$diff_hunk" ] && [ "$diff_hunk" != "null" ] && [ "$diff_hunk" != "" ]; then
            echo ""
            print_comment "Code snippet:"
            echo -e "${CYAN}────────────────────────────────────────────────────────────${NC}"
            # Count lines first
            local line_count=$(echo "$diff_hunk" | wc -l | tr -d ' ')
            local max_lines=30
            local truncated=false
            if [ "$line_count" -gt "$max_lines" ]; then
                truncated=true
            fi
            
            # Display diff hunk with proper formatting (limit to max_lines for readability)
            # Preserve the diff format with + and - markers
            local line_num=0
            while IFS= read -r diff_line && [ "$line_num" -lt "$max_lines" ]; do
                # Color code diff lines: + for additions (green), - for deletions (red), @@ for context (yellow)
                if [[ "$diff_line" =~ ^\+ ]]; then
                    echo -e "${GREEN}$diff_line${NC}"
                elif [[ "$diff_line" =~ ^\- ]]; then
                    echo -e "${RED}$diff_line${NC}"
                elif [[ "$diff_line" =~ ^@@ ]]; then
                    echo -e "${YELLOW}$diff_line${NC}"
                else
                    echo "$diff_line"
                fi
                line_num=$((line_num + 1))
            done <<< "$diff_hunk"
            
            # Show indicator if truncated
            if [ "$truncated" = true ]; then
                echo -e "${YELLOW}... (truncated, showing first $max_lines of $line_count lines)${NC}"
            fi
            echo -e "${CYAN}────────────────────────────────────────────────────────────${NC}"
        fi
    fi
    print_comment "Author: $author"
    print_comment "Date: $created_at"
    if [ -n "$state" ] && [ "$state" != "null" ]; then
        print_comment "State: $state"
    fi
    print_comment "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "$body"
    echo ""
}

# Fetch review comments (comments on code) - these can be dismissed
print_status "Fetching review comments (code comments)..."
REVIEW_COMMENTS_JSON=$(gh api --paginate "repos/$REPO_NAME/pulls/$PR_NUMBER/comments?per_page=100" 2>/dev/null | jq -s 'add' || echo "[]")

# Fetch issue comments (general PR comments) - these cannot be dismissed
print_status "Fetching issue comments (general comments)..."
ISSUE_COMMENTS_JSON=$(gh api --paginate "repos/$REPO_NAME/issues/$PR_NUMBER/comments?per_page=100" 2>/dev/null | jq -s 'add' || echo "[]")

# Fetch reviews to check for dismissed reviews
# Comments that belong to dismissed reviews should also be excluded
print_status "Fetching reviews to check for dismissed reviews..."
REVIEWS_JSON=$(gh api --paginate "repos/$REPO_NAME/pulls/$PR_NUMBER/reviews?per_page=100" 2>/dev/null | jq -s 'add' || echo "[]")

# Also fetch review threads via GraphQL to check for resolved/outdated threads
# This is important because REST API doesn't expose thread resolution status
REPO_OWNER=$(echo "$REPO_NAME" | cut -d'/' -f1)
REPO_NAME_ONLY=$(echo "$REPO_NAME" | cut -d'/' -f2)

REVIEW_THREADS_JSON=$(gh api graphql --paginate \
  -f query="query(\$owner: String!, \$name: String!, \$number: Int!, \$endCursor: String) {
  repository(owner: \$owner, name: \$name) {
    pullRequest(number: \$number) {
      reviewThreads(first: 100, after: \$endCursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          isResolved
          isOutdated
          resolvedBy {
            login
          }
          comments(first: 100) {
            nodes {
              id
              databaseId
            }
          }
        }
      }
    }
  }
}" \
  -F owner="$REPO_OWNER" \
  -F name="$REPO_NAME_ONLY" \
  -F number="$PR_NUMBER" \
  2>/dev/null | jq -s '[.[].data.repository.pullRequest.reviewThreads.nodes[]] // []' || echo "[]")

# Process and combine all comments, filtering out dismissed ones
# Review comments can belong to a dismissed review or be part of resolved/outdated threads
# Issue comments don't have state and cannot be dismissed

ALL_COMMENTS=$(jq -n \
    --argjson review_comments "$REVIEW_COMMENTS_JSON" \
    --argjson issue_comments "$ISSUE_COMMENTS_JSON" \
    --argjson reviews "$REVIEWS_JSON" \
    --argjson review_threads "$REVIEW_THREADS_JSON" \
    '
    # Create a set of dismissed review IDs (as strings for consistent comparison)
    (($reviews // []) | map(select((.state | ascii_upcase) == "DISMISSED")) | map(.id | tostring)) as $dismissed_review_ids |
    # Create a set of comment IDs from resolved/outdated threads
    (($review_threads // []) | 
     map(select(.isResolved == true or .isOutdated == true)) | 
     map(.comments.nodes[].databaseId) | 
     flatten | 
     map(tostring)) as $resolved_or_outdated_comment_ids |
    # Process review comments
    (($review_comments // []) | map({
        id: .id,
        author: .user.login,
        body: .body,
        created_at: .created_at,
        path: .path,
        original_line: (.original_line // null),
        original_start_line: (.original_start_line // null),
        line: (.line // null),
        start_line: (.start_line // null),
        diff_hunk: (.diff_hunk // null),
        side: (.side // null),
        state: (.state // null),
        pull_request_review_id: (.pull_request_review_id // null)
    })) + (($issue_comments // []) | map({
        id: .id,
        author: .user.login,
        body: .body,
        created_at: .created_at,
        path: null,
        original_line: null,
        original_start_line: null,
        line: null,
        start_line: null,
        diff_hunk: null,
        side: null,
        state: null,
        pull_request_review_id: null
    })) |
    unique_by(.id) |
    # Filter out comments that:
    # 1. Belong to dismissed reviews, OR
    # 2. Are part of resolved or outdated threads
    map(select(
        (.pull_request_review_id == null or ((.pull_request_review_id | tostring) | IN($dismissed_review_ids[])) == false) and
        ((.id | tostring) | IN($resolved_or_outdated_comment_ids[])) == false
    ))
')

COMMENT_COUNT=$(echo "$ALL_COMMENTS" | jq 'length')

if [ "$COMMENT_COUNT" -eq 0 ]; then
    print_warning "No non-dismissed comments found for PR #$PR_NUMBER"
    exit 0
fi

print_success "Found $COMMENT_COUNT non-dismissed comment(s)"
echo ""

# Display each comment
echo "$ALL_COMMENTS" | jq -c '.[]' | while IFS= read -r comment; do
    COMMENT_TYPE="General Comment"
    AUTHOR=$(echo "$comment" | jq -r '.author')
    BODY=$(echo "$comment" | jq -r '.body')
    CREATED_AT=$(echo "$comment" | jq -r '.created_at')
    PATH_VAL=$(echo "$comment" | jq -r '.path // empty')
    ORIGINAL_LINE=$(echo "$comment" | jq -r '.original_line // empty')
    ORIGINAL_START_LINE=$(echo "$comment" | jq -r '.original_start_line // empty')
    LINE=$(echo "$comment" | jq -r '.line // empty')
    START_LINE=$(echo "$comment" | jq -r '.start_line // empty')
    DIFF_HUNK=$(echo "$comment" | jq -r '.diff_hunk // empty')
    SIDE=$(echo "$comment" | jq -r '.side // empty')
    STATE=$(echo "$comment" | jq -r '.state // empty')
    
    if [ -n "$PATH_VAL" ] && [ "$PATH_VAL" != "null" ]; then
        COMMENT_TYPE="Code Review Comment"
    fi
    
    FORMATTED_DATE=$(format_date "$CREATED_AT")
    
    display_comment "$COMMENT_TYPE" "$AUTHOR" "$BODY" "$FORMATTED_DATE" "$PATH_VAL" "$ORIGINAL_LINE" "$ORIGINAL_START_LINE" "$LINE" "$START_LINE" "$DIFF_HUNK" "$SIDE" "$STATE"
done

print_highlight "═══════════════════════════════════════════════════════════════"
print_success "Displayed $COMMENT_COUNT non-dismissed comment(s) for PR #$PR_NUMBER"
print_highlight "═══════════════════════════════════════════════════════════════"
