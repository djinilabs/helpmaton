# LanceDB Docker image for Lambda functions
# Extends AWS Lambda Node.js 20.x base image with system dependencies
# required for LanceDB native module compilation
FROM public.ecr.aws/lambda/nodejs:20

# LAMBDA_TASK_ROOT is pre-defined by the AWS Lambda base image (defaults to /var/task)
# It points to the directory where the Lambda runtime expects function code
# Set working directory to Lambda task root
WORKDIR ${LAMBDA_TASK_ROOT}

# Install system dependencies required for LanceDB
# - python3: Required for building native Node.js modules
# - make: Build tool for compiling native dependencies
# - gcc-c++: C++ compiler for native module compilation
# - git: May be needed for some npm packages
# Note: AWS Lambda base images use dnf (not yum) on Amazon Linux 2023
RUN dnf update -y && \
    dnf install -y \
    python3 \
    make \
    gcc-c++ \
    git && \
    dnf clean all && \
    rm -rf /var/cache/dnf

# Install pnpm globally (project uses pnpm for dependency management)
RUN npm install -g pnpm

# Set up workspace structure for pnpm to resolve dependencies correctly
# Build context is the monorepo root, so we can access root files
WORKDIR /tmp/workspace
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package.json ./
COPY patches/ ./patches/
COPY apps/backend/package.json ./apps/backend/

# Install production dependencies for backend workspace with shamefully-hoist
# This creates a flat node_modules structure (no symlinks) suitable for Lambda
# This step compiles native modules (like LanceDB) using the build tools above
RUN pnpm install --prod --frozen-lockfile --filter backend --shamefully-hoist

# Copy the flat node_modules to Lambda task root
# With --shamefully-hoist, node_modules is at the workspace root
RUN cp -r node_modules ${LAMBDA_TASK_ROOT}/ && \
    cp apps/backend/package.json ${LAMBDA_TASK_ROOT}/

# Clean up temporary workspace
RUN rm -rf /tmp/workspace

# Set working directory to Lambda task root
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy built Lambda code from dist directory FIRST
# The dist directory contains the compiled TypeScript code
# Handler files are at paths like: dist/http/any-api-streams-000workspaceId-000agentId-000secret/index.js
COPY apps/backend/dist/ ${LAMBDA_TASK_ROOT}/

# Copy simple index.js entrypoint that loads handlers dynamically
# This wrapper reads LAMBDA_HANDLER_PATH environment variable to route to the correct handler
# Copy AFTER dist to ensure it overwrites any index.js that might exist in dist root
# This ensures /var/task/index.js exists and is our wrapper
COPY apps/backend/docker/lancedb/index.js ${LAMBDA_TASK_ROOT}/index.js

# Verify index.js exists and can be loaded
# Note: We only verify the module loads and exports a handler function
# The actual handler loading happens at runtime with LAMBDA_HANDLER_PATH
RUN echo "=== Verifying index.js wrapper ===" && \
    ls -la ${LAMBDA_TASK_ROOT}/index.js && \
    echo "=== Testing if index.js can be loaded ===" && \
    node -e "const idx = require('${LAMBDA_TASK_ROOT}/index.js'); console.log('Handler type:', typeof idx.handler); if (typeof idx.handler !== 'function') { console.error('ERROR: handler is not a function'); process.exit(1); } console.log('✓ index.js loaded, handler wrapper is a function');" && \
    echo "=== Verifying handler path file exists ===" && \
    test -f ${LAMBDA_TASK_ROOT}/http/any-api-streams-000workspaceId-000agentId-000secret/index.js && \
    echo "✓ Handler file exists at expected path" && \
    echo "=== Verifying file structure ===" && \
    echo "Files in /var/task root:" && \
    ls -la ${LAMBDA_TASK_ROOT}/ | head -10 && \
    echo "✓ index.js verification passed"

# Lambda handler is set via CMD pointing to index.handler
# The index.js wrapper will read LAMBDA_HANDLER_PATH to route to the actual handler
CMD [ "index.handler" ]
