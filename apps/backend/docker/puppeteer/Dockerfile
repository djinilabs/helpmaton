# Optimized for arm64 architecture
FROM public.ecr.aws/lambda/nodejs:22

# 1. Install required system dependencies (excluding chromium)
# We also install 'tar' and 'brotli' to decompress the binary
RUN dnf install -y \
    atk \
    cups-libs \
    gtk3 \
    libXcomposite \
    libXcursor \
    libXdamage \
    libXext \
    libXi \
    libXrandr \
    libXScrnSaver \
    libXtst \
    nss \
    pango \
    alsa-lib \
    at-spi2-atk \
    libdrm \
    mesa-libgbm \
    unzip \
    ca-certificates \
    tar \
    brotli \
    && dnf clean all

# 2. Install pnpm
RUN npm install -g pnpm

# 3. Manually Download & Install Chromium (ARM64)
# We use the @sparticuz/chromium release which is built for Lambda
# We explicitly grab the 'arm64' version to bypass QEMU architecture detection issues
WORKDIR /opt/chrome

# Download v143.0.0 ARM64 pack
# curl -f ensures we fail immediately if the URL is wrong
RUN curl -fLo chromium.tar \
    https://github.com/Sparticuz/chromium/releases/download/v141.0.0/chromium-v141.0.0-pack.arm64.tar && \
    tar -xf chromium.tar && \
    # The pack contains 'chromium.br', we must decompress it
    brotli -d chromium.br && \
    chmod +x chromium && \
    # Cleanup to save space
    rm chromium.tar chromium.br

# 4. Setup build context for Node App
WORKDIR /tmp/build
COPY apps/backend/docker/puppeteer/package.json ./

# 5. Install Node dependencies
RUN pnpm install --prod && \
    rm -rf /root/.pnpm-store /root/.local/share/pnpm

# 6. Move to Lambda task root
WORKDIR ${LAMBDA_TASK_ROOT}
RUN cp -r /tmp/build/node_modules ./node_modules && \
    rm -rf /tmp/build

# 7. Copy code
COPY apps/backend/dist/ ${LAMBDA_TASK_ROOT}/
COPY apps/backend/docker/lancedb/index.js ${LAMBDA_TASK_ROOT}/index.js

# 8. CRITICAL ENV VARS
# Point Puppeteer to the binary we just decompressed in /opt/chrome
ENV PUPPETEER_EXECUTABLE_PATH=/opt/chrome/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Ensure permissions
RUN chmod -R 755 ${LAMBDA_TASK_ROOT}

CMD [ "index.handler" ]