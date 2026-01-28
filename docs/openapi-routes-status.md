# OpenAPI Documentation Status for /api/workspaces Routes

## Summary

**Total Routes**: 72  
**Documented**: 3  
**Missing Documentation**: 69

## Documented Routes ✅

1. **GET /api/workspaces** - List all workspaces
2. **POST /api/workspaces** - Create a new workspace
3. **POST /api/workspaces/{workspaceId}/agents/generate-prompt** - Generate system prompt for an agent

## Missing Documentation Routes ❌

### Workspace Management

- **GET /api/workspaces/{workspaceId}** - Get workspace by ID
- **PUT /api/workspaces/{workspaceId}** - Update workspace
- **DELETE /api/workspaces/{workspaceId}** - Delete workspace

### Workspace Members

- **GET /api/workspaces/{workspaceId}/members** - List workspace members
- **POST /api/workspaces/{workspaceId}/members** - Add workspace member
- **PUT /api/workspaces/{workspaceId}/members/{userId}** - Update workspace member
- **DELETE /api/workspaces/{workspaceId}/members/{userId}** - Remove workspace member
- **GET /api/workspaces/{workspaceId}/user-limit** - Get workspace user limit

### Workspace Invites

- **POST /api/workspaces/{workspaceId}/members/invite** - Create workspace invite
- **GET /api/workspaces/{workspaceId}/invites** - List workspace invites
- **GET /api/workspaces/{workspaceId}/invites/{token}** - Get workspace invite
- **POST /api/workspaces/{workspaceId}/invites/{token}/accept** - Accept workspace invite
- **DELETE /api/workspaces/{workspaceId}/invites/{inviteId}** - Delete workspace invite

### Workspace Spending Limits

- **POST /api/workspaces/{workspaceId}/spending-limits** - Create workspace spending limit
- **PUT /api/workspaces/{workspaceId}/spending-limits/{timeFrame}** - Update workspace spending limit
- **DELETE /api/workspaces/{workspaceId}/spending-limits/{timeFrame}** - Delete workspace spending limit

### Workspace API Keys

- **GET /api/workspaces/{workspaceId}/api-key** - Get workspace API key
- **PUT /api/workspaces/{workspaceId}/api-key** - Update workspace API key
- **DELETE /api/workspaces/{workspaceId}/api-key** - Delete workspace API key

### Agents

- **GET /api/workspaces/{workspaceId}/agents** - List workspace agents
- **POST /api/workspaces/{workspaceId}/agents** - Create workspace agent
- **GET /api/workspaces/{workspaceId}/agents/{agentId}** - Get workspace agent
- **PUT /api/workspaces/{workspaceId}/agents/{agentId}** - Update workspace agent
- **DELETE /api/workspaces/{workspaceId}/agents/{agentId}** - Delete workspace agent

### Webhooks

- **GET /api/workspaces/{workspaceId}/agents/{agentId}/keys** - List webhooks
- **POST /api/workspaces/{workspaceId}/agents/{agentId}/keys** - Create webhook
- **DELETE /api/workspaces/{workspaceId}/agents/{agentId}/keys/{keyId}** - Delete webhook

### Agent Spending Limits

- **POST /api/workspaces/{workspaceId}/agents/{agentId}/spending-limits** - Create agent spending limit
- **PUT /api/workspaces/{workspaceId}/agents/{agentId}/spending-limits/{timeFrame}** - Update agent spending limit
- **DELETE /api/workspaces/{workspaceId}/agents/{agentId}/spending-limits/{timeFrame}** - Delete agent spending limit

### Agent Conversations

- **GET /api/workspaces/{workspaceId}/agents/{agentId}/conversations** - List agent conversations
- **GET /api/workspaces/{workspaceId}/agents/{agentId}/conversations/{conversationId}** - Get agent conversation

### Agent Usage

- **GET /api/workspaces/{workspaceId}/agents/{agentId}/usage** - Get agent usage statistics
- **GET /api/workspaces/{workspaceId}/agents/{agentId}/usage/daily** - Get agent daily usage statistics

### Agent Stream Servers

- **GET /api/workspaces/{workspaceId}/agents/{agentId}/stream-servers** - Get agent stream servers
- **POST /api/workspaces/{workspaceId}/agents/{agentId}/stream-servers** - Create agent stream servers
- **PUT /api/workspaces/{workspaceId}/agents/{agentId}/stream-servers** - Update agent stream servers
- **DELETE /api/workspaces/{workspaceId}/agents/{agentId}/stream-servers** - Delete agent stream servers

### Documents

- **GET /api/workspaces/{workspaceId}/documents** - List workspace documents
- **POST /api/workspaces/{workspaceId}/documents** - Upload/create workspace documents
- **GET /api/workspaces/{workspaceId}/documents/folders** - List document folders
- **GET /api/workspaces/{workspaceId}/documents/{documentId}** - Get workspace document
- **PUT /api/workspaces/{workspaceId}/documents/{documentId}** - Update workspace document
- **PATCH /api/workspaces/{workspaceId}/documents/{documentId}/rename** - Rename workspace document
- **DELETE /api/workspaces/{workspaceId}/documents/{documentId}** - Delete workspace document

### Channels

- **GET /api/workspaces/{workspaceId}/channels** - List workspace channels
- **POST /api/workspaces/{workspaceId}/channels** - Create workspace channel
- **GET /api/workspaces/{workspaceId}/channels/{channelId}** - Get workspace channel
- **PUT /api/workspaces/{workspaceId}/channels/{channelId}** - Update workspace channel
- **DELETE /api/workspaces/{workspaceId}/channels/{channelId}** - Delete workspace channel
- **POST /api/workspaces/{workspaceId}/channels/{channelId}/test** - Test workspace channel

### Email Connections

- **GET /api/workspaces/{workspaceId}/email-connection** - Get workspace email connection
- **POST /api/workspaces/{workspaceId}/email-connection** - Create workspace email connection
- **PUT /api/workspaces/{workspaceId}/email-connection** - Update workspace email connection
- **DELETE /api/workspaces/{workspaceId}/email-connection** - Delete workspace email connection
- **POST /api/workspaces/{workspaceId}/email-connection/test** - Test workspace email connection
- **GET /api/workspaces/{workspaceId}/email/oauth/{provider}/authorize** - Get email OAuth authorization URL

### MCP Servers

- **GET /api/workspaces/{workspaceId}/mcp-servers** - List workspace MCP servers
- **POST /api/workspaces/{workspaceId}/mcp-servers** - Create workspace MCP server
- **GET /api/workspaces/{workspaceId}/mcp-servers/{serverId}** - Get workspace MCP server
- **PUT /api/workspaces/{workspaceId}/mcp-servers/{serverId}** - Update workspace MCP server
- **DELETE /api/workspaces/{workspaceId}/mcp-servers/{serverId}** - Delete workspace MCP server

### Workspace Usage

- **GET /api/workspaces/{workspaceId}/usage** - Get workspace usage statistics
- **GET /api/workspaces/{workspaceId}/usage/daily** - Get workspace daily usage statistics

### Trial & Testing

- **POST /api/workspaces/{workspaceId}/trial-credit-request** - Request trial credit
- **GET /api/workspaces/{workspaceId}/trial-status** - Get trial status
- **POST /api/streams/{workspaceId}/{agentId}/test** - Test agent

### Other Routes

- **GET /api/email/oauth/{provider}/callback** - Email OAuth callback (workspace-agnostic)

## Next Steps

To complete the OpenAPI documentation:

1. Add `@openapi` JSDoc annotations to each route handler file
2. Define request/response schemas in `apps/backend/src/openapi/schemas.ts` as needed
3. Run `pnpm generate:openapi` to regenerate the spec
4. Verify each route matches the actual implementation

See `docs/openapi-generation.md` for instructions on adding annotations.
