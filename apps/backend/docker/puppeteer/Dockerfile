# Optimized for arm64 architecture
FROM public.ecr.aws/lambda/nodejs:20

# 1. Install Chromium and dependencies for ARM64
# "chromium" package in Amazon Linux 2023 is ARM-compatible
RUN dnf install -y \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    libX11 \
    && dnf clean all

# 2. Install pnpm
RUN npm install -g pnpm

# 3. Setup build context
WORKDIR /tmp/build
COPY apps/backend/docker/puppeteer/package.json ./

# 4. Install Node dependencies
# We use puppeteer-core to avoid downloading Chrome
RUN pnpm install --prod && \
    rm -rf /root/.pnpm-store /root/.local/share/pnpm

# 5. Move to Lambda task root
WORKDIR ${LAMBDA_TASK_ROOT}
RUN cp -r /tmp/build/node_modules ./node_modules && \
    rm -rf /tmp/build

# 6. Copy code
COPY apps/backend/dist/ ${LAMBDA_TASK_ROOT}/
COPY apps/backend/docker/lancedb/index.js ${LAMBDA_TASK_ROOT}/index.js

# 7. CRITICAL ENV VARS
# Tell Puppeteer exactly where the system Chromium is
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Ensure permissions
RUN chmod -R 755 ${LAMBDA_TASK_ROOT}

CMD [ "index.handler" ]