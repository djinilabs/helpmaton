# Base Docker image for Lambda functions
# Uses AWS Lambda base image for Node.js 20.x
FROM public.ecr.aws/lambda/nodejs:20

# LAMBDA_TASK_ROOT is pre-defined by the AWS Lambda base image (defaults to /var/task)
# It points to the directory where the Lambda runtime expects function code
# Set working directory to Lambda task root
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy built Lambda code from dist directory
# The dist directory contains the compiled TypeScript code
COPY dist/ ${LAMBDA_TASK_ROOT}/

# Lambda handler is set via CMD or can be overridden per function
# Default handler assumes index.handler
CMD [ "index.handler" ]


