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

# Install Chromium for arm64
# Chrome for Testing doesn't provide linux-arm64 builds in stable channel
# So we install Chromium from the system package manager (Amazon Linux 2023)
# Chromium is compatible with Puppeteer and works on arm64
RUN dnf install -y chromium && \
    mkdir -p /opt/chrome/chrome-linux-arm64 && \
    if [ -f /usr/bin/chromium-browser ]; then \
    ln -sf /usr/bin/chromium-browser /opt/chrome/chrome-linux-arm64/chrome; \
    elif [ -f /usr/bin/chromium ]; then \
    ln -sf /usr/bin/chromium /opt/chrome/chrome-linux-arm64/chrome; \
    else \
    echo "ERROR: Chromium not found after installation" && \
    find /usr -name "*chromium*" 2>/dev/null && \
    exit 1; \
    fi && \
    chmod +x /opt/chrome/chrome-linux-arm64/chrome && \
    echo "Chromium installed at: /opt/chrome/chrome-linux-arm64/chrome"

# Verify Chrome installation and architecture
RUN if [ ! -f "/opt/chrome/chrome-linux-arm64/chrome" ]; then \
    echo "ERROR: Chrome executable not found at /opt/chrome/chrome-linux-arm64/chrome" && \
    ls -la /opt/chrome/chrome-linux-arm64/ && \
    exit 1; \
    fi && \
    BINARY_INFO=$(file /opt/chrome/chrome-linux-arm64/chrome) && \
    echo "Binary info: $BINARY_INFO" && \
    if echo "$BINARY_INFO" | grep -q "x86-64\|x86_64\|Intel 80386"; then \
    echo "ERROR: Chrome binary is for x86_64, but we need arm64/aarch64" && \
    exit 1; \
    fi && \
    if ! echo "$BINARY_INFO" | grep -q "aarch64\|ARM\|arm64"; then \
    echo "WARNING: Chrome binary architecture unclear: $BINARY_INFO"; \
    fi && \
    chmod +x /opt/chrome/chrome-linux-arm64/chrome && \
    echo "Chrome installed successfully at: /opt/chrome/chrome-linux-arm64/chrome"

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

