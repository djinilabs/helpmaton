# LanceDB Docker image for Lambda functions
# Extends AWS Lambda Node.js 20.x base image with system dependencies
# required for LanceDB native module compilation
FROM public.ecr.aws/lambda/nodejs:20

# Set working directory
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

# Copy package files for dependency installation
# Note: In a monorepo, pnpm-lock.yaml may be at the root, not in apps/backend
# The wildcard makes it optional - if missing, pnpm will generate a new lock file
COPY package.json ./
COPY pnpm-lock.yaml* ./

# Install production dependencies
# This step compiles native modules (like LanceDB) using the build tools above
# Use --no-frozen-lockfile if lock file is not available (monorepo scenario)
RUN if [ -f pnpm-lock.yaml ]; then \
    pnpm install --prod --frozen-lockfile; \
    else \
    pnpm install --prod; \
    fi

# Copy built Lambda code from dist directory
# The dist directory contains the compiled TypeScript code
COPY dist/ ${LAMBDA_TASK_ROOT}/

# Lambda handler is set via CMD or can be overridden per function
# Default handler assumes index.handler
CMD [ "index.handler" ]
