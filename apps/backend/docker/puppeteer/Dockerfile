# 1. Switch platform to linux/amd64 (x86)
FROM --platform=linux/amd64 public.ecr.aws/lambda/nodejs:22

# Build argument for dist source directory
# Defaults to apps/backend/dist for backward compatibility
ARG DIST_SOURCE=apps/backend/dist

# 2. Install system dependencies for Chromium on x86
# This list is standard for Amazon Linux 2023 on x86
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
    && dnf clean all

# 3. Install pnpm
RUN npm install -g pnpm

# 4. Install Dependencies
WORKDIR /tmp/build
COPY apps/backend/docker/puppeteer/package.json ./

# The @sparticuz/chromium package contains the x86 binary inside it.
# We just install it like a normal package.
RUN pnpm install --prod && \
    rm -rf /root/.pnpm-store /root/.local/share/pnpm && \
    npm uninstall -g pnpm

# Clean up unnecessary files from node_modules to reduce image size
RUN find /tmp/build/node_modules -type f \( \
        -name "README*" -o \
        -name "CHANGELOG*" -o \
        -name "LICENSE*" -o \
        -name "*.test.*" -o \
        -name "*.spec.*" -o \
        -name "*.ts" -o \
        -name "*.map" \
    \) -delete && \
    find /tmp/build/node_modules -type d \( \
        -name "test" -o \
        -name "tests" -o \
        -name "__tests__" -o \
        -name "examples" -o \
        -name "example" -o \
        -name "docs" -o \
        -name "doc" -o \
        -name ".github" -o \
        -name ".git" \
    \) -exec rm -rf {} + 2>/dev/null || true

# 5. Move to Task Root
WORKDIR ${LAMBDA_TASK_ROOT}
RUN cp -r /tmp/build/node_modules ./node_modules && \
    rm -rf /tmp/build

# 6. Copy Code (or prepared dist subset)
COPY ${DIST_SOURCE}/ ${LAMBDA_TASK_ROOT}/
COPY apps/backend/docker/lancedb/index.js ${LAMBDA_TASK_ROOT}/index.js

# Ensure permissions
RUN chmod -R 755 ${LAMBDA_TASK_ROOT}

CMD [ "index.handler" ]