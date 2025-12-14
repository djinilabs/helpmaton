# OpenAPI Generation Guide

This document explains how to generate and maintain the OpenAPI 3.1.1 specification for the Helpmaton API.

## Overview

The OpenAPI specification is generated from JSDoc annotations in route handler files. The generation script scans both Express route files and simple Lambda handler files to extract API documentation.

## Generating the OpenAPI Spec

To generate the OpenAPI specification, run:

```bash
pnpm generate:openapi
```

This will:

1. Scan all route files in `apps/backend/src/http/**/routes/*.ts`
2. Scan all Express app files (`*-app.ts`)
3. Scan all simple handler files (`**/index.ts`)
4. Parse JSDoc `@openapi` annotations
5. Generate `apps/backend/openapi.json`

## Adding Annotations

### Express Routes

For Express routes defined in `routes/*.ts` files, add JSDoc annotations above the route registration function:

```typescript
/**
 * @openapi
 * /api/workspaces:
 *   get:
 *     summary: List all workspaces
 *     description: Returns all workspaces the authenticated user has access to
 *     tags:
 *       - Workspaces
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: List of workspaces
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WorkspacesResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const registerGetWorkspaces = (app: express.Application) => {
  app.get(
    "/api/workspaces",
    requireAuth,
    asyncHandler(async (req, res) => {
      // ... handler code
    })
  );
};
```

### Simple Handlers

For simple Lambda handlers (non-Express), add annotations above the handler function:

```typescript
/**
 * @openapi
 * /api/usage:
 *   get:
 *     summary: Get usage statistics
 *     description: Returns aggregated usage statistics
 *     tags:
 *       - Usage
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: currency
 *         in: query
 *         schema:
 *           type: string
 *           enum: [usd, eur, gbp]
 *     responses:
 *       200:
 *         description: Usage statistics
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UsageResponse'
 */
export const handler = adaptHttpHandler(
  handlingErrors(async (event: APIGatewayProxyEventV2) => {
    // ... handler code
  })
);
```

## Schema References

Reusable schemas are defined in `apps/backend/src/openapi/schemas.ts`. Reference them using:

```yaml
schema:
  $ref: "#/components/schemas/Workspace"
```

Common response types are defined in `apps/backend/src/openapi/config.ts` and can be referenced:

```yaml
responses:
  401:
    $ref: "#/components/responses/Unauthorized"
```

## Path Parameters

For routes with path parameters (e.g., `/api/workspaces/:workspaceId`), document them in the OpenAPI spec:

```yaml
/api/workspaces/{workspaceId}:
  get:
    parameters:
      - name: workspaceId
        in: path
        required: true
        description: Workspace ID
        schema:
          type: string
```

## Query Parameters

Document query parameters in the `parameters` section:

```yaml
parameters:
  - name: currency
    in: query
    description: Currency for cost calculations
    schema:
      type: string
      enum: [usd, eur, gbp]
      default: usd
```

## Request Bodies

For POST/PUT/PATCH requests, document the request body:

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        $ref: "#/components/schemas/CreateWorkspaceRequest"
```

## Security

Most endpoints require authentication. Use the `security` field:

```yaml
security:
  - cookieAuth: []
```

For API key authentication:

```yaml
security:
  - apiKeyAuth: []
```

## Tags

Group related endpoints using tags. Available tags are defined in `apps/backend/src/openapi/config.ts`:

- Workspaces
- Agents
- Documents
- Channels
- Email
- MCP Servers
- Subscription
- Auth
- Usage
- Webhooks
- Streams

## Adding New Schemas

To add a new reusable schema:

1. Add it to `apps/backend/src/openapi/schemas.ts`
2. Reference it in route annotations using `$ref: '#/components/schemas/YourSchema'`

Example:

```typescript
export const openApiSchemas = {
  // ... existing schemas
  YourNewSchema: {
    type: "object",
    required: ["field1"],
    properties: {
      field1: {
        type: "string",
        description: "Description of field1",
      },
      field2: {
        type: "integer",
        description: "Description of field2",
      },
    },
  },
};
```

## Validation

After generating the spec, you can validate it using tools like:

- [Swagger Editor](https://editor.swagger.io/)
- [Redoc](https://redocly.com/)
- OpenAPI CLI tools

## Integration with Documentation Tools

The generated `openapi.json` can be used with:

- **Swagger UI**: Interactive API documentation
- **Redoc**: Beautiful API documentation
- **Postman**: Import for API testing
- **OpenAPI Generator**: Generate client SDKs

## Best Practices

1. **Keep annotations up to date**: When modifying routes, update the annotations
2. **Use schema references**: Reuse schemas instead of duplicating definitions
3. **Document all parameters**: Include query, path, and header parameters
4. **Document error responses**: Include common error responses (400, 401, 403, 404, 500)
5. **Use descriptive summaries**: Clear summaries help API consumers understand endpoints
6. **Group with tags**: Use appropriate tags to organize endpoints

## Troubleshooting

### No paths found in generated spec

- Ensure route files have `@openapi` JSDoc annotations
- Check that annotations are properly formatted YAML
- Verify file paths are being scanned (check script output)

### Schema references not resolving

- Ensure schemas are defined in `schemas.ts`
- Check that `$ref` paths use correct format: `#/components/schemas/SchemaName`
- Verify schema names match exactly (case-sensitive)

### Import errors in generation script

- Ensure `swagger-jsdoc` is installed: `pnpm install`
- Check that TypeScript files can be parsed (may need tsx or ts-node)
