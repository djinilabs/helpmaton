#!/bin/bash

# Script to configure CloudFront cache behavior for versioned assets
# Adds aggressive caching (1 year TTL) for /assets/*.js and /assets/*.css files

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

# Function to show usage
show_usage() {
    echo "Usage: $0 <DISTRIBUTION_ID> [--dry-run]"
    echo ""
    echo "Arguments:"
    echo "  DISTRIBUTION_ID  CloudFront distribution ID (required)"
    echo ""
    echo "Options:"
    echo "  --dry-run        Preview changes without applying them"
    echo ""
    echo "Examples:"
    echo "  $0 E16OQBGHIT46MP"
    echo "  $0 E16OQBGHIT46MP --dry-run"
    echo ""
    echo "This script will:"
    echo "  1. Create a custom cache policy for aggressive caching (1 year TTL)"
    echo "  2. Add a cache behavior for /assets/*.js and /assets/*.css with higher priority"
    echo "  3. Update the CloudFront distribution"
    echo "  4. Wait for deployment to complete"
    echo ""
    echo "Prerequisites:"
    echo "  - AWS CLI configured with appropriate permissions"
    echo "  - jq installed for JSON processing"
}

# Parse arguments
DRY_RUN=false
DISTRIBUTION_ID=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
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

# Validate required arguments
if [ -z "$DISTRIBUTION_ID" ]; then
    print_error "Distribution ID is required"
    show_usage
    exit 1
fi

# Check if AWS CLI is available
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed or not in PATH"
    exit 1
fi

# Check if jq is available
if ! command -v jq &> /dev/null; then
    print_error "jq is not installed. Please install jq for JSON processing."
    print_error "On macOS: brew install jq"
    print_error "On Ubuntu/Debian: sudo apt-get install jq"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    print_error "AWS credentials not configured or invalid"
    exit 1
fi

print_success "AWS CLI is configured and working"
print_status "Distribution ID: ${DISTRIBUTION_ID}"

if [ "$DRY_RUN" = true ]; then
    print_warning "DRY RUN MODE - No changes will be applied"
fi

# Step 1: Get current distribution configuration
print_status "Fetching current CloudFront distribution configuration..."
DIST_CONFIG=$(aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID" --output json)
ETAG=$(echo "$DIST_CONFIG" | jq -r '.ETag')
CONFIG=$(echo "$DIST_CONFIG" | jq -r '.DistributionConfig')

print_success "Retrieved distribution configuration (ETag: ${ETAG})"

# Extract S3 origin ID from default cache behavior
S3_ORIGIN_ID=$(echo "$CONFIG" | jq -r '.DefaultCacheBehavior.TargetOriginId')
print_status "S3 Origin ID: ${S3_ORIGIN_ID}"

# Check if cache behavior for /assets/* already exists
EXISTING_BEHAVIOR=$(echo "$CONFIG" | jq -r '.CacheBehaviors.Items[] | select(.PathPattern == "/assets/*") | .PathPattern')

if [ -n "$EXISTING_BEHAVIOR" ]; then
    print_warning "Cache behavior for /assets/* already exists"
    print_status "Checking if it needs to be updated..."
    
    # Check current cache policy
    CURRENT_POLICY_ID=$(echo "$CONFIG" | jq -r '.CacheBehaviors.Items[] | select(.PathPattern == "/assets/*") | .CachePolicyId')
    print_status "Current cache policy ID: ${CURRENT_POLICY_ID}"
    
    # For now, we'll update the existing behavior
    print_status "Will update existing cache behavior"
else
    print_status "No existing cache behavior for /assets/* found"
fi

# Step 2: Create or find cache policy for aggressive caching
CACHE_POLICY_NAME="Helpmaton-Versioned-Assets-Cache-Policy"
print_status "Checking for cache policy: ${CACHE_POLICY_NAME}"

# List existing cache policies and find by name
# The structure is: CachePolicyList.Items[].CachePolicy.CachePolicyConfig.Name
EXISTING_POLICY=$(aws cloudfront list-cache-policies --type custom --output json 2>/dev/null | \
    jq -r --arg name "$CACHE_POLICY_NAME" \
    '.CachePolicyList.Items[] | select(.CachePolicy.CachePolicyConfig.Name == $name) | .CachePolicy.Id' | \
    head -1)

# Check if policy exists
if [ -n "$EXISTING_POLICY" ] && [ "$EXISTING_POLICY" != "null" ]; then
    print_success "Found existing cache policy: ${EXISTING_POLICY}"
    CACHE_POLICY_ID="$EXISTING_POLICY"
else
    print_status "Creating new cache policy: ${CACHE_POLICY_NAME}"
    
    if [ "$DRY_RUN" = false ]; then
        # Create cache policy with aggressive caching settings
        CACHE_POLICY_OUTPUT=$(aws cloudfront create-cache-policy \
            --cache-policy-config "{
                \"Name\": \"${CACHE_POLICY_NAME}\",
                \"Comment\": \"Aggressive caching for versioned assets (JS/CSS with content hashes)\",
                \"DefaultTTL\": 31536000,
                \"MaxTTL\": 31536000,
                \"MinTTL\": 31536000,
                \"ParametersInCacheKeyAndForwardedToOrigin\": {
                    \"EnableAcceptEncodingGzip\": true,
                    \"EnableAcceptEncodingBrotli\": true,
                    \"HeadersConfig\": {
                        \"HeaderBehavior\": \"none\"
                    },
                    \"CookiesConfig\": {
                        \"CookieBehavior\": \"none\"
                    },
                    \"QueryStringsConfig\": {
                        \"QueryStringBehavior\": \"none\"
                    }
                }
            }" \
            --output json)
        
        CACHE_POLICY_ID=$(echo "$CACHE_POLICY_OUTPUT" | jq -r '.CachePolicy.CachePolicy.Id')
        print_success "Created cache policy: ${CACHE_POLICY_ID}"
    else
        print_status "[DRY RUN] Would create cache policy: ${CACHE_POLICY_NAME}"
        CACHE_POLICY_ID="DRY-RUN-POLICY-ID"
    fi
fi

# Step 3: Prepare cache behavior configuration
print_status "Preparing cache behavior configuration..."

# Get existing cache behaviors
EXISTING_BEHAVIORS=$(echo "$CONFIG" | jq -r '.CacheBehaviors.Items // []')
BEHAVIOR_COUNT=$(echo "$EXISTING_BEHAVIORS" | jq 'length')

# Create new cache behavior for /assets/*
NEW_BEHAVIOR=$(jq -n \
    --arg origin_id "$S3_ORIGIN_ID" \
    --arg policy_id "$CACHE_POLICY_ID" \
    '{
        "PathPattern": "/assets/*",
        "TargetOriginId": $origin_id,
        "TrustedSigners": {
            "Enabled": false,
            "Quantity": 0
        },
        "TrustedKeyGroups": {
            "Enabled": false,
            "Quantity": 0
        },
        "ViewerProtocolPolicy": "redirect-to-https",
        "AllowedMethods": {
            "Quantity": 2,
            "Items": ["HEAD", "GET"],
            "CachedMethods": {
                "Quantity": 2,
                "Items": ["HEAD", "GET"]
            }
        },
        "SmoothStreaming": false,
        "Compress": true,
        "LambdaFunctionAssociations": {
            "Quantity": 0
        },
        "FunctionAssociations": {
            "Quantity": 0
        },
        "FieldLevelEncryptionId": "",
        "CachePolicyId": $policy_id
    }')

# Check if behavior already exists
BEHAVIOR_EXISTS=$(echo "$EXISTING_BEHAVIORS" | jq -r 'any(.PathPattern == "/assets/*")')

if [ "$BEHAVIOR_EXISTS" = "true" ]; then
    print_status "Updating existing cache behavior for /assets/*"
    # Update the existing behavior
    UPDATED_BEHAVIORS=$(echo "$EXISTING_BEHAVIORS" | jq \
        --argjson new_behavior "$NEW_BEHAVIOR" \
        'map(if .PathPattern == "/assets/*" then $new_behavior else . end)')
else
    print_status "Adding new cache behavior for /assets/*"
    # Add new behavior at the beginning (higher priority - processed before other behaviors)
    UPDATED_BEHAVIORS=$(echo "$EXISTING_BEHAVIORS" | jq --argjson new_behavior "$NEW_BEHAVIOR" '[$new_behavior] + .')
fi

# Update the config with new behaviors
# Preserve all other config fields, only update CacheBehaviors
UPDATED_CONFIG=$(echo "$CONFIG" | jq \
    --argjson behaviors "$UPDATED_BEHAVIORS" \
    '.CacheBehaviors = {
        "Quantity": ($behaviors | length),
        "Items": $behaviors
    }')

# Validate the updated config has all required fields
REQUIRED_FIELDS=("Origins" "DefaultCacheBehavior" "Enabled" "CallerReference")
for field in "${REQUIRED_FIELDS[@]}"; do
    if ! echo "$UPDATED_CONFIG" | jq -e ".${field}" > /dev/null 2>&1; then
        print_error "Updated config is missing required field: ${field}"
        print_error "This should not happen - please report this issue"
        exit 1
    fi
done

# Step 4: Preview changes
print_status "Preview of changes:"
echo ""
echo "Cache Behavior Configuration:"
echo "$NEW_BEHAVIOR" | jq '.'
echo ""

if [ "$DRY_RUN" = true ]; then
    print_warning "DRY RUN - Changes would be applied but are not being saved"
    print_status "To apply changes, run without --dry-run flag"
    exit 0
fi

# Step 5: Update distribution
print_status "Updating CloudFront distribution..."
print_warning "This will take 5-15 minutes to deploy"

# Save config to temp file
TEMP_CONFIG=$(mktemp)
echo "$UPDATED_CONFIG" | jq '.' > "$TEMP_CONFIG"

# Debug: Show config summary
print_status "Config summary:"
print_status "  Cache behaviors: $(echo "$UPDATED_CONFIG" | jq '.CacheBehaviors.Quantity')"
print_status "  Origins: $(echo "$UPDATED_CONFIG" | jq '.Origins.Quantity')"
print_status "  Enabled: $(echo "$UPDATED_CONFIG" | jq '.Enabled')"

# Update distribution
print_status "Sending update request to CloudFront..."
if UPDATE_OUTPUT=$(aws cloudfront update-distribution \
    --id "$DISTRIBUTION_ID" \
    --if-match "$ETAG" \
    --distribution-config "file://${TEMP_CONFIG}" \
    --output json 2>&1); then
    NEW_ETAG=$(echo "$UPDATE_OUTPUT" | jq -r '.ETag')
    print_success "Distribution update initiated (New ETag: ${NEW_ETAG})"
    rm -f "$TEMP_CONFIG"
else
    EXIT_CODE=$?
    print_error "Failed to update distribution (exit code: ${EXIT_CODE})"
    echo "$UPDATE_OUTPUT"
    rm -f "$TEMP_CONFIG"
    
    # Check for common errors
    if echo "$UPDATE_OUTPUT" | grep -q "PreconditionFailed"; then
        print_error "ETag mismatch - distribution was modified by another process"
        print_status "Please run the script again to get the latest ETag"
    elif echo "$UPDATE_OUTPUT" | grep -q "InvalidArgument"; then
        print_error "Invalid configuration - check the error message above"
    fi
    
    exit 1
fi

# Step 6: Wait for deployment
print_status "Waiting for distribution to deploy..."
print_status "This may take 5-15 minutes. You can check status in AWS Console."

# Poll for deployment status
MAX_WAIT=1800  # 30 minutes
ELAPSED=0
INTERVAL=30

while [ $ELAPSED -lt $MAX_WAIT ]; do
    STATUS=$(aws cloudfront get-distribution --id "$DISTRIBUTION_ID" --query 'Distribution.Status' --output text 2>/dev/null || echo "UNKNOWN")
    
    if [ "$STATUS" = "Deployed" ]; then
        print_success "Distribution has been deployed successfully!"
        break
    elif [ "$STATUS" = "InProgress" ]; then
        print_status "Deployment in progress... (${ELAPSED}s elapsed)"
        sleep $INTERVAL
        ELAPSED=$((ELAPSED + INTERVAL))
    else
        print_warning "Distribution status: ${STATUS}"
        sleep $INTERVAL
        ELAPSED=$((ELAPSED + INTERVAL))
    fi
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
    print_warning "Deployment check timed out after ${MAX_WAIT} seconds"
    print_status "Please check deployment status manually in AWS Console"
    print_status "Distribution ID: ${DISTRIBUTION_ID}"
else
    print_success "Configuration complete!"
    print_status "Versioned assets (/assets/*.js and /assets/*.css) will now be cached for 1 year"
fi

