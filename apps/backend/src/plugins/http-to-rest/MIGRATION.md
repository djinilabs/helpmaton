# HTTP to REST API Migration Guide

## Problem: CloudFormation Resource Type Change

When deploying the `http-to-rest` plugin to an **existing stack** that already has an HTTP API v2 (`AWS::Serverless::HttpApi` or `AWS::ApiGatewayV2::Api`), CloudFormation will fail with:

```
Update of resource type is not permitted. The new template modifies resource type of the following resources: [HTTP]
```

This is because CloudFormation does not allow changing the type of an existing resource. The plugin tries to change the `HTTP` resource from `AWS::Serverless::HttpApi` to `AWS::ApiGateway::RestApi`, which is not permitted.

## Solution: 2-Phase Migration

The plugin now supports an automatic 2-phase migration that allows you to migrate existing stacks without downtime.

### How Detection Works

The plugin automatically detects the migration phase:

- **Phase 1**: `HTTP` exists as HTTP API v2, `HTTPRestApi` doesn't exist → Creates `HTTPRestApi` (keeps old `HTTP`)
- **Phase 2**: `HTTPRestApi` exists as REST API → Removes old `HTTP`, renames `HTTPRestApi` to `HTTP`

### Phase 1: Create New REST API

**Goal**: Create the new REST API alongside the old HTTP API.

1. **Enable migration mode**:
   ```bash
   export HTTP_TO_REST_MIGRATION=true
   # or
   export HTTP_TO_REST_MIGRATION_PHASE=1
   ```

2. **Deploy**:
   ```bash
   arc deploy staging
   ```

3. **What happens**:
   - Creates new REST API with ID `HTTPRestApi`
   - Keeps old HTTP API v2 with ID `HTTP`
   - All new resources reference `HTTPRestApi`
   - Old resources continue to reference `HTTP` (still active)

4. **Verify**:
   - Check that `HTTPRestApi` was created in CloudFormation
   - Test the new REST API endpoints
   - Update custom domains/DNS if needed to point to `HTTPRestApi`

### Phase 2: Complete Migration

**Goal**: Remove old HTTP API and rename `HTTPRestApi` to `HTTP`.

1. **The plugin automatically detects Phase 2** when `HTTPRestApi` exists in the template
   - No environment variable needed for Phase 2 detection
   - Alternatively, you can set: `export HTTP_TO_REST_MIGRATION_PHASE=2`

2. **Deploy**:
   ```bash
   arc deploy staging
   ```

3. **What happens**:
   - Removes old `HTTP` resource (HTTP API v2)
   - Removes all old HTTP API v2 resources (Routes, Integrations, Stages, Authorizers)
   - Renames `HTTPRestApi` to `HTTP`
   - Updates all references from `HTTPRestApi` to `HTTP`
   - Migration complete!

4. **Verify**:
   - Check that old `HTTP` resource is gone
   - Check that new `HTTP` resource is `AWS::ApiGateway::RestApi`
   - All endpoints should still work

## Alternative: Stack Replacement (For PR/Test Environments)

For PR deployments or test environments where downtime is acceptable:

1. Delete the existing CloudFormation stack
2. Redeploy with the plugin enabled (no migration mode needed)

This is the cleanest solution and works immediately.

**For PR deployments:**
```bash
# The stack is typically named: HelpmatonStagingPR<PR_NUMBER>
# Use the undeploy script or manually delete via AWS Console
```

## Environment Variables

- `HTTP_TO_REST_MIGRATION=true` - Enable Phase 1 migration mode
- `HTTP_TO_REST_MIGRATION_PHASE=1` - Explicitly set Phase 1
- `HTTP_TO_REST_MIGRATION_PHASE=2` - Explicitly set Phase 2 (usually auto-detected)

## Migration Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: Create New REST API                                │
├─────────────────────────────────────────────────────────────┤
│ HTTP (HTTP API v2) ────────────────┐                       │
│                                     │                       │
│ HTTPRestApi (REST API) ────────────┼─── Active             │
│                                     │                       │
│ All new resources reference HTTPRestApi                     │
└─────────────────────────────────────────────────────────────┘
                    │
                    │ Deploy again (auto-detects Phase 2)
                    ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 2: Complete Migration                                │
├─────────────────────────────────────────────────────────────┤
│ HTTP (REST API) ──────────────────── Active                 │
│                                                              │
│ Old HTTP API v2 resources removed                           │
│ All references updated to HTTP                             │
└─────────────────────────────────────────────────────────────┘
```

## Troubleshooting

### Phase 1 fails with "resource already exists"

If `HTTPRestApi` already exists from a previous failed migration:
- Delete the `HTTPRestApi` resource manually from CloudFormation
- Or set `HTTP_TO_REST_MIGRATION_PHASE=1` explicitly

### Phase 2 doesn't trigger automatically

If Phase 2 detection doesn't work:
- Set `HTTP_TO_REST_MIGRATION_PHASE=2` explicitly
- Verify that `HTTPRestApi` exists in your CloudFormation template

### Custom domains not working

After Phase 1, custom domains may still point to the old HTTP API:
- Update the `custom-domain` plugin configuration
- Or manually update the BasePathMapping to reference `HTTPRestApi`
- After Phase 2, domains will automatically reference `HTTP`

## Why This Works

CloudFormation has strict rules about resource updates:
- ✅ You can modify resource **properties**
- ✅ You can add/remove resources
- ❌ You **cannot** change resource **types**

The 2-phase migration works around this by:
1. **Phase 1**: Creating a new resource (`HTTPRestApi`) with the desired type, keeping the old one
2. **Phase 2**: Removing the old resource and renaming the new one to the original ID

This allows the migration without violating CloudFormation's restrictions.

## Recommendations

1. **For new stacks (PR deployments)**: No migration needed - plugin works automatically
2. **For existing staging/production stacks**: Use 2-phase migration (recommended)
3. **For test environments with downtime tolerance**: Use stack replacement (simpler)
