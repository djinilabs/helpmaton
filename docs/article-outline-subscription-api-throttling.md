# Article Outline: Subscription-Based API Throttling Without Client API Keys

**Target audience:** Backend engineers and platform builders implementing multi-tenant APIs with tiered rate limits.  
**Tone:** Technical deep-dive with concrete implementation details; “how we did it” with reusable patterns.

---

## Working title (pick one or combine)

- **Subscription-Based API Throttling Without Client API Keys**
- **Throttling by Tier, Not by Key: API Gateway + Lambda Authorizer**
- **How to Rate-Limit API Requests by Subscription—Without Sending an API Key**

---

## 1. The problem (why this pattern exists)

- **Classic approach:** Client sends an API key; API Gateway (or your app) looks up the key and applies a usage plan. Simple, but you must issue, rotate, and secure keys; clients must send them on every request.
- **What we want instead:** Clients authenticate with what they already have (Bearer JWT, session cookie, or a webhook secret in the path). Throttling is still by **subscription tier** (free / starter / pro), but the client never sees or sends an “API key” for throttling.
- **Use case:** Multi-tenant SaaS where the **tenant** (workspace, org, or user) has a subscription. Requests are identified by path (e.g. `/api/webhook/:workspaceId/...`) or by authenticated user; we map that to a subscription and then to a rate limit.
- **Constraints:** Use API Gateway’s built-in throttling (rate + burst) so limits are enforced at the edge without touching your Lambda code. API Gateway only knows how to throttle by **usage plan + API key**, so we need to bridge “subscription” to “API key” in the authorizer.

**Takeaway:** We keep using API Gateway usage plans and API keys as the *mechanism*, but we create and attach those keys **per subscription** in a Lambda authorizer. The client only sends Bearer/session or path-based auth; the authorizer resolves subscription → API key ID → returns it as `usageIdentifierKey`.

---

## 2. High-level architecture

- **Request path:** Client → API Gateway → **Lambda authorizer** → (if allow) API Gateway applies throttle for the returned `usageIdentifierKey` → Lambda handler.
- **Authorizer responsibilities:**
  1. **Identify the tenant:** From path (e.g. `workspaceId`) and/or from Bearer token (JWT or API key) → user → user’s subscription.
  2. **Resolve subscription and plan:** Workspace → subscription, or user → subscription (with “auto-create free subscription” if needed).
  3. **Get or create an API key for that subscription:** One API key per subscription, name e.g. `{stackName}-subscription-{subscriptionId}`. Stored in your DB (e.g. `subscription.apiKeyId`) so the authorizer can reuse it.
  4. **Return IAM policy + `usageIdentifierKey`:** Allow/Deny + the API key ID so API Gateway can apply the right usage plan.
- **Infrastructure (IaC):** Usage plans (free/starter/pro) are created as CloudFormation resources with rate + burst. The authorizer Lambda gets permission to create API keys and associate them with usage plans. No API keys in CloudFormation—they are created at runtime.

**Diagram idea:** One sequence diagram: Client → API Gateway → Authorizer (path → workspace → subscription → get/create API key) → response with `usageIdentifierKey` → API Gateway throttle check → Lambda.

---

## 3. Step 1: Path and auth — deriving the tenant

- **Path-based tenant (e.g. workspace):** Authorizer receives `methodArn`; parse it to get the resource path (e.g. `/api/webhook/ws_123/agent_456/secret`). Use a small set of regexes (e.g. `/api/webhook/:workspaceId/...`, `/api/workspaces/:workspaceId/...`) to extract `workspaceId`. If present, lookup workspace → subscription in DB.
- **Fallback: user-based.** If path has no workspace or workspace has no subscription, require Bearer token. Validate JWT (e.g. verify access token) or validate API key and resolve to `userId`. Then lookup user’s subscription (create default free subscription if needed). Now you have `subscriptionId` and `plan` in both paths.
- **Public routes:** For routes that must skip auth (e.g. `/api/health`), return Allow **without** `usageIdentifierKey` so no throttling is applied (or document that they’re unthrottled).
- **Important:** Authorizer must receive both `Authorization` and the request path. Use a **REQUEST** authorizer (not TOKEN) so you get full request. Set `IdentitySource` to e.g. `method.request.header.authorization,context.resourcePath` so cache keys differ when path or auth changes (avoid wrong-throttle-tier cache).

---

## 4. Step 2: Subscription → usage plan

- **Data model:** Workspace (or user) has a subscription; subscription has `pk` (e.g. `subscriptions/{id}`), `plan` (free | starter | pro), and optionally `apiKeyId` (API Gateway key ID).
- **Usage plans in CloudFormation:** One `AWS::ApiGateway::UsagePlan` per tier. Each has a **stack-unique name** (e.g. `{StackName}-free`) so PR/staging stacks don’t collide. Each plan has `Throttle`: `RateLimit` (req/s) and `BurstLimit`. Plans are attached to the same API and stage.
- **Authorizer env (or lookup):** Authorizer needs the REST API ID and, for each plan, the usage plan ID. Options: (a) env vars set by IaC, or (b) lookup by plan name (e.g. `GetUsagePlans`, find by name). Name-based lookup avoids circular dependencies (authorizer doesn’t depend on usage plan output at deploy time).

---

## 5. Step 3: One API key per subscription (create and attach)

- **When:** In the authorizer, after you have `subscriptionId` and `plan`. If `subscription.apiKeyId` is set, use it. Otherwise create/associate and persist.
- **Create key:** Call `CreateApiKey` with a deterministic name (e.g. `{stackName}-subscription-{subscriptionId}`). Optionally `GetApiKeys` with `nameQuery` first to reuse an existing key; if disabled, re-enable with `UpdateApiKey`. Store the returned key **ID** (not the secret) in the subscription record.
- **Associate with usage plan:** Call `CreateUsagePlanKey` with `usagePlanId` (for the current `plan`) and `keyId`. If the key was already in another plan (e.g. after upgrade/downgrade), either: (a) create new association first, then remove from other plans (to avoid a moment with no plan), or (b) document that you only ever add to one plan per key and move by delete + create. Idempotency: if `CreateUsagePlanKey` returns Conflict, key is already in the plan—treat as success.
- **Upgrades/downgrades:** When subscription plan changes (e.g. in a webhook or admin flow), call the same “associate with plan” logic: add to new plan, then remove from old plan(s). Authorizer can stay dumb: it only ensures an API key exists and is in *some* plan; the “which plan” is kept in sync by subscription lifecycle.
- **Where to run:** Authorizer can call `associateSubscriptionWithPlan(subscriptionId, plan)` and then update DB with `apiKeyId`. Alternatively, subscription creation/update (outside the authorizer) can create the key and set `apiKeyId` so the authorizer only reads. Lazy creation in the authorizer keeps subscription logic simple and avoids a separate “sync API key” job.

---

## 6. Step 4: Return the right policy and `usageIdentifierKey`

- **Allow:** Return an IAM policy that allows `execute-api:Invoke` on the API. Use a **wildcard resource** (e.g. `arn:...:api-id/stage/*/*`) so one cached result applies to all methods/paths for that API and stage; otherwise path parameter encoding can break cache matches.
- **Throttling:** Set `usageIdentifierKey` to the API key **ID** (not the value). API Gateway will look up that key, find its usage plan(s), and apply that plan’s throttle for this request.
- **Context (optional):** Pass `subscriptionId`, `plan`, and optionally `workspaceId` in the authorizer response context so the Lambda handler can use them without re-querying (e.g. for logging or feature flags).
- **Deny:** On auth failure, return Deny with the same wildcard resource. Optionally put `statusCode` in context so a custom response template can return 401/403; otherwise API Gateway returns 403 for Deny.

---

## 7. Caching and correctness

- **Authorizer caching:** API Gateway caches the authorizer result by `IdentitySource`. Include both `authorization` and `context.resourcePath` so different paths or tokens get different cache entries. TTL (e.g. 300s): balance between reducing authorizer invocations and reacting to plan changes (e.g. upgrade). Plan changes can be reflected after TTL or by ensuring new requests use a different cache key if needed.
- **No key in the client:** The client never receives or sends the throttling API key. They send Bearer token or path-only auth; the authorizer maps that to a subscription and then to an internal API key ID.

---

## 8. Infrastructure as code (summary)

- **Plugin / IaC flow:** A plugin (e.g. Architect) runs after the REST API and routes exist. It: (1) creates usage plans (with stack-unique names), (2) creates the authorizer resource (REQUEST type, correct IdentitySource), (3) attaches the authorizer to all relevant methods (e.g. all `/api/*` except `/api/auth/*` and `/api/authorizer`), (4) grants the authorizer Lambda permission to be invoked by API Gateway and to call `apigateway:GET/POST/PUT/DELETE/PATCH` on usage plans and API keys.
- **Env vars:** Authorizer receives REST API ID and stage name; usage plan IDs can be env or resolved by name at runtime. Stack name is needed for unique plan names and API key names (important for PR/staging stacks).

---

## 9. Edge cases and pitfalls

- **Workspace without subscription:** e.g. just created or downgraded/canceled. Authorizer can fall back to user-based subscription or return 402/403 with a clear message; document the behavior.
- **First request for a new subscription:** Authorizer creates the API key and associates it; first request may be slightly slower. Persist `apiKeyId` so subsequent requests are fast.
- **Local / testing:** No API Gateway in local stack. Authorizer can short-circuit: if env is local/test, return Allow without `usageIdentifierKey` (or with a mock key) and skip AWS calls so local dev works without AWS.
- **Plan changes:** If a customer upgrades, call “associate with new plan” when you update the subscription (e.g. in webhook handler). Authorizer only creates key if missing; it doesn’t re-sync plan every time (you can, but it’s more calls).

---

## 10. Conclusion and takeaways

- **Pattern:** Use API Gateway usage plans + API keys as the throttle mechanism, but create and attach keys **per subscription** in a Lambda REQUEST authorizer. Client sends Bearer or path-based auth only.
- **Benefits:** Tiered throttling at the edge, no client-managed throttling keys, one key per subscription, plan changes via “associate with plan” + DB.
- **When to use:** Multi-tenant APIs where the tenant (workspace/org/user) has a subscription and you want rate limits by tier without giving each client a separate “throttling API key.”
- **When not to use:** If every client already has an API key and you’re happy using it for both auth and throttling, the classic “client sends key, gateway throttles by key” may be simpler.

---

## Optional sections (if space)

- **Comparison:** Table of “client sends API key” vs “client sends Bearer/path, authorizer resolves key” (who creates keys, who stores them, what client sends, where throttle is enforced).
- **Security:** Authorizer still validates identity (JWT or webhook secret); throttling is an extra dimension. Don’t rely on throttle as the only auth.
- **Metrics:** How to log or metricize by subscription/plan (e.g. CloudWatch or context passed to Lambda) for usage and abuse detection.

---

## Code references (for writing)

- Authorizer: `apps/backend/src/http/any-api-authorizer/index.ts` (path extraction, workspace → subscription, user fallback, get/create API key, return policy + `usageIdentifierKey`).
- Usage plans (IaC): `apps/backend/src/plugins/api-throttling/usage-plans.js` (CloudFormation usage plans, throttle settings).
- Plugin: `apps/backend/src/plugins/api-throttling/index.js` (authorizer resource, REQUEST type, IdentitySource, method attachment, IAM for authorizer).
- Associate key with plan: `apps/backend/src/utils/apiGatewayUsagePlans.ts` (`associateSubscriptionWithPlan`, `getOrCreateApiKeyForSubscription`, add to plan then remove from others).
- README: `apps/backend/src/plugins/api-throttling/README.md` (request flow, config, troubleshooting).
