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
    print_error "dist directory not found. Please run 'pnpm build:backend' first."
    exit 1
fi

# Build and push each image
for IMAGE_NAME in "${IMAGE_NAMES[@]}"; do
    print_status "Processing image: ${IMAGE_NAME}"
    
    # Prepare minimal dist directory for this image
    print_status "Preparing minimal dist directory for ${IMAGE_NAME}..."
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    PREPARE_SCRIPT="${SCRIPT_DIR}/prepare-docker-dist.sh"
    
    # Fallback to relative path if absolute path doesn't exist
    if [ ! -f "$PREPARE_SCRIPT" ]; then
        PREPARE_SCRIPT="scripts/prepare-docker-dist.sh"
    fi
    
    if [ ! -f "$PREPARE_SCRIPT" ]; then
        print_error "prepare-docker-dist.sh not found. Expected at: ${SCRIPT_DIR}/prepare-docker-dist.sh or scripts/prepare-docker-dist.sh"
        exit 1
    fi
    
    # Run prepare script to create minimal dist
    PREPARED_DIST=$("$PREPARE_SCRIPT" "$IMAGE_NAME")
    if [ $? -ne 0 ] || [ -z "$PREPARED_DIST" ]; then
        print_error "Failed to prepare dist directory for ${IMAGE_NAME}"
        exit 1
    fi
    
    # Verify the prepared dist directory exists
    if [ ! -d "$PREPARED_DIST" ]; then
        print_error "Prepared dist directory does not exist: ${PREPARED_DIST}"
        exit 1
    fi
    
    print_success "Prepared dist directory: ${PREPARED_DIST}"
    
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
    
    # Build context is the monorepo root to access pnpm-lock.yaml and workspace config
    # The Dockerfile will copy files from apps/backend/ as needed
    BUILD_CONTEXT="."
    
    # Determine architecture for this image
    # Check config.arc files for functions using this image to determine architecture
    ARCHITECTURE="linux/arm64"  # Default to arm64
    print_status "Checking architecture requirements for ${IMAGE_NAME}..."
    
    # Find all functions using this image from app.arc
    # Then check their config.arc files for architecture specification
    while IFS= read -r line || [ -n "$line" ]; do
        # Check if this line uses the current image
        if echo "$line" | grep -q "${IMAGE_NAME}$"; then
            # Extract method and route/function identifier from the line
            # Format: method route image-name or scheduled name image-name or queue name image-name
            METHOD=$(echo "$line" | awk '{print $1}')
            ROUTE_OR_NAME=$(echo "$line" | awk '{print $2}')
            
            # Skip if this is a comment or empty line
            if [[ "$METHOD" =~ ^# ]] || [ -z "$METHOD" ]; then
                continue
            fi
            
            # Try to find config.arc file for this function
            CONFIG_ARC_PATH=""
            
            # For HTTP routes: convert to Architect's directory naming convention
            # Examples:
            #   post /api/scrape -> post-api-scrape
            #   any /api/streams/* -> any-api-streams-catchall
            #   post /api/webhook/:workspaceId/:agentId/:key -> post-api-webhook-000workspaceId-000agentId-000key
            if [[ "$METHOD" =~ ^(get|post|put|delete|patch|any)$ ]]; then
                # Convert route to directory name
                # Remove leading /, replace / with -, handle catchall (*), handle path params
                ROUTE_DIR=$(echo "$ROUTE_OR_NAME" | \
                    sed 's|^/||' | \
                    sed 's|/|-|g' | \
                    sed 's|:workspaceId|000workspaceId|g' | \
                    sed 's|:agentId|000agentId|g' | \
                    sed 's|:key|000key|g' | \
                    sed 's|:secret|000secret|g' | \
                    sed 's|:userId|000userId|g' | \
                    sed 's|\*|catchall|g')
                
                # Prepend method
                ROUTE_DIR="${METHOD}-${ROUTE_DIR}"
                
                CONFIG_ARC_PATH="apps/backend/src/http/${ROUTE_DIR}/config.arc"
            elif [[ "$METHOD" == "scheduled" ]]; then
                CONFIG_ARC_PATH="apps/backend/src/scheduled/${ROUTE_OR_NAME}/config.arc"
            elif [[ "$METHOD" == "queue" ]]; then
                CONFIG_ARC_PATH="apps/backend/src/queues/${ROUTE_OR_NAME}/config.arc"
            fi
            
            # If config.arc exists, check for architecture specification
            if [ -n "$CONFIG_ARC_PATH" ] && [ -f "$CONFIG_ARC_PATH" ]; then
                if grep -q "architecture x86_64" "$CONFIG_ARC_PATH"; then
                    ARCHITECTURE="linux/amd64"
                    print_status "Found x86_64 architecture requirement in ${CONFIG_ARC_PATH}"
                    break
                fi
            fi
        fi
    done < "${APP_ARC_PATH}"
    
    # Build Docker image
    # IMPORTANT: Build for the correct architecture to match Lambda function configuration
    # Lambda functions default to arm64 (Graviton2) for better price/performance
    # Some functions (like puppeteer) require x86_64 for compatibility
    # Use docker buildx for cross-platform builds (supports emulation on amd64 hosts)
    print_status "Building Docker image: ${IMAGE_NAME} for ${ARCHITECTURE} architecture..."
    
    # Convert prepared dist path to relative path from build context
    # The prepared dist is an absolute path, but we need it relative to BUILD_CONTEXT
    # Since BUILD_CONTEXT is ".", we need to make PREPARED_DIST relative
    PROJECT_ROOT=$(pwd)
    if [[ "$PREPARED_DIST" = /* ]]; then
        # Absolute path - convert to relative from project root
        # Use Python for cross-platform relative path calculation if available
        if command -v python3 &> /dev/null; then
            PREPARED_DIST_REL=$(python3 -c "import os; print(os.path.relpath('$PREPARED_DIST', '$PROJECT_ROOT'))")
        elif command -v realpath &> /dev/null; then
            PREPARED_DIST_REL=$(realpath --relative-to="$PROJECT_ROOT" "$PREPARED_DIST" 2>/dev/null || echo "$PREPARED_DIST")
        else
            # Fallback: try to strip project root from path
            PREPARED_DIST_REL="${PREPARED_DIST#$PROJECT_ROOT/}"
            if [ "$PREPARED_DIST_REL" = "$PREPARED_DIST" ]; then
                # Path doesn't start with project root; this means the prepared dist is
                # outside the project root and cannot be used with build context "."
                print_error "Prepared dist path '$PREPARED_DIST' is outside the project root '$PROJECT_ROOT'."
                print_error "Please ensure the prepared dist directory is created inside the project root."
                exit 1
            fi
        fi
    else
        PREPARED_DIST_REL="$PREPARED_DIST"
    fi
    
    # Ensure the prepared dist path is usable from the Docker build context (".")
    # It must not be an absolute path or escape the project root with "../"
    if [[ "$PREPARED_DIST_REL" = /* || "$PREPARED_DIST_REL" == ../* || "$PREPARED_DIST_REL" == */../* ]]; then
        print_error "Prepared dist path '$PREPARED_DIST_REL' is not valid within the Docker build context '.'."
        print_error "Please ensure the prepared dist directory is located inside '$PROJECT_ROOT'."
        exit 1
    fi
    
    # Check if buildx is available, fall back to regular docker build if not
    if docker buildx version > /dev/null 2>&1; then
        # Use buildx for cross-platform builds
        # IMPORTANT: Disable provenance and SBOM to ensure Lambda-compatible manifest
        # Lambda doesn't support the additional metadata that buildx adds by default
        # --provenance=false and --sbom=false ensure the image manifest is compatible with Lambda
        print_status "Using docker buildx for cross-platform build..."
        docker buildx build \
            --platform "${ARCHITECTURE}" \
            --provenance=false \
            --sbom=false \
            --build-arg DIST_SOURCE="${PREPARED_DIST_REL}" \
            --push \
            -f "${DOCKERFILE_PATH}" \
            -t "${ECR_URI}:${IMAGE_NAME}-${IMAGE_TAG}" \
            -t "${ECR_URI}:${IMAGE_NAME}-latest" \
            "${BUILD_CONTEXT}"
        print_success "Built and pushed image: ${ECR_URI}:${IMAGE_NAME}-${IMAGE_TAG}"
    else
        # Fallback to regular docker build (may fail on amd64 hosts building for arm64)
        print_warning "docker buildx not available, using regular docker build"
        docker build \
            --platform "${ARCHITECTURE}" \
            --build-arg DIST_SOURCE="${PREPARED_DIST_REL}" \
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
    fi
    
    # Clean up prepared dist directory
    print_status "Cleaning up prepared dist directory..."
    rm -rf "${PREPARED_DIST}"
    print_success "Cleaned up prepared dist directory"
done

print_success "All images built and pushed successfully!"
print_status "ECR Repository: ${ECR_URI}"
print_status "Image Tag: ${IMAGE_TAG}"




