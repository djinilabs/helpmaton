# API Reference

This document provides comprehensive documentation for all Helpmaton API endpoints, including request/response formats, authentication requirements, and error codes.

## Base URL

- **Production**: `https://app.helpmaton.com`
- **Local Development**: `http://localhost:5173` (frontend proxy) or `http://localhost:3333` (direct backend)

## Bot Integrations

Bot integrations allow you to connect your agents to Slack or Discord bots. See [Slack Integration Guide](./slack-integration.md) and [Discord Integration Guide](./discord-integration.md) for setup instructions.

### List Integrations

**Endpoint**: `GET /api/workspaces/:workspaceId/integrations`

**Authentication**: Required (Bearer token or session cookie)

**Response**:
```json
[
  {
    "id": "integration-id",
    "platform": "slack",
    "name": "Support Bot",
    "agentId": "agent-id",
    "webhookUrl": "https://api.helpmaton.com/api/webhooks/slack/workspace-id/integration-id",
    "status": "active",
    "lastUsedAt": "2024-01-01T00:00:00.000Z",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

### Create Integration

**Endpoint**: `POST /api/workspaces/:workspaceId/integrations`

**Authentication**: Required (Bearer token or session cookie, WRITE permission)

**Request Body**:
```json
{
  "platform": "slack",
  "name": "Support Bot",
  "agentId": "agent-id",
  "config": {
    "botToken": "xoxb-...",
    "signingSecret": "..."
  }
}
```

**Response**: Returns the created integration (same format as list)

### Get Integration

**Endpoint**: `GET /api/workspaces/:workspaceId/integrations/:integrationId`

**Authentication**: Required (Bearer token or session cookie)

### Update Integration

**Endpoint**: `PATCH /api/workspaces/:workspaceId/integrations/:integrationId`

**Authentication**: Required (Bearer token or session cookie, WRITE permission)

**Request Body**:
```json
{
  "name": "Updated Name",
  "status": "inactive",
  "config": {
    "botToken": "new-token"
  }
}
```

### Delete Integration

**Endpoint**: `DELETE /api/workspaces/:workspaceId/integrations/:integrationId`

**Authentication**: Required (Bearer token or session cookie, WRITE permission)

### Generate Slack Manifest

**Endpoint**: `POST /api/workspaces/:workspaceId/integrations/slack/manifest`

**Authentication**: Required (Bearer token or session cookie, WRITE permission)

**Request Body**:
```json
{
  "agentId": "agent-id",
  "agentName": "Support Bot"
}
```

**Response**:
```json
{
  "manifest": { ... },
  "webhookUrl": "https://api.helpmaton.com/api/webhooks/slack/workspace-id/integration-id",
  "instructions": [ ... ]
}
```

## Authentication

Helpmaton supports multiple authentication methods:

### Session Cookies (Web UI)

For browser-based requests, use session cookies:

```bash
# Cookies are automatically sent with requests
curl -b cookies.txt https://app.helpmaton.com/api/workspaces
```

### Bearer Token (API)

For programmatic access, use JWT access tokens:

```bash
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \
  https://app.helpmaton.com/api/workspaces
```

### API Keys

User API keys can also be used as Bearer tokens:

```bash
curl -H "Authorization: Bearer hmat_abc123def456..." \
  https://app.helpmaton.com/api/workspaces
```

See [Authentication](./authentication.md) for detailed authentication documentation.

## Workspaces

### List Workspaces

**Endpoint**: `GET /api/workspaces`

**Authentication**: Required (Bearer token or session cookie)

**Description**: Returns all workspaces the authenticated user has access to.

**Response** (200 OK):

```json
[
  {
    "id": "ws_123",
    "name": "My Workspace",
    "description": "Workspace description",
    "creditBalance": 10.5,
    "currency": "usd",
    "subscriptionId": "sub_123",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```

### Get Workspace

**Endpoint**: `GET /api/workspaces/:workspaceId`

**Authentication**: Required (Bearer token or session cookie)

**Description**: Returns details for a specific workspace.

**Path Parameters**:

- `workspaceId` (String, required): Workspace ID

**Response** (200 OK):

```json
{
  "id": "ws_123",
  "name": "My Workspace",
  "description": "Workspace description",
  "creditBalance": 10.5,
  "currency": "usd",
  "subscriptionId": "sub_123",
  "spendingLimits": [
    {
      "timeFrame": "daily",
      "amount": 5.0
    }
  ],
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

**Errors**:

- `401 Unauthorized`: Not authenticated
- `403 Forbidden`: No access to workspace
- `404 Not Found`: Workspace not found

### Create Workspace

**Endpoint**: `POST /api/workspaces`

**Authentication**: Required (Bearer token or session cookie)

**Description**: Creates a new workspace.

**Request Body**:

```json
{
  "name": "My Workspace",
  "description": "Optional description"
}
```

**Response** (201 Created):

```json
{
  "id": "ws_123",
  "name": "My Workspace",
  "description": "Optional description",
  "creditBalance": 0,
  "currency": "usd",
  "subscriptionId": "sub_123",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

**Errors**:

- `400 Bad Request`: Invalid request body
- `401 Unauthorized`: Not authenticated
- `402 Payment Required`: Subscription limit exceeded

### Update Workspace

**Endpoint**: `PUT /api/workspaces/:workspaceId`

**Authentication**: Required (Bearer token or session cookie)

**Permission**: WRITE or higher

**Description**: Updates workspace details.

**Path Parameters**:

- `workspaceId` (String, required): Workspace ID

**Request Body**:

```json
{
  "name": "Updated Name",
  "description": "Updated description"
}
```

**Response** (200 OK):

```json
{
  "id": "ws_123",
  "name": "Updated Name",
  "description": "Updated description",
  "creditBalance": 10.5,
  "currency": "usd",
  "subscriptionId": "sub_123",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T01:00:00Z"
}
```

**Errors**:

- `400 Bad Request`: Invalid request body
- `401 Unauthorized`: Not authenticated
- `403 Forbidden`: Insufficient permissions
- `404 Not Found`: Workspace not found

### Delete Workspace

**Endpoint**: `DELETE /api/workspaces/:workspaceId`

**Authentication**: Required (Bearer token or session cookie)

**Permission**: OWNER

**Description**: Deletes a workspace and all its resources.

**Path Parameters**:

- `workspaceId` (String, required): Workspace ID

**Response** (204 No Content)

**Errors**:

- `401 Unauthorized`: Not authenticated
- `403 Forbidden`: Insufficient permissions (OWNER required)
- `404 Not Found`: Workspace not found

## Agents

### List Agents

```
GET /api/workspaces/:workspaceId/agents
```

Returns all agents in a workspace.

### Get Agent

```
GET /api/workspaces/:workspaceId/agents/:agentId
```

Returns details for a specific agent.

### Create Agent

```
POST /api/workspaces/:workspaceId/agents
Body: { name: string, systemPrompt: string }
```

Creates a new agent.

### Update Agent

```
PUT /api/workspaces/:workspaceId/agents/:agentId
Body: { name?: string, systemPrompt?: string }
```

Updates agent configuration.

### Delete Agent

```
DELETE /api/workspaces/:workspaceId/agents/:agentId
```

Deletes an agent.

## Webhooks

### List Webhooks

```
GET /api/workspaces/:workspaceId/agents/:agentId/keys
```

Returns all webhooks for an agent.

### Create Webhook

```
POST /api/workspaces/:workspaceId/agents/:agentId/keys
Body: { name?: string }
```

Creates a new webhook for an agent.

### Delete Webhook

```
DELETE /api/workspaces/:workspaceId/agents/:agentId/keys/:keyId
```

Deletes a webhook.

## Documents

### List Documents

```
GET /api/workspaces/:workspaceId/documents?folder=<folderPath>
```

Returns all documents in a workspace, optionally filtered by folder.

### List Folders

```
GET /api/workspaces/:workspaceId/documents/folders
```

Returns all unique folder paths in a workspace.

### Upload Documents

```
POST /api/workspaces/:workspaceId/documents
Content-Type: multipart/form-data
Body: files (File[]), folderPath (string?), textDocuments (JSON?)
```

Uploads one or more documents. Supports file uploads or text-based document creation.

### Get Document

```
GET /api/workspaces/:workspaceId/documents/:documentId
```

Returns document content and metadata.

### Update Document

```
PUT /api/workspaces/:workspaceId/documents/:documentId
Body: { content?: string, name?: string, folderPath?: string }
```

Updates document content, name, or location.

### Rename Document

```
PATCH /api/workspaces/:workspaceId/documents/:documentId/rename
Body: { name: string }
```

Renames a document (updates filename in S3).

### Delete Document

```
DELETE /api/workspaces/:workspaceId/documents/:documentId
```

Deletes a document.

## Webhooks

### Agent Webhook

```
POST /api/webhook/:workspaceId/:agentId/:key
```

Sends a message to an agent and receives a streaming response.

### Test Agent

```
POST /api/streams/:workspaceId/:agentId/test
```

Tests an agent with a message and receives a streaming response.

## Error Responses

All endpoints return standard HTTP status codes with JSON error responses.

### Status Codes

- `200 OK` - Success
- `201 Created` - Resource created successfully
- `204 No Content` - Success with no response body
- `400 Bad Request` - Invalid request format or parameters
- `401 Unauthorized` - Authentication required or invalid
- `402 Payment Required` - Insufficient credits or spending limit exceeded
- `403 Forbidden` - Insufficient permissions or access denied
- `404 Not Found` - Resource not found
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error

### Error Response Format

```json
{
  "error": "Error message",
  "message": "Detailed error message",
  "code": "ERROR_CODE"
}
```

### Common Error Codes

**Authentication Errors**:

- `UNAUTHORIZED`: Not authenticated or invalid token
- `INVALID_TOKEN`: Token is invalid or expired
- `INVALID_API_KEY`: API key is invalid

**Permission Errors**:

- `FORBIDDEN`: Insufficient permissions
- `WORKSPACE_ACCESS_DENIED`: No access to workspace

**Business Logic Errors**:

- `INSUFFICIENT_CREDITS`: Credit balance insufficient
- `SPENDING_LIMIT_EXCEEDED`: Spending limit exceeded
- `SUBSCRIPTION_LIMIT_EXCEEDED`: Subscription limit exceeded
- `FREE_PLAN_EXPIRED`: Free plan has expired

**Validation Errors**:

- `INVALID_REQUEST`: Request format is invalid
- `MISSING_REQUIRED_FIELD`: Required field is missing
- `INVALID_VALUE`: Field value is invalid

### Rate Limiting

When rate limits are exceeded, a `429 Too Many Requests` response is returned:

```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Please try again later."
}
```

**Headers**:

- `Retry-After`: Seconds to wait before retrying
- `X-RateLimit-Limit`: Maximum requests per period
- `X-RateLimit-Remaining`: Remaining requests in period
- `X-RateLimit-Reset`: Timestamp when limit resets

See [API Throttling](./api-throttling.md) for detailed rate limiting information.

## Rate Limiting

All API endpoints are subject to rate limiting based on subscription plans:

- **Free**: 100 requests/second, 200 burst
- **Starter**: 500 requests/second, 1000 burst
- **Pro**: 2000 requests/second, 4000 burst

Rate limits apply to all `/api/*` routes except `/api/auth/*` and `/api/authorizer`.

## Additional Resources

- [Webhook System](./webhook-system.md) - Webhook endpoint details
- [Streaming System](./streaming-system.md) - Streaming endpoint details
- [Authentication](./authentication.md) - Authentication methods
- [Credit System](./credit-system.md) - Credit management
- [Subscription Management](./subscription-management.md) - Subscription plans

## OpenAPI Specification

Complete OpenAPI 3.1 specification is available at:

- `apps/backend/openapi.json`
- `apps/frontend/public/openapi.json`

You can use this specification to:

- Generate client libraries
- Explore endpoints in Swagger UI
- Validate requests/responses
