# Article Outline: Building Real-Time AI Streaming Services — The Helpmaton Follow-Up

**Prerequisite reading:** [Building Real-Time AI Streaming Services with AWS Lambda and Architect](https://metaduck.com/building-real-time-ai-streaming-services/)

**Target audience:** Backend engineers and platform builders implementing streaming AI services on AWS Lambda. Readers familiar with the original article who want to see how these patterns evolved in production.

**Tone:** Technical deep-dive, "how we evolved the pattern" — building on the original with concrete Helpmaton implementation details.

---

## Working Title Options

- **Real-Time AI Streaming in Production: What We Built at Helpmaton**
- **From Prototype to Production: Evolving Our Lambda Streaming Architecture**
- **Streaming AI + Subscription Throttling: How Helpmaton Solved the Edge Case**

---

## 1. Introduction — Where We Left Off

- **Recap:** The original article covered streaming AI with Lambda Function URLs, Architect, and the Vercel AI SDK—streaming responses, tool execution, local development.
- **The open question:** The original article ended with "Important Note: Throttling Challenges"—streaming throttling was an unsolved, business-dependent problem.
- **This follow-up:** How Helpmaton, an AI agent platform, implemented these patterns in production and addressed the throttling gap (for the API layer) while evolving the streaming architecture.
- **Helpmaton context:** Workspace-based AI agents, webhooks, REST API, subscription tiers (Free/Starter/Pro), credit-based usage.

**Takeaway:** Same foundation (Lambda URLs, AI SDK, Architect), but production-ready patterns for multi-tenant SaaS.

---

## 2. Architecture Overview — Same Foundation, Different Shape

- **Core components (unchanged):**
  - Lambda Function URLs with `InvokeMode: RESPONSE_STREAM`
  - Custom Architect plugin for Lambda URLs
  - AI SDK (`streamText`, `pipeDataStreamToResponse`, `useChat`)
- **Helpmaton differences:**

| Aspect | Original (Decipad) | Helpmaton |
|--------|--------------------|-----------|
| **Stream path** | `/api/ai/chat-stream?provider=...&model=...` | `/api/streams/:workspaceId/:agentId/:secret` |
| **Auth** | Bearer token (JWT) | Secret in path (production) or session/JWT (dashboard) |
| **Entry point** | Single chat stream | Multiple paths: agent stream, workspace assistant, meta-agent config |
| **Container** | Default Lambda runtime | Custom container (`lancedb`) for LLM routes |
| **Routing** | Dedicated Lambda per route | Shared `llm-shared-stream` handler with internal routing |

- **Stream path variants:**
  - `POST /api/streams/:workspaceId/:agentId/:secret` — secret-based (production webhooks)
  - `POST /api/streams/:workspaceId/:agentId/test` — session/JWT (test in UI)
  - `POST /api/streams/:workspaceId/_workspace/test` — workspace assistant (virtual agent)
  - `POST /api/streams/:workspaceId/:agentId/config/test` — meta-agent "Configure with AI"

**Diagram idea:** High-level architecture: Client → Lambda URL (streams) vs Client → API Gateway (REST) → Lambda. Show both paths and where throttling applies.

---

## 3. Streaming Implementation — Lambda URLs and Handler Structure

### 3.1 Lambda URLs Plugin (`@lambda-urls`)

- **app.arc pragma:** `any /api/streams/*`, `post /api/scrape`
- **CloudFormation:** Creates `AWS::Lambda::Url` with `InvokeMode: RESPONSE_STREAM`
- **Key:** Bypasses API Gateway for lower latency and native streaming.
- **CORS:** Configured per route; CORS headers set for cross-origin requests.

### 3.2 Dual Handler Support

- **Challenge:** Some routes need to work with both Lambda Function URL (true streaming) and API Gateway (buffered).
- **Solution:** `streamifyResponse` wrapper; `normalizeEventToHttpV2` to handle both event types.
- **Code reference:** `any-api-streams-catchall/index.ts`, `llm-shared-stream/index.ts`

### 3.3 Authentication Before Streaming

- **Principle:** Same as original—authenticate before expensive operations.
- **Path-based:** Secret in path → lookup `agent-stream-servers` table → validate workspace/agent match.
- **Session-based:** Test paths require Bearer token or session cookie; validate via auth middleware.
- **Early exit:** On invalid secret → 401; on invalid session → 403; no LLM call until auth passes.

### 3.4 Credit System

- **Pre-stream:** Reserve credits based on estimated token cost.
- **During stream:** Adjust reservation as actual usage is known.
- **Error handling:** Stream `type: "error"` events (e.g. `InsufficientCreditsError`) instead of HTTP 4xx; client can display gracefully.
- **Difference from original:** No generic "rate limit" in the original; Helpmaton adds credit-based usage control.

---

## 4. Throttling — Solving the Edge Case (Partially)

### 4.1 The Two-Track Architecture

- **REST API / Webhooks:** Client → API Gateway → Lambda authorizer → (throttle check) → Lambda handler.
- **Streaming:** Client → Lambda URL directly → Lambda handler. **No API Gateway, no authorizer for throttling.**

- **Important:** Streaming routes bypass API Gateway entirely, so the subscription-based throttling (authorizer + usage plans) applies to REST API, webhooks, and non-streaming routes—not to streaming Lambda URLs.

### 4.2 Subscription Throttling for REST API (The Solution)

- **Problem:** API Gateway throttles by usage plan + API key. Clients don't want to send a separate "throttling API key."
- **Solution:** Lambda REQUEST authorizer maps each request (path or Bearer token) to a subscription, get-or-creates an API key for that subscription, returns `usageIdentifierKey`. API Gateway throttles by that key’s usage plan at the edge.
- **Client contract:** Client sends Bearer token or path-based secret only; never sees or sends the throttling key.
- **Usage plans:** Free (100 req/s, 200 burst), Starter (500/1000), Pro (2000/4000).
- **Full treatment:** See [Subscription-Based API Throttling Without Client API Keys](https://metaduck.com/subscription-based-api-throttling-without-client-api-keys/).

### 4.3 Streaming Protection

- **What applies to streaming:** Credit validation, secret validation, CORS. No API Gateway-level throttling.
- **Trade-off:** Throttling is per-request; long-lived streams consume resources for their duration. Credit validation provides cost protection; per-subscription request limits apply to non-streaming API traffic.
- **Future work:** Pre-stream or mid-stream throttling for streaming endpoints (e.g. concurrent stream limits, token-per-minute caps) remains a possible extension.

---

## 5. Tool Execution and Agent Model

- **Tool execution:** Similar to original—streamText with tools, some auto-executed, some require user confirmation.
- **Helpmaton-specific:** Agent tools (MCP tools, search_documents, etc.) vs. workspace/meta-agent tools (configure_agent, etc.).
- **Workspace agent:** Virtual agent at `agentId === "_workspace"`; no DB record.
- **Meta-agent:** Reuses existing agent in "configuration mode" for "Configure with AI" chat.
- **Tool validation:** Zod schemas for tool args; validate before execution.

---

## 6. Protocol and Frontend Integration

### 6.1 SSE Format

- **Format:** Standard SSE with `data: {json}\n\n` (AI SDK compatible).
- **Event types:** `text-delta`, `text`, `tool-call`, `tool-result`, `error`, `done`.
- **Difference:** Helpmaton uses SSE; original article mentioned AI SDK protocol format (type 0/1/2/3/4). Both are AI SDK compatible.

### 6.2 Frontend

- **`useChat` from `@ai-sdk/react`:** Same as original; API URL points to stream endpoint.
- **Auth:** Secret path: no headers; test paths: `Authorization: Bearer` or session cookie.
- **Getting stream URL:** `GET /api/stream-url` returns Lambda URL for client to construct stream path.

---

## 7. Local Development and Sandbox

- **Same idea:** Custom plugin provides local server that mimics Lambda Function URL behavior.
- **lambda-urls plugin:** Sandbox mode starts HTTP server; constructs fake Lambda event from HTTP request; invokes handler with `ResponseStream`; bridges to HTTP response.
- **Port management:** `STREAMING_LAMBDA_SERVER_PORT_PREFIX` + `VITEST_WORKER_ID` for multi-worker tests.
- **Throttling:** In local/test env, authorizer returns Allow without `usageIdentifierKey`; no AWS calls.

---

## 8. Infrastructure as Code

- **Plugins:** `lambda-urls`, `api-throttling`, `container-images`, `http-to-rest`, `custom-domain`.
- **Container images:** `llm-shared-stream` for streaming routes; LanceDB for embeddings/graph.
- **Usage plans:** Created by `api-throttling` plugin; stack-unique names for PR/staging.
- **PR deployments:** Each PR gets its own stack; usage plans and authorizer are per-stack.

---

## 9. Lessons Learned and What’s Next

### 9.1 What Works

- Lambda Function URLs for streaming: low latency, native streaming.
- Secret-in-path auth for webhooks: simple; no CORS preflight for credentials.
- Path-based routing: workspace/agent from path; subscription from workspace.
- Credit system: pre-stream reserve + adjust; protects against abuse.

### 9.2 Challenges

- **Streaming vs. throttling:** API Gateway throttling doesn’t apply to Lambda URLs; streaming needs its own protection (credits, limits).
- **Dual handler:** Supporting both Lambda URL and API Gateway adds complexity; `normalizeEventToHttpV2` helps.
- **Container size:** LanceDB + LLM deps increase cold start; warm pools help.

### 9.3 Future Work

- Stream-specific throttling: concurrent stream limits, token-per-minute caps.
- Mid-stream monitoring: detect abuse patterns during long streams.
- Graceful degradation: reduce quality/speed instead of hard cutoff.

---

## 10. Conclusion

- **Summary:** Helpmaton built on the original streaming architecture with production-ready patterns: multi-path streaming, secret-based auth, credit system, and subscription throttling for the REST API.
- **Throttling:** Solved for REST API via Lambda authorizer + usage plans; clients never send a throttling key. Streaming uses credits and validation; edge throttling for streams is future work.
- **References:**
  - Original: [Building Real-Time AI Streaming Services](https://metaduck.com/building-real-time-ai-streaming-services/)
  - Throttling: [Subscription-Based API Throttling Without Client API Keys](https://metaduck.com/subscription-based-api-throttling-without-client-api-keys/)
  - PR deployments: [Deploying Pull Requests: A Complete AWS Stack for Every PR](https://metaduck.com/deploying-pull-requests-a-complete-aws-stack-for-every-pr-)

---

## Code References (for Writing)

| Topic | Location |
|-------|----------|
| Streaming handler | `apps/backend/src/http/any-api-streams-catchall/`, `llm-shared-stream/index.ts` |
| Internal stream logic | `apps/backend/src/http/any-api-streams-catchall/internalHandler.ts` |
| Stream AI pipeline | `apps/backend/src/http/utils/streamAIPipeline.ts` |
| Lambda URLs plugin | `apps/backend/src/plugins/lambda-urls/index.js` |
| API throttling plugin | `apps/backend/src/plugins/api-throttling/` |
| Authorizer | `apps/backend/src/http/any-api-authorizer/index.ts` |
| Stream path params | `apps/backend/src/http/any-api-streams-catchall/` (extractStreamPathParameters) |
| Streaming docs | `docs/streaming-system.md` |
| Throttling docs | `docs/api-throttling.md`, `docs/blog-subscription-api-throttling-without-client-keys.md` |

---

## Optional Sections (If Space)

- **Comparison table:** Original vs. Helpmaton (auth, paths, throttling, credits).
- **Sequence diagram:** Request flow for streaming (secret validation → credit reserve → stream) vs. REST (API Gateway → authorizer → throttle → Lambda).
- **Error handling:** How credit errors, auth errors, and tool errors are streamed as SSE events.
