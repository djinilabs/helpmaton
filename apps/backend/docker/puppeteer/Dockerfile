# Puppeteer Docker image for Lambda functions
# Optimized for arm64 architecture
FROM public.ecr.aws/lambda/nodejs:20

# 1. Install system dependencies for @sparticuz/chromium on AL2023
# These are strictly required for the headless chromium binary to launch
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
    tar \
    && dnf clean all

# 2. Install pnpm globally
RUN npm install -g pnpm

# 3. Copy minimal package.json
WORKDIR /tmp/build
COPY apps/backend/docker/puppeteer/package.json ./

# 4. Install dependencies
# We use puppeteer-core + @sparticuz/chromium, so no huge download happens here
# The chromium.br file is included in the npm package and will be extracted at runtime
RUN pnpm install --prod && \
    rm -rf /root/.pnpm-store /root/.local/share/pnpm

# 5. Move to Lambda task root
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy node_modules from build stage
RUN cp -r /tmp/build/node_modules ./node_modules && \
    rm -rf /tmp/build

# 6. Copy built Lambda code
COPY apps/backend/dist/ ${LAMBDA_TASK_ROOT}/

# 7. Copy entrypoint wrapper
COPY apps/backend/docker/lancedb/index.js ${LAMBDA_TASK_ROOT}/index.js

# Ensure permissions
RUN chmod -R 755 ${LAMBDA_TASK_ROOT}

# ENV Configuration
# We don't need PUPPETEER_EXECUTABLE_PATH here because we set it dynamically in code
# effectively disabling the internal downloader of puppeteer (if you accidentally used 'puppeteer' pkg)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
# Tell @sparticuz/chromium to extract to /tmp (writable in Lambda)
ENV CHROMIUM_PATH=/tmp

CMD [ "index.handler" ]