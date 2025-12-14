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
RUN yum update -y && \
    yum install -y \
    python3 \
    make \
    gcc-c++ \
    git && \
    yum clean all && \
    rm -rf /var/cache/yum

# Install pnpm globally (project uses pnpm for dependency management)
RUN npm install -g pnpm

# Set up workspace structure for pnpm to resolve dependencies correctly
# Build context is the monorepo root, so we can access root files
WORKDIR /tmp/workspace
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package.json ./
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

# Copy built Lambda code from dist directory
# The dist directory contains the compiled TypeScript code
COPY apps/backend/dist/ ${LAMBDA_TASK_ROOT}/

# Lambda handler is set via CMD or can be overridden per function
# Default handler assumes index.handler
CMD [ "index.handler" ]
