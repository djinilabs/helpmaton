# Lambda Container Images

This directory contains Dockerfiles for building containerized Lambda functions.

## Structure

- `base/Dockerfile` - Base image with Node.js 20.x runtime
- `[image-name]/Dockerfile` - Custom images extending base or using different base images

## Usage

### Base Image

The base image (`base/Dockerfile`) uses the official AWS Lambda Node.js 20.x base image and copies the compiled code from the `dist/` directory.

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


