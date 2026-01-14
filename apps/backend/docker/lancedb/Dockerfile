# LanceDB Docker image for Lambda functions
# Single-stage build - no build tools needed, LanceDB ships pre-compiled binaries!
FROM public.ecr.aws/lambda/nodejs:20

# Build argument for dist source directory
# Defaults to apps/backend/dist for backward compatibility
ARG DIST_SOURCE=apps/backend/dist

# Install pnpm globally
RUN npm install -g pnpm

# Copy minimal package.json with ONLY LanceDB dependencies
# The pnpm config in package.json restricts installation to linux-arm64 only
WORKDIR /tmp/build
COPY apps/backend/docker/lancedb/package.json ./

# Install - just downloads pre-compiled binaries, no compilation needed!
# This installs ONLY: @lancedb/lancedb, apache-arrow, reflect-metadata
# and @lancedb/lancedb-linux-arm64-gnu (pre-built .node binary)
# pnpm config in package.json ensures only linux-arm64 platform is installed
RUN pnpm install --prod && \
    rm -rf /root/.pnpm-store /root/.local/share/pnpm && \
    npm uninstall -g pnpm

# Clean up unnecessary files from node_modules to reduce image size
RUN find /tmp/build/node_modules -type f \( \
        -name "README*" -o \
        -name "CHANGELOG*" -o \
        -name "LICENSE*" -o \
        -name "*.test.*" -o \
        -name "*.spec.*" -o \
        -name "*.ts" -o \
        -name "*.map" \
    \) -delete && \
    find /tmp/build/node_modules -type d \( \
        -name "test" -o \
        -name "tests" -o \
        -name "__tests__" -o \
        -name "examples" -o \
        -name "example" -o \
        -name "docs" -o \
        -name "doc" -o \
        -name ".github" -o \
        -name ".git" \
    \) -prune -print0 | xargs -0 -r rm -rf --

# Move to Lambda task root
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy the minimal node_modules
RUN cp -r /tmp/build/node_modules ./node_modules && \
    rm -rf /tmp/build

# Copy built Lambda code from dist directory (or prepared dist subset)
# The dist directory contains the compiled TypeScript code with all JS dependencies bundled
# Handler files are at paths like: dist/http/any-api-streams-000workspaceId-000agentId-000secret/index.js
COPY ${DIST_SOURCE}/ ${LAMBDA_TASK_ROOT}/

# Copy entrypoint wrapper
# This wrapper reads LAMBDA_HANDLER_PATH environment variable to route to the correct handler
# Copy AFTER dist to ensure it overwrites any index.js that might exist in dist root
COPY apps/backend/docker/lancedb/index.js ${LAMBDA_TASK_ROOT}/index.js

# Ensure proper permissions
RUN chmod -R 755 ${LAMBDA_TASK_ROOT}

# Lambda handler is set via CMD pointing to index.handler
# The index.js wrapper will read LAMBDA_HANDLER_PATH to route to the actual handler
# Note: ImageConfig.Command in the plugin overrides this for specific functions
CMD [ "index.handler" ]
