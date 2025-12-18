# LanceDB Docker image for Lambda functions
# Single-stage build - no build tools needed, LanceDB ships pre-compiled binaries!
FROM public.ecr.aws/lambda/nodejs:20

# Copy minimal package.json with ONLY LanceDB dependencies
WORKDIR /tmp/build
COPY apps/backend/docker/lancedb/package.json ./
COPY apps/backend/docker/lancedb/.npmrc ./

# Install - just downloads pre-compiled binaries, no compilation needed!
# This installs ONLY: @lancedb/lancedb, apache-arrow, reflect-metadata
# and @lancedb/lancedb-linux-arm64-gnu (pre-built .node binary)
RUN npm install --omit=dev && \
    rm -rf /root/.npm

# Move to Lambda task root
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy the minimal node_modules
RUN cp -r /tmp/build/node_modules ./node_modules && \
    rm -rf /tmp/build

# Copy built Lambda code from dist directory
# The dist directory contains the compiled TypeScript code with all JS dependencies bundled
# Handler files are at paths like: dist/http/any-api-streams-000workspaceId-000agentId-000secret/index.js
COPY apps/backend/dist/ ${LAMBDA_TASK_ROOT}/

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
