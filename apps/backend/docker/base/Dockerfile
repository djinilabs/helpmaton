# Base Docker image for Lambda functions
# Uses AWS Lambda base image for Node.js 20.x
FROM public.ecr.aws/lambda/nodejs:20

# LAMBDA_TASK_ROOT is pre-defined by the AWS Lambda base image (defaults to /var/task)
# It points to the directory where the Lambda runtime expects function code
# Set working directory to Lambda task root
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy built Lambda code from dist directory
# The dist directory contains the compiled TypeScript code
# Handler files are at paths like: dist/http/any-api-streams-000workspaceId-000agentId-000secret/index.js
# After copying, they will be at: /var/task/http/any-api-streams-000workspaceId-000agentId-000secret/index.js
COPY dist/ ${LAMBDA_TASK_ROOT}/

# Lambda handler is set via CMD or can be overridden per function
# Default handler assumes index.handler at /var/task/index.js
# Note: If using container images with ImageConfig.Command, the CMD here is overridden
# For functions using this base image directly, ensure there's an index.js at the root
# or use ImageConfig.Command to point to the correct handler path
CMD [ "index.handler" ]



