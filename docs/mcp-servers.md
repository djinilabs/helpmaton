# MCP Server Integration

This document explains how to configure and use MCP (Model Context Protocol) servers in Helpmaton to extend agent capabilities with external tools.

## Overview

MCP (Model Context Protocol) servers allow agents to call external services and tools. Helpmaton integrates with MCP servers by creating tools dynamically from server configurations, enabling agents to interact with external APIs and services.

## What are MCP Servers?

MCP servers are external services that expose tools and capabilities via the MCP protocol (JSON-RPC 2.0). Agents can call these tools to:

- Access external APIs
- Perform database queries
- Execute custom business logic
- Integrate with third-party services

## MCP Protocol

MCP uses JSON-RPC 2.0 for communication:

### Request Format

```json
{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "method": "method-name",
  "params": {
    "param1": "value1",
    "param2": "value2"
  }
}
```

### Response Format

```json
{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "result": {
    "data": "response data"
  }
}
```

### Error Format

```json
{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "error": {
    "code": -32603,
    "message": "Internal error",
    "data": "Error details"
  }
}
```

## Configuration

### Creating an MCP Server

**Endpoint**:

```
POST /api/workspaces/:workspaceId/mcp-servers
```

**Request Body**:

```json
{
  "name": "Weather API",
  "url": "https://api.weather.example.com/mcp",
  "authType": "header",
  "config": {
    "headerValue": "Bearer token_123"
  }
}
```

**Fields**:

- `name` (String, required): User-friendly name for the server
- `url` (String, required): MCP server URL (must be valid URL)
- `authType` (String, required): Authentication type ("none", "header", or "basic")
- `config` (Object, required): Authentication configuration

**Response**:

```json
{
  "id": "server_123",
  "name": "Weather API",
  "url": "https://api.weather.example.com/mcp",
  "authType": "header",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

### Authentication Types

#### None

No authentication required:

```json
{
  "authType": "none",
  "config": {}
}
```

#### Header

Custom header authentication:

```json
{
  "authType": "header",
  "config": {
    "headerValue": "Bearer token_123"
  }
}
```

The header value is sent as `Authorization` header in requests.

#### Basic

HTTP Basic Authentication:

```json
{
  "authType": "basic",
  "config": {
    "username": "user",
    "password": "pass"
  }
}
```

Credentials are sent as HTTP Basic Auth.

### Updating an MCP Server

**Endpoint**:

```
PUT /api/workspaces/:workspaceId/mcp-servers/:serverId
```

**Request Body**: Same as create, all fields optional

### Getting MCP Server

**Endpoint**:

```
GET /api/workspaces/:workspaceId/mcp-servers/:serverId
```

### Listing MCP Servers

**Endpoint**:

```
GET /api/workspaces/:workspaceId/mcp-servers
```

**Response**:

```json
[
  {
    "id": "server_123",
    "name": "Weather API",
    "url": "https://api.weather.example.com/mcp",
    "authType": "header",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```

### Deleting an MCP Server

**Endpoint**:

```
DELETE /api/workspaces/:workspaceId/mcp-servers/:serverId
```

## Enabling MCP Servers for Agents

MCP servers must be enabled for specific agents to be used:

### Agent Configuration

Agents have an `enabledMcpServerIds` field that lists enabled MCP server IDs:

```json
{
  "id": "agent_123",
  "name": "My Agent",
  "enabledMcpServerIds": ["server_123", "server_456"]
}
```

### Enabling Servers

**Endpoint**:

```
PUT /api/workspaces/:workspaceId/agents/:agentId
```

**Request Body**:

```json
{
  "enabledMcpServerIds": ["server_123", "server_456"]
}
```

## Tool Creation

When an agent with enabled MCP servers is called, tools are created dynamically:

### Tool Structure

Each MCP server creates a generic tool that can call any MCP method:

```typescript
{
  name: "mcp_{serverId}",
  description: "Call the MCP server '{serverName}'. Provide the MCP method name and optional parameters.",
  parameters: {
    method: {
      type: "string",
      description: "The MCP method to call"
    },
    params: {
      type: "object",
      description: "Optional parameters for the MCP method"
    }
  }
}
```

### Tool Execution

When the agent calls the tool:

1. Extract `method` and `params` from tool arguments
2. Build JSON-RPC 2.0 request
3. Send request to MCP server URL
4. Include authentication headers if configured
5. Parse JSON-RPC 2.0 response
6. Return result to agent

### Example Tool Call

Agent calls:

```json
{
  "toolName": "mcp_server_123",
  "args": {
    "method": "get_weather",
    "params": {
      "location": "London"
    }
  }
}
```

System sends to MCP server:

```json
{
  "jsonrpc": "2.0",
  "id": "1234567890-abc123",
  "method": "get_weather",
  "params": {
    "location": "London"
  }
}
```

## Error Handling

### MCP Server Errors

If the MCP server returns an error:

```json
{
  "jsonrpc": "2.0",
  "id": "1234567890-abc123",
  "error": {
    "code": -32603,
    "message": "Internal error",
    "data": "Location not found"
  }
}
```

The error is formatted and returned to the agent:

```
Error calling MCP server: Internal error - Location not found
```

### Network Errors

If the request fails (timeout, connection error, etc.):

```
Error calling MCP server: MCP server request failed: 500 Internal Server Error
```

### Validation Errors

If the server is not found or doesn't belong to the workspace:

```
Error: MCP server server_123 not found
```

or

```
Error: MCP server server_123 does not belong to this workspace
```

## Security

### Authentication

- **Config Storage**: Authentication config is encrypted at rest in DynamoDB
- **Header Values**: Header values are stored securely
- **Basic Auth**: Username and password are stored securely

### Validation

- **URL Validation**: URLs are validated to be valid HTTP/HTTPS URLs
- **Workspace Isolation**: MCP servers are isolated per workspace
- **Agent Validation**: Only enabled servers can be called by agents

### Timeout

- **Request Timeout**: 30 seconds per MCP request
- **Abort Signal**: Requests are aborted if timeout is exceeded

## Best Practices

### Server Design

1. **Clear Methods**: Use descriptive method names
2. **Parameter Validation**: Validate parameters on the server side
3. **Error Messages**: Provide clear error messages
4. **Response Format**: Return structured JSON responses

### Configuration

1. **HTTPS**: Use HTTPS for MCP server URLs
2. **Authentication**: Always use authentication (avoid "none" in production)
3. **Token Rotation**: Rotate authentication tokens regularly
4. **Naming**: Use descriptive names for easy identification

### Agent Configuration

1. **Selective Enablement**: Only enable servers that agents need
2. **Documentation**: Document which servers are used for what
3. **Testing**: Test MCP server integration before production use

## Example Use Cases

### Weather API

```json
{
  "name": "Weather API",
  "url": "https://api.weather.example.com/mcp",
  "authType": "header",
  "config": {
    "headerValue": "Bearer weather_api_key_123"
  }
}
```

Agent can call:

- `get_weather` - Get current weather
- `get_forecast` - Get weather forecast

### Database Query

```json
{
  "name": "Database API",
  "url": "https://db-api.example.com/mcp",
  "authType": "basic",
  "config": {
    "username": "db_user",
    "password": "db_pass"
  }
}
```

Agent can call:

- `query` - Execute database query
- `insert` - Insert data

### Custom Business Logic

```json
{
  "name": "Business Logic API",
  "url": "https://business.example.com/mcp",
  "authType": "header",
  "config": {
    "headerValue": "Bearer business_key_123"
  }
}
```

Agent can call:

- `process_order` - Process customer order
- `calculate_price` - Calculate product price

### Notion Integration

```json
{
  "name": "My Notion Workspace",
  "authType": "oauth",
  "serviceType": "notion",
  "config": {}
}
```

**Setup Requirements**:

1. Create a Notion Public Integration:
   - Go to [Notion Integrations](https://www.notion.com/my-integrations)
   - Click "+ New integration"
   - Select "Public" as the integration type
   - Provide your company name, website, and redirect URI: `{OAUTH_REDIRECT_BASE_URL}/api/mcp/oauth/notion/callback`
   - Copy the OAuth client ID and client secret from the "Secrets" tab

2. Configure Environment Variables:
   - Set `NOTION_OAUTH_CLIENT_ID` to your Notion OAuth client ID
   - Set `NOTION_OAUTH_CLIENT_SECRET` to your Notion OAuth client secret
   - Ensure `OAUTH_REDIRECT_BASE_URL` is set correctly

3. Connect Your Notion Account:
   - After creating the MCP server, click "Connect" to authorize the integration
   - Select which pages and databases to grant access to
   - The integration will have read, search, and write access to shared resources

**Available Tools**:

Once connected, agents can use the following Notion tools:

- `notion_read_{serverName}` - Read a page by ID, returns full page content and properties
- `notion_search_{serverName}` - Search for pages, databases, and data sources
- `notion_create_{serverName}` - Create a new page (as child of page, database, data source, or workspace)
- `notion_update_{serverName}` - Update page properties or archive a page
- `notion_query_database_{serverName}` - Query a database with filters and sorts
- `notion_create_database_page_{serverName}` - Create a new page in a database
- `notion_update_database_page_{serverName}` - Update a page in a database

**Important Notes**:

- Notion requires pages and databases to be explicitly shared with the integration
- The integration uses Notion API version `2025-09-03`
- Notion access tokens don't expire, but the integration handles token refresh for compatibility
- Database operations require properties to match the database schema
- Search can return pages, databases, and data sources (new in API 2025-09-03)

## Troubleshooting

### Server Not Found

- Verify server ID is correct
- Check server belongs to the workspace
- Ensure server is not deleted

### Authentication Errors

- Verify authentication type matches server configuration
- Check credentials are correct
- Verify header format (if using header auth)

### Connection Errors

- Check MCP server URL is accessible
- Verify network connectivity
- Check firewall rules

### Timeout Errors

- Increase timeout if needed (currently 30 seconds)
- Optimize MCP server response time
- Check server performance

### Tool Not Available

- Verify MCP server is enabled for the agent
- Check `enabledMcpServerIds` includes the server ID
- Verify agent configuration is saved

## API Reference

See [API Reference](./api-reference.md) for complete endpoint documentation.
