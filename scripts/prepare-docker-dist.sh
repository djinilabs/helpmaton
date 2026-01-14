#!/bin/bash

# Script to prepare a minimal dist directory for a specific Docker image
# This script parses app.arc to find which Lambda handlers are needed for a given image
# and creates a temporary directory with only those handlers

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

# Check arguments
if [ $# -lt 1 ]; then
    print_error "Usage: $0 <image-name> [output-dir]"
    print_error "  image-name: Name of the Docker image (e.g., lancedb, puppeteer, base)"
    print_error "  output-dir: Optional output directory (default: /tmp/docker-dist-<image-name>)"
    exit 1
fi

IMAGE_NAME="$1"
OUTPUT_DIR="${2:-/tmp/docker-dist-${IMAGE_NAME}}"
APP_ARC_PATH="${APP_ARC_PATH:-apps/backend/app.arc}"
DIST_DIR="${DIST_DIR:-apps/backend/dist}"

print_status "Preparing dist directory for image: ${IMAGE_NAME}"
print_status "Output directory: ${OUTPUT_DIR}"

# Check if app.arc exists
if [ ! -f "${APP_ARC_PATH}" ]; then
    print_error "app.arc file not found at ${APP_ARC_PATH}"
    exit 1
fi

# Check if dist directory exists
if [ ! -d "${DIST_DIR}" ]; then
    print_error "dist directory not found at ${DIST_DIR}. Please run 'pnpm build:backend' first."
    exit 1
fi

# Create output directory
rm -rf "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}"

# Arrays to store handler paths
HTTP_HANDLERS=()
QUEUE_HANDLERS=()
SCHEDULED_HANDLERS=()

# Parse app.arc to find functions using this image
print_status "Parsing ${APP_ARC_PATH} for functions using image: ${IMAGE_NAME}..."

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
        LINE_IMAGE_NAME=$(echo "$line" | awk '{print $NF}')
        
        # Check if this line uses the current image
        if [ "$LINE_IMAGE_NAME" = "$IMAGE_NAME" ]; then
            # Extract method and route/function identifier
            METHOD=$(echo "$line" | awk '{print $1}')
            ROUTE_OR_NAME=$(echo "$line" | awk '{print $2}')
            
            # Skip if this is a comment or empty line
            if [[ "$METHOD" =~ ^# ]] || [ -z "$METHOD" ]; then
                continue
            fi
            
            # Convert to dist path based on type
            if [[ "$METHOD" =~ ^(get|post|put|delete|patch|any)$ ]]; then
                # HTTP route: convert to directory name
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
                
                HANDLER_PATH="http/${ROUTE_DIR}"
                HTTP_HANDLERS+=("${HANDLER_PATH}")
                
            elif [[ "$METHOD" == "scheduled" ]]; then
                # Scheduled function
                HANDLER_PATH="scheduled/${ROUTE_OR_NAME}"
                SCHEDULED_HANDLERS+=("${HANDLER_PATH}")
                
            elif [[ "$METHOD" == "queue" ]]; then
                # Queue function
                HANDLER_PATH="queues/${ROUTE_OR_NAME}"
                QUEUE_HANDLERS+=("${HANDLER_PATH}")
            fi
        fi
    fi
done < "${APP_ARC_PATH}"

# Count total handlers
TOTAL_HANDLERS=$((${#HTTP_HANDLERS[@]} + ${#QUEUE_HANDLERS[@]} + ${#SCHEDULED_HANDLERS[@]}))

if [ $TOTAL_HANDLERS -eq 0 ]; then
    print_warning "No functions found for image: ${IMAGE_NAME}"
    print_warning "This might be the 'base' image which includes all non-containerized functions"
    print_warning "For base image, we'll copy all handlers not assigned to other images"
    
    # For base image, we need to find all handlers NOT in other images
    if [ "$IMAGE_NAME" = "base" ]; then
        print_status "Base image: copying all handlers not assigned to lancedb or puppeteer..."
        
        # Get all handlers assigned to other images
        OTHER_IMAGES=("lancedb" "puppeteer")
        EXCLUDED_HANDLERS=()
        
        for OTHER_IMAGE in "${OTHER_IMAGES[@]}"; do
            # Re-parse to find handlers for other images
            IN_CONTAINER_IMAGES=false
            while IFS= read -r line || [ -n "$line" ]; do
                if [[ "$line" =~ ^@container-images ]]; then
                    IN_CONTAINER_IMAGES=true
                    continue
                fi
                if [[ "$IN_CONTAINER_IMAGES" == true ]] && [[ "$line" =~ ^@ ]]; then
                    IN_CONTAINER_IMAGES=false
                    continue
                fi
                if [[ "$IN_CONTAINER_IMAGES" == true ]]; then
                    if [[ -z "$line" ]] || [[ "$line" =~ ^[[:space:]]*# ]]; then
                        continue
                    fi
                    LINE_IMAGE_NAME=$(echo "$line" | awk '{print $NF}')
                    if [ "$LINE_IMAGE_NAME" = "$OTHER_IMAGE" ]; then
                        METHOD=$(echo "$line" | awk '{print $1}')
                        ROUTE_OR_NAME=$(echo "$line" | awk '{print $2}')
                        if [[ "$METHOD" =~ ^(get|post|put|delete|patch|any)$ ]]; then
                            ROUTE_DIR=$(echo "$ROUTE_OR_NAME" | \
                                sed 's|^/||' | \
                                sed 's|/|-|g' | \
                                sed 's|:workspaceId|000workspaceId|g' | \
                                sed 's|:agentId|000agentId|g' | \
                                sed 's|:key|000key|g' | \
                                sed 's|:secret|000secret|g' | \
                                sed 's|:userId|000userId|g' | \
                                sed 's|\*|catchall|g')
                            ROUTE_DIR="${METHOD}-${ROUTE_DIR}"
                            EXCLUDED_HANDLERS+=("http/${ROUTE_DIR}")
                        elif [[ "$METHOD" == "scheduled" ]]; then
                            EXCLUDED_HANDLERS+=("scheduled/${ROUTE_OR_NAME}")
                        elif [[ "$METHOD" == "queue" ]]; then
                            EXCLUDED_HANDLERS+=("queues/${ROUTE_OR_NAME}")
                        fi
                    fi
                fi
            done < "${APP_ARC_PATH}"
        done
        
        # Copy all handlers except excluded ones
        print_status "Copying handlers from ${DIST_DIR}..."
        
        # Copy HTTP handlers
        if [ -d "${DIST_DIR}/http" ]; then
            for handler_dir in "${DIST_DIR}/http"/*; do
                if [ -d "$handler_dir" ]; then
                    handler_name=$(basename "$handler_dir")
                    handler_path="http/${handler_name}"
                    
                    # Check if this handler is excluded
                    excluded=false
                    for excluded_handler in "${EXCLUDED_HANDLERS[@]}"; do
                        if [ "$handler_path" = "$excluded_handler" ]; then
                            excluded=true
                            break
                        fi
                    done
                    
                    if [ "$excluded" = false ]; then
                        mkdir -p "${OUTPUT_DIR}/http"
                        cp -r "$handler_dir" "${OUTPUT_DIR}/http/"
                    fi
                fi
            done
        fi
        
        # Copy queue handlers
        if [ -d "${DIST_DIR}/queues" ]; then
            for handler_dir in "${DIST_DIR}/queues"/*; do
                if [ -d "$handler_dir" ]; then
                    handler_name=$(basename "$handler_dir")
                    handler_path="queues/${handler_name}"
                    
                    excluded=false
                    for excluded_handler in "${EXCLUDED_HANDLERS[@]}"; do
                        if [ "$handler_path" = "$excluded_handler" ]; then
                            excluded=true
                            break
                        fi
                    done
                    
                    if [ "$excluded" = false ]; then
                        mkdir -p "${OUTPUT_DIR}/queues"
                        cp -r "$handler_dir" "${OUTPUT_DIR}/queues/"
                    fi
                fi
            done
        fi
        
        # Copy scheduled handlers
        if [ -d "${DIST_DIR}/scheduled" ]; then
            for handler_dir in "${DIST_DIR}/scheduled"/*; do
                if [ -d "$handler_dir" ]; then
                    handler_name=$(basename "$handler_dir")
                    handler_path="scheduled/${handler_name}"
                    
                    excluded=false
                    for excluded_handler in "${EXCLUDED_HANDLERS[@]}"; do
                        if [ "$handler_path" = "$excluded_handler" ]; then
                            excluded=true
                            break
                        fi
                    done
                    
                    if [ "$excluded" = false ]; then
                        mkdir -p "${OUTPUT_DIR}/scheduled"
                        cp -r "$handler_dir" "${OUTPUT_DIR}/scheduled/"
                    fi
                fi
            done
        fi
    else
        print_error "No functions found for image: ${IMAGE_NAME} and it's not the base image"
        exit 1
    fi
else
    print_success "Found ${TOTAL_HANDLERS} function(s) for image ${IMAGE_NAME}:"
    print_status "  HTTP routes: ${#HTTP_HANDLERS[@]}"
    print_status "  Queue functions: ${#QUEUE_HANDLERS[@]}"
    print_status "  Scheduled functions: ${#SCHEDULED_HANDLERS[@]}"
    
    # Copy HTTP handlers
    for handler_path in "${HTTP_HANDLERS[@]}"; do
        source_path="${DIST_DIR}/${handler_path}"
        if [ -d "$source_path" ]; then
            target_dir="${OUTPUT_DIR}/$(dirname "$handler_path")"
            mkdir -p "$target_dir"
            cp -r "$source_path" "$target_dir/"
            print_status "  Copied: ${handler_path}"
        else
            print_warning "  Handler not found: ${source_path}"
        fi
    done
    
    # Copy queue handlers
    for handler_path in "${QUEUE_HANDLERS[@]}"; do
        source_path="${DIST_DIR}/${handler_path}"
        if [ -d "$source_path" ]; then
            target_dir="${OUTPUT_DIR}/$(dirname "$handler_path")"
            mkdir -p "$target_dir"
            cp -r "$source_path" "$target_dir/"
            print_status "  Copied: ${handler_path}"
        else
            print_warning "  Handler not found: ${source_path}"
        fi
    done
    
    # Copy scheduled handlers
    for handler_path in "${SCHEDULED_HANDLERS[@]}"; do
        source_path="${DIST_DIR}/${handler_path}"
        if [ -d "$source_path" ]; then
            target_dir="${OUTPUT_DIR}/$(dirname "$handler_path")"
            mkdir -p "$target_dir"
            cp -r "$source_path" "$target_dir/"
            print_status "  Copied: ${handler_path}"
        else
            print_warning "  Handler not found: ${source_path}"
        fi
    done
fi

# Copy shared utilities (dist/utils/) - needed by all handlers
# TODO: Could be optimized to only copy utilities actually used by the handlers
if [ -d "${DIST_DIR}/utils" ]; then
    print_status "Copying shared utilities..."
    cp -r "${DIST_DIR}/utils" "${OUTPUT_DIR}/"
fi

# Copy tables directory if it exists (database utilities)
if [ -d "${DIST_DIR}/tables" ]; then
    print_status "Copying tables utilities..."
    cp -r "${DIST_DIR}/tables" "${OUTPUT_DIR}/"
fi

# Copy plugins directory if it exists (may be needed by handlers)
if [ -d "${DIST_DIR}/plugins" ]; then
    print_status "Copying plugins..."
    cp -r "${DIST_DIR}/plugins" "${OUTPUT_DIR}/"
fi

print_success "Prepared dist directory at: ${OUTPUT_DIR}"
print_status "Output directory size: $(du -sh "${OUTPUT_DIR}" | cut -f1)"

# Output the path for use by Docker build
echo "${OUTPUT_DIR}"
