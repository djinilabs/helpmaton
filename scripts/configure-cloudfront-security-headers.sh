#!/bin/bash

# Script to attach a response headers policy to the CloudFront distribution
# serving app.helpmaton.com so that security headers (including X-Frame-Options: DENY)
# are emitted and the app is not embeddable in a frame.
#
# Uses the AWS managed "SecurityHeadersPolicy" which includes:
# - X-Frame-Options: DENY
# - X-Content-Type-Options: nosniff
# - Strict-Transport-Security
# - Referrer-Policy

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

show_usage() {
    echo "Usage: $0 <DISTRIBUTION_ID> [--dry-run]"
    echo ""
    echo "Attaches the AWS managed SecurityHeadersPolicy to the CloudFront distribution"
    echo "so that security headers (e.g. X-Frame-Options: DENY) are sent and the app"
    echo "is not embeddable in a frame."
    echo ""
    echo "Arguments:"
    echo "  DISTRIBUTION_ID  CloudFront distribution ID (required)"
    echo ""
    echo "Options:"
    echo "  --dry-run        Preview changes without applying them"
    echo ""
    echo "Prerequisites: AWS CLI, jq"
}

DRY_RUN=false
DISTRIBUTION_ID=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run) DRY_RUN=true; shift ;;
        -h|--help) show_usage; exit 0 ;;
        -*)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
        *)
            if [ -z "$DISTRIBUTION_ID" ]; then
                DISTRIBUTION_ID="$1"
            else
                print_error "Unexpected argument: $1"
                show_usage
                exit 1
            fi
            shift
            ;;
    esac
done

if [ -z "$DISTRIBUTION_ID" ]; then
    print_error "DISTRIBUTION_ID is required"
    show_usage
    exit 1
fi

# Resolve AWS managed SecurityHeadersPolicy ID
print_status "Resolving AWS managed SecurityHeadersPolicy..."
MANAGED_POLICIES=$(aws cloudfront list-response-headers-policies --type managed --output json 2>/dev/null) || true
if [ -z "$MANAGED_POLICIES" ]; then
    print_error "Failed to list managed response headers policies"
    exit 1
fi

POLICY_ID=$(echo "$MANAGED_POLICIES" | jq -r '
    .ResponseHeadersPolicyList.Items[]? |
    select(.ResponseHeadersPolicy.ResponseHeadersPolicyConfig.Name == "Managed-SecurityHeadersPolicy") |
    .ResponseHeadersPolicy.Id
' | head -1)

if [ -z "$POLICY_ID" ] || [ "$POLICY_ID" = "null" ]; then
    print_error "Could not find managed Managed-SecurityHeadersPolicy. Check AWS CLI and permissions."
    exit 1
fi
print_success "Using managed policy ID: ${POLICY_ID}"

# Get current distribution config
print_status "Fetching CloudFront distribution configuration..."
DIST_CONFIG=$(aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID" --output json)
ETAG=$(echo "$DIST_CONFIG" | jq -r '.ETag')
CONFIG=$(echo "$DIST_CONFIG" | jq -r '.DistributionConfig')

# Attach policy to default cache behavior
print_status "Attaching response headers policy to default cache behavior..."
UPDATED_CONFIG=$(echo "$CONFIG" | jq --arg policy_id "$POLICY_ID" \
    '.DefaultCacheBehavior.ResponseHeadersPolicyId = $policy_id')

# Attach policy to custom cache behaviors that don't have one
BEHAVIORS=$(echo "$UPDATED_CONFIG" | jq -r '.CacheBehaviors.Items // []')
if [ "$BEHAVIORS" != "[]" ] && [ -n "$BEHAVIORS" ]; then
    print_status "Attaching response headers policy to custom cache behaviors..."
    UPDATED_BEHAVIORS=$(echo "$BEHAVIORS" | jq --arg policy_id "$POLICY_ID" '
        map(.ResponseHeadersPolicyId = $policy_id)
    ')
    UPDATED_CONFIG=$(echo "$UPDATED_CONFIG" | jq --argjson behaviors "$UPDATED_BEHAVIORS" \
        '.CacheBehaviors.Items = $behaviors')
fi

if [ "$DRY_RUN" = true ]; then
    print_warning "DRY RUN - No changes applied"
    print_status "DefaultCacheBehavior.ResponseHeadersPolicyId would be set to: ${POLICY_ID}"
    exit 0
fi

# Update distribution
print_status "Updating CloudFront distribution (deployment may take 5-15 minutes)..."
TEMP_CONFIG=$(mktemp)
echo "$UPDATED_CONFIG" | jq '.' > "$TEMP_CONFIG"

if UPDATE_OUTPUT=$(aws cloudfront update-distribution \
    --id "$DISTRIBUTION_ID" \
    --if-match "$ETAG" \
    --distribution-config "file://${TEMP_CONFIG}" \
    --output json 2>&1); then
    rm -f "$TEMP_CONFIG"
    print_success "Distribution update initiated. Security headers will apply after deployment."
else
    EXIT_CODE=$?
    rm -f "$TEMP_CONFIG"
    print_error "Failed to update distribution (exit code: ${EXIT_CODE})"
    echo "$UPDATE_OUTPUT"
    exit 1
fi
