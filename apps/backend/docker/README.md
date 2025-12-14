# Lambda Container Images

This directory contains Dockerfiles for building containerized Lambda functions.

## Structure

- `base/Dockerfile` - Base image with Node.js 20.x runtime
- `lancedb/Dockerfile` - Image with system dependencies for LanceDB (Python 3, build tools)
- `[image-name]/Dockerfile` - Custom images extending base or using different base images

## Usage

### Base Image

The base image (`base/Dockerfile`) uses the official AWS Lambda Node.js 20.x base image and copies the compiled code from the `dist/` directory.

### LanceDB Image

The `lancedb` image (`lancedb/Dockerfile`) extends the base image and includes system dependencies required for LanceDB's Node.js SDK:

- **python3** - Required for building native Node.js modules
- **make** - Build tool for compiling native dependencies
- **gcc-c++** - C++ compiler for native module compilation
- **git** - May be needed for some npm packages

Unlike the base image, this image installs npm dependencies (via `pnpm install`) to compile native modules like LanceDB. The build tools are used during the `pnpm install` step to compile platform-specific native binaries.

**Monorepo Handling:** The Dockerfile handles the pnpm monorepo structure by:

1. Using the monorepo root as the build context (to access `pnpm-lock.yaml` and workspace config)
2. Setting up a temporary workspace structure with root and backend workspace files
3. Installing dependencies with `--filter backend --shamefully-hoist` to create a flat `node_modules` structure (no symlinks, suitable for Lambda)
4. Copying the flat `node_modules` to the Lambda task root

**Important:** For LanceDB to be available in the image, it must be listed in `apps/backend/package.json` dependencies (e.g., `@lancedb/lancedb`). The Dockerfile installs all production dependencies from the backend workspace's `package.json`.

Use this image when your Lambda function needs to use LanceDB for vector database operations. The image includes all necessary build tools and installs dependencies to ensure LanceDB's native modules are properly compiled for the Lambda runtime environment.

**Usage in app.arc:**

```
@container-images
any /api/route/path lancedb
```

### Custom Images

To create a custom image, create a new directory under `docker/` with your image name:

```dockerfile
# docker/my-custom-image/Dockerfile
FROM public.ecr.aws/lambda/nodejs:20

# Install system dependencies if needed
RUN yum install -y some-package

# Copy built Lambda code
COPY dist/ ${LAMBDA_TASK_ROOT}/

# Set handler (if different from default)
CMD [ "index.handler" ]
```

## Building Images

Images are built automatically during deployment via the `build-and-push-lambda-images.sh` script.

To build locally:

```bash
# Build base image
docker build -t helpmaton-lambda-base -f docker/base/Dockerfile .

# Build custom image
docker build -t my-custom-image -f docker/my-custom-image/Dockerfile .

# Build LanceDB image
docker build -t helpmaton-lambda-lancedb -f docker/lancedb/Dockerfile .
```

## Image Naming Convention

Images are tagged with the format: `{image-name}:{tag}` where:

- `image-name` is specified in the `@container-images` pragma in `app.arc`
- `tag` is typically the commit SHA or "latest"

The full ECR URI format is: `{account-id}.dkr.ecr.{region}.amazonaws.com/{repository-name}:{image-name}-{tag}`

## Requirements

- Docker must be installed
- AWS credentials must be configured for ECR access
- The `dist/` directory must exist (built via `pnpm build` or `arc build`)

## Notes

- Images should be kept small to reduce cold start times
- Use multi-stage builds if you need to compile dependencies
- The base image already includes Node.js 20.x and Lambda runtime interface client
- System libraries can be installed using `yum` (Amazon Linux 2 base)
