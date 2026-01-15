# Base Docker image for Lambda functions
# Uses AWS Lambda base image for Node.js 20.x
# This is a minimal image that only includes the compiled code
# No dependencies are installed here - use lancedb Dockerfile for functions that need dependencies

FROM public.ecr.aws/lambda/nodejs:20

# Build argument for dist source directory
# Defaults to apps/backend/dist for backward compatibility
ARG DIST_SOURCE=apps/backend/dist

# LAMBDA_TASK_ROOT is pre-defined by the AWS Lambda base image (defaults to /var/task)
# It points to the directory where the Lambda runtime expects function code
# Set working directory to Lambda task root
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy built Lambda code from dist directory (or prepared dist subset)
# The dist directory contains the compiled TypeScript code
# Handler files are at paths like: dist/http/any-api-streams-000workspaceId-000agentId-000secret/index.js
# After copying, they will be at: /var/task/http/any-api-streams-000workspaceId-000agentId-000secret/index.js
COPY ${DIST_SOURCE}/ ${LAMBDA_TASK_ROOT}/

# Lambda handler is set via CMD or can be overridden per function
# Default handler assumes index.handler at /var/task/index.js
# Note: If using container images with ImageConfig.Command, the CMD here is overridden
# For functions using this base image directly, ensure there's an index.js at the root
# or use ImageConfig.Command to point to the correct handler path
CMD [ "index.handler" ]


