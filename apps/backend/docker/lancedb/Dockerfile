# LanceDB Docker image for Lambda functions
# Multi-stage build to minimize final image size
# Stage 1: Build dependencies with native modules
FROM public.ecr.aws/lambda/nodejs:20 AS builder

# Install build dependencies required for LanceDB native module compilation
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
RUN pnpm install --prod --frozen-lockfile --filter backend --shamefully-hoist && \
    pnpm store prune && \
    rm -rf /root/.pnpm-store /tmp/workspace/.pnpm

# Stage 2: Runtime (minimal - no build tools)
FROM public.ecr.aws/lambda/nodejs:20

# LAMBDA_TASK_ROOT is pre-defined by the AWS Lambda base image (defaults to /var/task)
# It points to the directory where the Lambda runtime expects function code
# Set working directory to Lambda task root
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy only runtime dependencies from builder (no build tools, no pnpm)
# With --shamefully-hoist, node_modules is at the workspace root
COPY --from=builder /tmp/workspace/node_modules ./node_modules
COPY --from=builder /tmp/workspace/apps/backend/package.json ./

# Copy built Lambda code from dist directory
# The dist directory contains the compiled TypeScript code
# Handler files are at paths like: dist/http/any-api-streams-000workspaceId-000agentId-000secret/index.js
COPY apps/backend/dist/ ${LAMBDA_TASK_ROOT}/

# Copy simple index.js entrypoint that loads handlers dynamically
# This wrapper reads LAMBDA_HANDLER_PATH environment variable to route to the correct handler
# Copy AFTER dist to ensure it overwrites any index.js that might exist in dist root
# This ensures /var/task/index.js exists and is our wrapper
COPY apps/backend/docker/lancedb/index.js ${LAMBDA_TASK_ROOT}/index.js

# Ensure files are readable/executable for Lambda runtime user (non-root)
# This prevents permission issues that could cause ProcessSpawnFailed errors
RUN chmod -R 755 ${LAMBDA_TASK_ROOT}

# Lambda handler is set via CMD pointing to index.handler
# The index.js wrapper will read LAMBDA_HANDLER_PATH to route to the actual handler
# Note: ImageConfig.Command in the plugin overrides this for specific functions
CMD [ "index.handler" ]
