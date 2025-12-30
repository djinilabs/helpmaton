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

# Install Puppeteer dependencies
# This installs ONLY: puppeteer-core, @puppeteer/browsers
# pnpm config in package.json ensures only linux-arm64 platform is installed
RUN pnpm install --prod && \
    rm -rf /root/.pnpm-store /root/.local/share/pnpm

# Install Chrome using @puppeteer/browsers
# Pin Chrome version for reproducible builds (update periodically for security)
# This downloads the Chrome binary for linux-arm64
# Note: @puppeteer/browsers installs to /opt/chrome/chrome/linux_arm-{VERSION}/chrome-linux64/chrome
# We need to explicitly specify the platform to ensure arm64 binary is downloaded
ARG CHROME_VERSION=chrome@131.0.6778.85
# Set environment variable to force arm64 platform
ENV PUPPETEER_PLATFORM=linux_arm64
RUN npx @puppeteer/browsers install ${CHROME_VERSION} --path=/opt/chrome

# Find the actual Chrome executable path and create symlink
RUN CHROME_PATH=$(find /opt/chrome -name "chrome" -type f 2>/dev/null | head -1) && \
    if [ -z "$CHROME_PATH" ]; then \
    echo "ERROR: Chrome executable not found" && \
    find /opt/chrome -type f 2>/dev/null | head -20 && \
    exit 1; \
    fi && \
    echo "Found Chrome at: $CHROME_PATH" && \
    BINARY_INFO=$(file "$CHROME_PATH") && \
    echo "Binary info: $BINARY_INFO" && \
    (echo "$BINARY_INFO" | grep -q "x86-64\|x86_64\|Intel 80386" && echo "ERROR: Chrome binary is for x86_64, but we need arm64/aarch64" && exit 1 || true) && \
    (echo "$BINARY_INFO" | grep -q "aarch64\|ARM\|arm64" || echo "WARNING: Chrome binary architecture unclear: $BINARY_INFO") && \
    chmod +x "$CHROME_PATH" && \
    mkdir -p /opt/chrome/chrome-linux-arm64 && \
    ln -sf "$CHROME_PATH" /opt/chrome/chrome-linux-arm64/chrome && \
    if [ ! -f "/opt/chrome/chrome-linux-arm64/chrome" ]; then \
    echo "ERROR: Failed to create Chrome symlink" && \
    ls -la /opt/chrome/chrome-linux-arm64/ && \
    exit 1; \
    fi && \
    chmod +x /opt/chrome/chrome-linux-arm64/chrome && \
    file /opt/chrome/chrome-linux-arm64/chrome && \
    echo "Chrome symlink created successfully at: /opt/chrome/chrome-linux-arm64/chrome"

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

# Set Chrome path for Puppeteer
# @puppeteer/browsers installs to /opt/chrome/chrome-linux-arm64/chrome
ENV PUPPETEER_EXECUTABLE_PATH=/opt/chrome/chrome-linux-arm64/chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Lambda handler is set via CMD pointing to index.handler
# The index.js wrapper will read LAMBDA_HANDLER_PATH to route to the actual handler
# Note: ImageConfig.Command in the plugin overrides this for specific functions
CMD [ "index.handler" ]

