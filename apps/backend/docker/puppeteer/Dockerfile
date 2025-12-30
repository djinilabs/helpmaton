# Puppeteer Docker image for Lambda functions
# Single-stage build optimized for arm64 architecture
FROM public.ecr.aws/lambda/nodejs:20

# Install system dependencies required for Puppeteer/Chrome
# Amazon Linux 2023 uses dnf (not yum)
# Note: fonts-liberation is not available in AL2023, removed from package list
# Added file utility to verify binary architecture
RUN dnf install -y \
    nss \
    freetype \
    freetype-devel \
    harfbuzz \
    ca-certificates \
    libX11 \
    libXcomposite \
    libXcursor \
    libXdamage \
    libXext \
    libXi \
    libXrandr \
    libXrender \
    libXtst \
    libXScrnSaver \
    alsa-lib \
    atk \
    cups-libs \
    gtk3 \
    file \
    && dnf clean all

# Install pnpm globally
RUN npm install -g pnpm

# Copy minimal package.json with ONLY Puppeteer dependencies
# The pnpm config in package.json restricts installation to linux-arm64 only
WORKDIR /tmp/build
COPY apps/backend/docker/puppeteer/package.json ./

# Install Puppeteer dependencies including @sparticuz/chromium
# @sparticuz/chromium provides Chromium optimized for AWS Lambda (arm64)
# It's installed via pnpm and provides the executable path via its API
# No manual installation needed - the package handles everything
RUN pnpm install --prod && \
    rm -rf /root/.pnpm-store /root/.local/share/pnpm

# Move to Lambda task root
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy the minimal node_modules
RUN cp -r /tmp/build/node_modules ./node_modules && \
    rm -rf /tmp/build

# Copy built Lambda code from dist directory
# The dist directory contains the compiled TypeScript code with all JS dependencies bundled
# Handler files are at paths like: dist/http/post-api-scrape/index.js
COPY apps/backend/dist/ ${LAMBDA_TASK_ROOT}/

# Copy entrypoint wrapper (reuse lancedb pattern)
# This wrapper reads LAMBDA_HANDLER_PATH environment variable to route to the correct handler
# Copy AFTER dist to ensure it overwrites any index.js that might exist in dist root
COPY apps/backend/docker/lancedb/index.js ${LAMBDA_TASK_ROOT}/index.js

# Ensure proper permissions
RUN chmod -R 755 ${LAMBDA_TASK_ROOT}

# @sparticuz/chromium provides the executable path automatically
# No need to set PUPPETEER_EXECUTABLE_PATH - the code will use chromium.executablePath()
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Lambda handler is set via CMD pointing to index.handler
# The index.js wrapper will read LAMBDA_HANDLER_PATH to route to the actual handler
# Note: ImageConfig.Command in the plugin overrides this for specific functions
CMD [ "index.handler" ]

