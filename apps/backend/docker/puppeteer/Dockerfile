# Puppeteer Docker image for Lambda functions
# Single-stage build optimized for arm64 architecture
FROM public.ecr.aws/lambda/nodejs:20

# Install system dependencies required for Puppeteer/Chrome
# Amazon Linux 2023 uses dnf (not yum)
# Note: fonts-liberation is not available in AL2023, removed from package list
# Added file utility to verify binary architecture and wget/unzip for Chrome download
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
    wget \
    unzip \
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

# Install Chrome for arm64
# @puppeteer/browsers doesn't respect --platform flag when building in x86_64 emulator
# So we manually download the arm64 Chrome binary from Google's CDN
# Query Chrome for Testing API to get the correct download URL for latest stable arm64
RUN mkdir -p /opt/chrome/chrome-linux-arm64 && \
    cd /opt/chrome/chrome-linux-arm64 && \
    echo "Querying Chrome for Testing API for latest stable arm64 version..." && \
    API_RESPONSE=$(wget -qO- "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json" 2>/dev/null) && \
    CHROME_URL=$(echo "$API_RESPONSE" | grep -o "\"url\":\"[^\"]*linux-arm64[^\"]*\.zip\"" | grep -i "stable\|chrome" | head -1 | cut -d'"' -f4) && \
    if [ -z "$CHROME_URL" ]; then \
    echo "Could not parse URL from API, extracting version and constructing URL..." && \
    STABLE_VERSION=$(echo "$API_RESPONSE" | grep -o "\"version\":\"[0-9.]*\"" | head -1 | cut -d'"' -f4) && \
    echo "Latest stable version: $STABLE_VERSION" && \
    CHROME_URL="https://storage.googleapis.com/chrome-for-testing-public/${STABLE_VERSION}/linux-arm64/chrome-linux-arm64.zip"; \
    fi && \
    echo "Downloading Chrome from: $CHROME_URL" && \
    wget --tries=3 --timeout=60 "$CHROME_URL" -O chrome-linux-arm64.zip || \
    (echo "ERROR: Failed to download Chrome (exit code: $?)" && \
    echo "Attempted URL: $CHROME_URL" && \
    exit 1) && \
    if [ ! -f chrome-linux-arm64.zip ] || [ ! -s chrome-linux-arm64.zip ]; then \
    echo "ERROR: Failed to download Chrome binary or file is empty" && \
    ls -lh chrome-linux-arm64.zip 2>/dev/null || echo "File does not exist" && \
    exit 1; \
    fi && \
    echo "Downloaded $(du -h chrome-linux-arm64.zip | cut -f1)" && \
    unzip -q chrome-linux-arm64.zip && \
    if [ -d chrome-linux-arm64 ]; then \
    mv chrome-linux-arm64/* . && \
    rmdir chrome-linux-arm64; \
    fi && \
    rm -f chrome-linux-arm64.zip && \
    if [ ! -f chrome ]; then \
    echo "ERROR: Chrome executable not found after extraction" && \
    ls -la && \
    exit 1; \
    fi && \
    chmod +x chrome && \
    echo "Chrome installed at: /opt/chrome/chrome-linux-arm64/chrome"

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

