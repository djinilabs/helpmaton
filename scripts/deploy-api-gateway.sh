#!/bin/bash

# Script to trigger API Gateway deployment after CloudFormation stack update
# This ensures API Gateway changes are immediately live after arc deploy

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

# Check if stack name is provided
if [ -z "$1" ]; then
    print_error "Usage: $0 <stack-name>"
    print_error "Example: $0 HelpmatonProduction"
    print_error "Example: $0 HelpmatonStagingPR123"
    exit 1
fi

STACK_NAME="$1"
REGION="${AWS_REGION:-eu-west-2}"

print_status "Triggering API Gateway deployment for stack: ${STACK_NAME}"
print_status "Region: ${REGION}"

# Get API Gateway REST API ID from CloudFormation stack outputs
print_status "Retrieving API Gateway REST API ID from CloudFormation stack outputs..."
API_ID=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}" \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiId`].OutputValue' \
    --output text 2>/dev/null || echo "")

if [ -z "${API_ID}" ] || [ "${API_ID}" == "None" ]; then
    print_warning "ApiId output not found in stack. Trying alternative method..."
    # Try to get it from the stack resources
    API_ID=$(aws cloudformation describe-stack-resources \
        --stack-name "${STACK_NAME}" \
        --region "${REGION}" \
        --query 'StackResources[?ResourceType==`AWS::ApiGateway::RestApi`].PhysicalResourceId' \
        --output text 2>/dev/null | head -1 || echo "")
fi

if [ -z "${API_ID}" ] || [ "${API_ID}" == "None" ]; then
    print_error "Could not retrieve API Gateway REST API ID from stack ${STACK_NAME}"
    print_error "The stack may not have an API Gateway REST API, or it may not be ready yet."
    exit 1
fi

print_success "Found API Gateway REST API ID: ${API_ID}"

# Get stage name from CloudFormation stack outputs
print_status "Retrieving API Gateway stage name from CloudFormation stack outputs..."
STAGE_NAME=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}" \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayStageName`].OutputValue' \
    --output text 2>/dev/null || echo "")

# Fallback: determine stage name from stack name
if [ -z "${STAGE_NAME}" ] || [ "${STAGE_NAME}" == "None" ]; then
    print_warning "ApiGatewayStageName output not found. Determining stage name from stack name..."
    if [[ "${STACK_NAME}" == *"Production"* ]]; then
        STAGE_NAME="production"
    elif [[ "${STACK_NAME}" == *"Staging"* ]] || [[ "${STACK_NAME}" == *"PR"* ]]; then
        STAGE_NAME="staging"
    else
        # Default fallback
        STAGE_NAME="staging"
        print_warning "Could not determine stage name, defaulting to: ${STAGE_NAME}"
    fi
fi

print_success "Using stage name: ${STAGE_NAME}"

# Wait a bit for API Gateway to be ready after CloudFormation update
# Sometimes API Gateway needs a moment to process the changes
print_status "Waiting 5 seconds for API Gateway to be ready..."
sleep 5

# Create deployment with timestamp in description
DEPLOYMENT_DESCRIPTION="Auto-deployment triggered after CloudFormation update at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"

print_status "Creating API Gateway deployment..."
print_status "  REST API ID: ${API_ID}"
print_status "  Stage: ${STAGE_NAME}"
print_status "  Description: ${DEPLOYMENT_DESCRIPTION}"

DEPLOYMENT_RESULT=$(aws apigateway create-deployment \
    --rest-api-id "${API_ID}" \
    --stage-name "${STAGE_NAME}" \
    --description "${DEPLOYMENT_DESCRIPTION}" \
    --region "${REGION}" \
    2>&1) || {
    DEPLOYMENT_ERROR=$?
    print_error "Failed to create API Gateway deployment"
    print_error "Error: ${DEPLOYMENT_RESULT}"
    
    # Check if it's a "too many requests" error - in that case, wait and retry
    if echo "${DEPLOYMENT_RESULT}" | grep -q "TooManyRequestsException\|Throttling"; then
        print_warning "Rate limited. Waiting 10 seconds before retry..."
        sleep 10
        print_status "Retrying deployment..."
        DEPLOYMENT_RESULT=$(aws apigateway create-deployment \
            --rest-api-id "${API_ID}" \
            --stage-name "${STAGE_NAME}" \
            --description "${DEPLOYMENT_DESCRIPTION}" \
            --region "${REGION}" \
            2>&1) || {
            print_error "Retry also failed. Deployment may need to be created manually."
            exit 1
        }
    else
        exit 1
    fi
}

# Extract deployment ID from result
DEPLOYMENT_ID=$(echo "${DEPLOYMENT_RESULT}" | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")

if [ -n "${DEPLOYMENT_ID}" ]; then
    print_success "API Gateway deployment created successfully!"
    print_success "Deployment ID: ${DEPLOYMENT_ID}"
    print_status "The API Gateway changes are now live on stage: ${STAGE_NAME}"
else
    print_warning "Deployment created but could not extract deployment ID"
    print_warning "This is usually fine - the deployment should still be active"
fi

print_success "API Gateway deployment completed successfully!"





