#!/bin/bash

# Script to build and push Lambda container images to ECR
# This script reads the @container-images pragma from app.arc and builds/pushes
# the required Docker images before deployment

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

# Configuration
REGION="${AWS_REGION:-eu-west-2}"
REPOSITORY_NAME="${LAMBDA_IMAGES_ECR_REPOSITORY:-helpmaton-lambda-images}"
IMAGE_TAG="${LAMBDA_IMAGE_TAG:-latest}"
APP_ARC_PATH="${APP_ARC_PATH:-apps/backend/app.arc}"
DOCKER_BASE_PATH="${DOCKER_BASE_PATH:-apps/backend/docker}"

# Get AWS account ID
print_status "Getting AWS account ID..."
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --region "${REGION}")
if [ -z "$AWS_ACCOUNT_ID" ]; then
    print_error "Failed to get AWS account ID. Check AWS credentials."
    exit 1
fi
print_success "AWS Account ID: ${AWS_ACCOUNT_ID}"

# Construct ECR repository URI
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPOSITORY_NAME}"
print_status "ECR Repository URI: ${ECR_URI}"

# Check if ECR repository exists, create if it doesn't
print_status "Checking if ECR repository exists..."
if ! aws ecr describe-repositories --repository-names "${REPOSITORY_NAME}" --region "${REGION}" > /dev/null 2>&1; then
    print_warning "ECR repository ${REPOSITORY_NAME} does not exist. Creating..."
    aws ecr create-repository \
        --repository-name "${REPOSITORY_NAME}" \
        --region "${REGION}" \
        --image-scanning-configuration scanOnPush=true \
        > /dev/null
    print_success "Created ECR repository: ${REPOSITORY_NAME}"
else
    print_success "ECR repository exists: ${REPOSITORY_NAME}"
fi

# Authenticate Docker to ECR
print_status "Authenticating Docker to ECR..."
aws ecr get-login-password --region "${REGION}" | docker login --username AWS --password-stdin "${ECR_URI}"
print_success "Docker authenticated to ECR"

# Parse app.arc to find container images configuration
print_status "Parsing ${APP_ARC_PATH} for @container-images pragma..."

if [ ! -f "${APP_ARC_PATH}" ]; then
    print_error "app.arc file not found at ${APP_ARC_PATH}"
    exit 1
fi

# Extract image names from @container-images pragma
# Format: method route image-name
# Example: any /api/streams/:workspaceId/:agentId/:secret my-custom-image
IMAGE_NAMES=()

# Read app.arc and find @container-images section
IN_CONTAINER_IMAGES=false
while IFS= read -r line || [ -n "$line" ]; do
    # Check if we're entering @container-images section
    if [[ "$line" =~ ^@container-images ]]; then
        IN_CONTAINER_IMAGES=true
        continue
    fi
    
    # Check if we're leaving the section (next @pragma)
    if [[ "$IN_CONTAINER_IMAGES" == true ]] && [[ "$line" =~ ^@ ]]; then
        IN_CONTAINER_IMAGES=false
        continue
    fi
    
    # If we're in the section, parse the line
    if [[ "$IN_CONTAINER_IMAGES" == true ]]; then
        # Skip empty lines and comments
        if [[ -z "$line" ]] || [[ "$line" =~ ^[[:space:]]*# ]]; then
            continue
        fi
        
        # Extract image name (last word on the line)
        # Format: method route image-name
        IMAGE_NAME=$(echo "$line" | awk '{print $NF}')
        if [ -n "$IMAGE_NAME" ] && [[ ! "$IMAGE_NAME" =~ ^@ ]]; then
            # Check if image name is already in the list
            if [[ ! " ${IMAGE_NAMES[@]} " =~ " ${IMAGE_NAME} " ]]; then
                IMAGE_NAMES+=("$IMAGE_NAME")
            fi
        fi
    fi
done < "${APP_ARC_PATH}"

if [ ${#IMAGE_NAMES[@]} -eq 0 ]; then
    print_warning "No container images found in @container-images pragma. Skipping build."
    exit 0
fi

print_success "Found ${#IMAGE_NAMES[@]} unique image(s) to build: ${IMAGE_NAMES[*]}"

# Check if dist directory exists (required for building)
if [ ! -d "apps/backend/dist" ]; then
    print_error "dist directory not found. Please run 'pnpm build' or 'arc build' first."
    exit 1
fi

# Build and push each image
for IMAGE_NAME in "${IMAGE_NAMES[@]}"; do
    print_status "Processing image: ${IMAGE_NAME}"
    
    # Determine Dockerfile path
    # First check for custom Dockerfile: docker/{image-name}/Dockerfile
    DOCKERFILE_PATH="${DOCKER_BASE_PATH}/${IMAGE_NAME}/Dockerfile"
    
    if [ ! -f "$DOCKERFILE_PATH" ]; then
        # Fall back to base Dockerfile
        DOCKERFILE_PATH="${DOCKER_BASE_PATH}/base/Dockerfile"
        print_status "Using base Dockerfile for ${IMAGE_NAME}"
    else
        print_status "Using custom Dockerfile for ${IMAGE_NAME}: ${DOCKERFILE_PATH}"
    fi
    
    if [ ! -f "$DOCKERFILE_PATH" ]; then
        print_error "Dockerfile not found at ${DOCKERFILE_PATH}"
        exit 1
    fi
    
    # Build context is the backend directory
    BUILD_CONTEXT="apps/backend"
    
    # Build Docker image
    print_status "Building Docker image: ${IMAGE_NAME}..."
    docker build \
        -f "${DOCKERFILE_PATH}" \
        -t "${IMAGE_NAME}:${IMAGE_TAG}" \
        -t "${ECR_URI}:${IMAGE_NAME}-${IMAGE_TAG}" \
        -t "${ECR_URI}:${IMAGE_NAME}-latest" \
        "${BUILD_CONTEXT}"
    
    print_success "Built image: ${IMAGE_NAME}:${IMAGE_TAG}"
    
    # Push image to ECR with both tags
    print_status "Pushing ${IMAGE_NAME} to ECR..."
    docker push "${ECR_URI}:${IMAGE_NAME}-${IMAGE_TAG}"
    docker push "${ECR_URI}:${IMAGE_NAME}-latest"
    
    print_success "Pushed ${IMAGE_NAME} to ECR: ${ECR_URI}:${IMAGE_NAME}-${IMAGE_TAG}"
done

print_success "All images built and pushed successfully!"
print_status "ECR Repository: ${ECR_URI}"
print_status "Image Tag: ${IMAGE_TAG}"


