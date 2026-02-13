# Lambda Docker Images for Native Libraries: How We Do It at Helpmaton

## Article Outline for https://metaduck.com

---

### TL;DR (opening hook)

> **TL;DR:** Lambda's default ZIP deployment can't install native Node.js modules that need platform-specific binaries (e.g. LanceDB, DuckDB, Chromium). We use Lambda container images—Docker images pushed to ECR—so we can install these dependencies in the build environment. Each image has a minimal `package.json` with only the native deps; we build for the right architecture (arm64 for cost, amd64 when needed); and we keep images lean. Works with Architect's `@container-images` pragma and our existing CI.

---

### 1. The Problem: Native Libraries and Lambda ZIP

**Why ZIP deployment fails:**
- Lambda ZIP packages are built on your laptop or CI runner (often x86 macOS or Linux).
- Native Node.js modules (`.node` binaries) are compiled for that platform at `npm install` time.
- Lambda runs on Linux (arm64 or x86). The binaries from your dev machine don't match.
- Result: `Error: Cannot find module` or `ProcessSpawnFailed` when the module tries to load.

**What we needed:**
- [LanceDB](https://lancedb.com/) for vector search and embeddings.
- [DuckDB](https://duckdb.org/) (via `@duckdb/node-api`) for in-memory graph queries and S3 Parquet.
- [Chromium](https://pptr.dev/) for web scraping (Puppeteer).

These all ship or depend on native binaries. ZIP deployment doesn't cut it.

---

### 2. Lambda Container Images: The Escape Hatch

**What they are:**
- [Lambda container images](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html) let you run your code in a Docker image instead of a ZIP.
- You build the image in an environment that matches Lambda (Linux, correct architecture), push to ECR, and Lambda pulls it.
- Inside the image you can install system packages (`dnf`), run `pnpm install` so native modules compile/download for the right platform, and copy your app code.

**Why we chose this:**
- Full control over the runtime environment.
- No reliance on Lambda layers or pre-built binaries that might not support our architecture.
- Same pattern for LanceDB, DuckDB, and Chromium—just different images.

---

### 3. Our Setup: Two Images, Two Architectures

| Image | Purpose | Architecture | Why |
|-------|---------|--------------|-----|
| **lancedb** | Vector DB (LanceDB), graph (DuckDB), embeddings, streaming, webhooks | `linux/arm64` | Graviton (arm64) is cheaper; LanceDB and DuckDB ship pre-compiled arm64 binaries. |
| **puppeteer** | Web scraping with Chromium | `linux/amd64` | Chromium Lambda support is mature on x86; `@sparticuz/chromium` provides pre-built x86 binary. |

**Key decision:** Match the image architecture to Lambda's configuration. We had `ProcessSpawnFailed` when the image was built for amd64 but Lambda was configured for arm64—architecture must align.

---

### 4. Image Design: Minimal Dependencies, Lean Builds

**Per-image `package.json`:**
- Each image has its own minimal `package.json` in `docker/{image-name}/`.
- Only lists the native dependencies that image needs—no monorepo hoisting of unrelated deps.
- Example (lancedb): `@lancedb/lancedb`, `@duckdb/node-api`, `apache-arrow`, `reflect-metadata`.

**Platform targeting (lancedb):**
- LanceDB ships optional `@lancedb/lancedb-linux-arm64-gnu` with pre-compiled `.node` binaries.
- We use pnpm `supportedArchitectures` in that `package.json` to restrict install to `linux` + `arm64`.
- Avoids downloading/shipping x86 binaries we don't need—smaller image, faster cold start.

**Build flow:**
1. Compile TypeScript to `dist/` (esbuild, CommonJS).
2. Docker build: copy minimal `package.json`, `pnpm install`, copy `dist/` into image.
3. Push to ECR with tag (e.g. commit SHA).
4. Architect's `container-images` plugin converts Lambdas in `@container-images` to use `ImageUri` instead of `Code`.

---

### 5. Monorepo and Handler Routing

**Challenge:** Architect generates many Lambda functions from routes/queues/schedules. Each has a different handler path (e.g. `http/any-api-streams-000workspaceId-000agentId-000secret/index.handler`).

**Solution:** A single `index.js` wrapper at the image root. Lambda invokes `index.handler`. The wrapper reads `LAMBDA_HANDLER_PATH` (set by the plugin per function) and dynamically requires the correct handler. One image, many handlers.

---

### 6. Integrating with Architect: The `@container-images` Pragma

**Syntax:**
```
@container-images
any /api/streams/* lancedb llm-shared-stream
post /api/webhook/:workspaceId/:agentId/:key lancedb llm-shared-http
post /api/scrape puppeteer
queue agent-temporal-grain-queue lancedb llm-shared-http
scheduled summarize-memory-daily lancedb llm-shared-http
```

**Format:** `method route image-name [group-name]`

**Grouping:** The `llm-shared-stream` and `llm-shared-http` groups merge multiple routes/queues/schedules into a single Lambda. Fewer Lambdas, fewer cold starts, shared warm container. The plugin wires HTTP, SQS, and EventBridge to one handler that dispatches by event type.

---

### 7. CI/CD: Build and Push

**Where it runs:** GitHub Actions during deploy (PR and main).

**Steps:**
1. Build backend (`pnpm build:backend`) so `dist/` exists.
2. Configure Docker Buildx for cross-platform (arm64 for lancedb).
3. Build each image with `--platform linux/arm64` or `linux/amd64` as appropriate.
4. Disable Buildx provenance/SBOM (`--provenance=false --sbom=false`)—Lambda doesn't support the OCI manifest format they add.
5. Push to ECR with `{image-name}:{commit-sha}`.
6. Architect deploy; plugin substitutes `ImageUri` for each function.

---

### 8. Pitfalls We Hit (and Fixes)

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Architecture mismatch | `ProcessSpawnFailed`, `InvalidEntrypoint` | Build image with `--platform linux/arm64` (or amd64) to match Lambda config. |
| Buildx provenance/SBOM | Image fails to load | Add `--provenance=false --sbom=false` to buildx. |
| ES modules in dist | Handler fails to load | Ensure esbuild outputs CommonJS (`format: "cjs"`) for Lambda. |
| Missing ImageConfig | Startup errors | Set `EntryPoint`, `Command`, `WorkingDirectory` in Lambda config. |
| Wrong `dnf` vs `yum` | Build fails | Amazon Linux 2023 base uses `dnf`, not `yum`. |

---

### 9. Image Size and Cold Starts

**Optimizations:**
- Strip `node_modules` of README, tests, `.ts`, `.map` to reduce size.
- Use pre-compiled binaries where possible (LanceDB, Chromium) so we don't need build tools in the final image.
- Single-stage builds when we can—no build tools in the runtime layer.

**Cold start:** Larger images = slower cold start. We accept this for routes that need native libs; we use warm pools in dev and rely on traffic patterns in prod.

---

### 10. When to Use Containers vs ZIP

**Use container images when:**
- You need native Node.js modules with platform-specific binaries.
- You need system libraries (e.g. Chromium deps) not in the default Lambda runtime.
- You want full control over the runtime environment.

**Stick with ZIP when:**
- Pure JS/TS dependencies only.
- You want the fastest possible cold start and smallest package.

---

### 11. Summary

| Aspect | Our approach |
|--------|--------------|
| **Native libs** | Lambda container images (Docker → ECR) |
| **Images** | lancedb (arm64), puppeteer (amd64) |
| **Deps** | Minimal per-image `package.json` |
| **Handler routing** | Wrapper reads `LAMBDA_HANDLER_PATH` |
| **IaC** | Architect `@container-images` pragma + plugin |
| **CI** | Buildx, correct platform, no provenance |

---

### 12. Related and CTA

**Related posts:**
- [Real-Time AI Streaming in Production](https://metaduck.com/...) — streaming routes run on the lancedb image
- [Subscription-Based API Throttling](https://metaduck.com/...) — webhook routes use the same image
- [Deploying Pull Requests](https://metaduck.com/deploying-pull-requests-a-complete-aws-stack-for-every-pr/) — each PR gets its own stack and images

**CTA:**
> Helpmaton is open-source and runs on AWS. If you're building AI agents with vector search, graph data, or web scraping, [check out Helpmaton](https://helpmaton.com)—we've solved the infrastructure so you can focus on your agents.

---

## Tone and Style Notes

- Match existing metaduck.com posts: direct, technical, practical
- TL;DR at top; tables and diagrams where helpful
- Brief definitions for AWS concepts (Lambda, ECR, Architect)
- "We needed", "We chose", "Here's how" — first-person, team voice
- Lessons learned / pitfalls section (readers love this)
- Cross-link to other metaduck.com articles
- End with Helpmaton CTA
