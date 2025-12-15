# Active Context

## Current Status

**Status**: Lambda Container Image Deployment - Working ✅

The Lambda function using container images is now successfully deployed and working. All configuration issues have been resolved.

## Recent Changes

### Lambda Container Image Deployment Fixes (December 2025)

**Problem**: Lambda function using container images was failing with `Runtime.InvalidEntrypoint` / `ProcessSpawnFailed` errors.

**Root Causes Identified & Fixed**:

1. **Architecture Mismatch** (Most Critical)

   - Lambda function configured for `arm64` but Docker image was built for `amd64` by default
   - **Fix**: Added `--platform linux/arm64` to Docker build command in `scripts/build-and-push-lambda-images.sh`
   - Added Docker Buildx setup in GitHub Actions workflow for cross-platform builds

2. **Docker Buildx Manifest Format**

   - Buildx v0.10+ adds provenance and SBOM metadata by default, which Lambda doesn't support
   - **Fix**: Added `--provenance=false --sbom=false` flags to buildx command

3. **ES Module vs CommonJS Format**

   - Build script was outputting ES modules (`format: "esm"`) but Lambda needs CommonJS
   - **Fix**: Changed `format: "esm"` to `format: "cjs"` in `scripts/build-backend.ts`

4. **Environment Variable Injection Timing**

   - Docker image was built before environment variables were set in GitHub Actions workflow
   - **Fix**: Added all environment variables to "Build backend (for Docker images)" step so they're available when `esbuild-config.cjs` reads `process.env` during build

5. **ImageConfig Configuration**
   - Lambda requires all three ImageConfig properties (EntryPoint, Command, WorkingDirectory) to be non-empty
   - **Fix**: Set `ImageConfig.EntryPoint = ["/lambda-entrypoint.sh"]`, `ImageConfig.Command = [handlerPath]`, and `ImageConfig.WorkingDirectory = "/var/task"`

**Files Modified**:

- `.github/workflows/deploy-pr.yml` - Added env vars to build step, Docker Buildx setup
- `scripts/build-and-push-lambda-images.sh` - Added `--platform linux/arm64`, `--provenance=false --sbom=false`
- `scripts/build-backend.ts` - Changed format from `"esm"` to `"cjs"`
- `apps/backend/src/plugins/container-images/index.js` - Set ImageConfig properties correctly
- `apps/backend/docker/lancedb/Dockerfile` - Added entrypoint verification and file permissions

**Current Configuration**:

- Lambda Architecture: `arm64`
- ImageConfig.EntryPoint: `["/lambda-entrypoint.sh"]`
- ImageConfig.Command: `["http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"]`
- ImageConfig.WorkingDirectory: `"/var/task"`
- Build Format: CommonJS (`cjs`)
- Environment variables: Injected at build time via esbuild `define` option

### Docker Image Size Optimization (December 2025)

**Problem**: Lambda Docker images were larger than desired, increasing deployment time and storage costs.

**Optimizations Implemented**:

1. **Multi-Stage Builds**

   - LanceDB Dockerfile now uses two-stage build (builder + runtime)
   - Build tools (python3, make, gcc-c++, git) and pnpm are only in builder stage
   - Final image contains only runtime dependencies and compiled code
   - Expected size reduction: 50-70%

2. **Package Manager Cache Cleanup**

   - Added `pnpm store prune` to remove unused packages from pnpm store
   - Removed `/root/.pnpm-store` and workspace `.pnpm` directories after install

3. **.dockerignore File**

   - Created `.dockerignore` to exclude unnecessary files from build context
   - Excludes: node_modules, tests, docs, git files, IDE configs, build artifacts

4. **Removed Verification Steps**
   - Removed verbose verification RUN commands from production Dockerfile
   - These can be added back temporarily for debugging if needed

**Files Modified**:

- `.dockerignore` - Created to exclude unnecessary files
- `apps/backend/docker/base/Dockerfile` - Updated paths for monorepo build context
- `apps/backend/docker/lancedb/Dockerfile` - Implemented multi-stage build

## Next Steps

1. Monitor Lambda function performance and cold start times
2. Measure actual image size reduction after deployment
3. Document container image deployment process for other functions

## Notes

- Project is actively maintained
- Uses AWS serverless architecture (Lambda, API Gateway, DynamoDB)
- Monorepo structure with backend and frontend apps
- PR deployments create CloudFormation stacks for testing
- Container images are built for `arm64` architecture (Graviton2) for better price/performance
- Environment variables are injected at build time, not runtime, for container image functions
