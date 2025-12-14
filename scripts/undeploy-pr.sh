#!/bin/bash

# Script to manually undeploy a PR stack
# Based on .github/workflows/pr-undeploy.yml

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
    echo "Usage: $0 <PR_NUMBER> [--force]"
    echo ""
    echo "Arguments:"
    echo "  PR_NUMBER    The pull request number to undeploy"
    echo "  --force      Skip confirmation prompt"
    echo ""
    echo "Examples:"
    echo "  $0 123"
    echo "  $0 123 --force"
    echo ""
    echo "This script will:"
    echo "  1. Check if the CloudFormation stack exists"
    echo "  2. Delete S3 bucket contents for the PR"
    echo "  3. Delete the CloudFormation stack"
    echo ""
    echo "Prerequisites:"
    echo "  - AWS CLI configured with appropriate permissions"
    echo "  - Access to eu-west-2 region"
}

# Check if PR number is provided
if [ $# -eq 0 ]; then
    print_error "PR number is required"
    show_usage
    exit 1
fi

# Parse arguments
PR_NUMBER="$1"
FORCE=false

if [ "$2" = "--force" ]; then
    FORCE=true
fi

# Validate PR number is numeric
if ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
    print_error "PR number must be numeric"
    exit 1
fi

# Set variables
STACK_NAME="HelpmatonStagingPR${PR_NUMBER}"
BUCKET_PREFIX="helpmatonstagingpr${PR_NUMBER}-staticbucket-"
AWS_REGION="eu-west-2"

print_status "Starting undeploy process for PR #${PR_NUMBER}"
print_status "Stack name: ${STACK_NAME}"
print_status "S3 bucket prefix: ${BUCKET_PREFIX}"
print_status "AWS region: ${AWS_REGION}"

# Check if AWS CLI is available
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed or not in PATH"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    print_error "AWS credentials not configured or invalid"
    exit 1
fi

print_success "AWS CLI is configured and working"

# Confirmation prompt (unless --force is used)
if [ "$FORCE" = false ]; then
    echo ""
    print_warning "This will permanently delete the following resources:"
    print_warning "  - CloudFormation stack: ${STACK_NAME}"
    print_warning "  - S3 buckets with prefix: ${BUCKET_PREFIX}"
    echo ""
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_status "Operation cancelled"
        exit 0
    fi
fi

# Step 1: Check if CloudFormation stack exists
print_status "Checking if CloudFormation stack exists..."
if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" >/dev/null 2>&1; then
    print_success "Stack $STACK_NAME exists, will proceed with deletion"
    STACK_EXISTS=true
else
    print_warning "Stack $STACK_NAME does not exist, nothing to delete"
    STACK_EXISTS=false
fi

# Step 2: Find and delete S3 bucket contents
if [ "$STACK_EXISTS" = true ]; then
    print_status "Looking for S3 buckets with prefix: $BUCKET_PREFIX"
    
    # List buckets with the specific prefix
    BUCKETS=$(aws s3api list-buckets --query "Buckets[?starts_with(Name, '$BUCKET_PREFIX')].Name" --output text)
    
    if [ -n "$BUCKETS" ]; then
        print_success "Found S3 buckets: $BUCKETS"
        
        for BUCKET in ${BUCKETS}; do
            [ -z "$BUCKET" ] && continue
            print_status "Processing bucket: $BUCKET"
            
            # Check if bucket has objects
            LS_OUTPUT=$(aws s3 ls s3://$BUCKET --recursive --summarize 2>/dev/null)
            if [ $? -eq 0 ]; then
                OBJECT_COUNT=$(echo "$LS_OUTPUT" | grep "Total Objects:" | awk '{print $3}')
                if [ -z "$OBJECT_COUNT" ]; then
                    OBJECT_COUNT=0
                fi
            else
                print_warning "Could not list objects in bucket $BUCKET (bucket may not exist or access denied). Skipping."
                OBJECT_COUNT=0
            fi
            
            if [ -n "$OBJECT_COUNT" ] && [ "$OBJECT_COUNT" -gt 0 ]; then
                print_status "Bucket $BUCKET contains $OBJECT_COUNT objects. Deleting all objects..."
                
                # Delete all objects in the bucket
                if aws s3 rm s3://$BUCKET --recursive; then
                    print_success "Successfully deleted all objects from bucket $BUCKET"
                else
                    print_error "Failed to delete objects from bucket $BUCKET"
                    exit 1
                fi
            else
                print_status "Bucket $BUCKET is empty or has no objects"
            fi
        done
    else
        print_warning "No S3 buckets found with prefix: $BUCKET_PREFIX"
    fi
fi

# Step 3: Delete CloudFormation stack
if [ "$STACK_EXISTS" = true ]; then
    print_status "Deleting CloudFormation stack: $STACK_NAME"
    
    # Delete the stack
    if aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$AWS_REGION"; then
        print_success "Stack deletion initiated for $STACK_NAME"
        
        # Wait for stack deletion to complete
        print_status "Waiting for stack deletion to complete..."
        if aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$AWS_REGION"; then
            print_success "Stack $STACK_NAME has been successfully deleted"
        else
            print_error "Stack deletion failed or timed out"
            exit 1
        fi
    else
        print_error "Failed to initiate stack deletion"
        exit 1
    fi
else
    print_status "No CloudFormation stack found for PR #$PR_NUMBER"
fi

print_success "Cleanup completed successfully for PR #$PR_NUMBER"

