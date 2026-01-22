# Webhook System

This document describes the webhook system in Helpmaton, including endpoint structure, authentication, request/response formats, and error handling.

## Overview

Webhooks allow external applications to send messages to Helpmaton agents. Each agent has one or more API keys that authenticate webhook requests. Requests are processed asynchronously, so the HTTP response acknowledges receipt and includes a conversation ID for tracking.

## Endpoint Structure

### Webhook URL Format

```
POST /api/webhook/:workspaceId/:agentId/:key
```

**Path Parameters**:

- `workspaceId` (String): Workspace ID containing the agent
- `agentId` (String): Agent ID to send message to
- `key` (String): Agent API key for authentication

**Example**:

```
POST https://app.helpmaton.com/api/webhook/ws_123/agent_456/key_789
```

## Authentication

### Webhooks

Each agent can have multiple webhooks for sending messages:

- Webhook keys are generated as UUIDs when created
- Keys are stored in the `agent-key` table, encrypted at rest
- Webhooks can be named for easy identification
- Webhooks can be deleted if compromised

### Key Validation

When a webhook request arrives:

1. Extract `workspaceId`, `agentId`, and `key` from path parameters
2. Query `agent-key` table using GSI `byAgentId`
3. Find matching key where:
   - `agentId` matches
   - `key` value matches
   - `workspaceId` matches
4. If no match found, return `401 Unauthorized`

### Key Management

**Create Webhook**:

```
POST /api/workspaces/:workspaceId/agents/:agentId/keys
Body: { name?: string, provider?: "google" }
```

**List Webhooks**:

```
GET /api/workspaces/:workspaceId/agents/:agentId/keys
```

**Delete Webhook**:

```
DELETE /api/workspaces/:workspaceId/agents/:agentId/keys/:keyId
```

## Request Format

### HTTP Method

- **Method**: `POST`
- **Content-Type**: `text/plain` or `application/json`

### Request Body

The request body contains the message to send to the agent:

**Plain Text**:

```
Hello, how can you help me?
```

**JSON** (optional):

```json
{
  "message": "Hello, how can you help me?"
}
```

The webhook handler accepts both formats:

- Plain text is used directly as the message
- JSON is parsed and the `message` field is extracted

### Request Headers

Standard HTTP headers are accepted:

- `Content-Type`: `text/plain` or `application/json`
- `User-Agent`: Client identifier (optional)
- `X-Request-ID`: Request tracking ID (optional)

## Response Format

### Success Response

**Status Code**: `202 Accepted`

**Response Body**:

```json
{
  "conversationId": "conv_123"
}
```

**Fields**:

- `conversationId` (String): Unique conversation ID for tracking

**Notes**:

- Webhook processing is asynchronous. The HTTP response does not include the assistant response.
- There is currently no webhook status polling endpoint. Use the conversation ID for internal tracking/support, or check the workspace conversations in the UI.

### Tool Calls

Tool calls and results are recorded in the conversation log after processing completes.

### Error Responses

**400 Bad Request**:

```json
{
  "error": "Invalid request format"
}
```

**401 Unauthorized**:

```json
{
  "error": "Invalid webhook key"
}
```

**403 Forbidden**:

```json
{
  "error": "Free plan has expired. Please upgrade your subscription."
}
```

**429 Too Many Requests**:

```json
{
  "error": "Rate limit exceeded"
}
```

**Credit/Spending Errors**:

If the workspace lacks sufficient credits or exceeds spending limits, the webhook task fails during async processing. These errors are recorded in the conversation log and surfaced in the UI, but are not returned in the initial HTTP response.

**500 Internal Server Error**:

```json
{
  "error": "Internal server error"
}
```

## Request Processing Flow

```
Webhook request arrives
    │
    ▼
Validate request format
    │
    ├─ Extract path parameters
    ├─ Validate HTTP method (POST)
    └─ Extract body text
    │
    ▼
Validate webhook key
    │
    ├─ Query agent-key table
    ├─ Match key value
    └─ Verify workspace/agent match
    │
    ├─ Invalid → 401 Unauthorized
    └─ Valid → Continue
    │
    ▼
Check subscription limits
    │
    ├─ Check free plan expiration
    ├─ Check daily request limit
    └─ Verify subscription active
    │
    ├─ Expired/Limited → Error
    └─ OK → Continue
    │
    ▼
Setup agent and tools
    │
    ├─ Load agent configuration
    ├─ Load workspace documents
    ├─ Setup MCP server tools
    └─ Configure model options
    │
    ▼
Validate credits and limits
    │
    ├─ Estimate token cost
    ├─ Check credit balance
    ├─ Check spending limits
    └─ Reserve credits (atomic)
    │
    ├─ Insufficient → 402 Payment Required
    └─ OK → Continue
    │
    ▼
Call LLM API
    │
    ├─ Generate response
    ├─ Execute tool calls (if any)
    └─ Get token usage
    │
    ▼
Adjust credit reservation
    │
    ├─ Calculate actual cost
    ├─ Compare to reserved amount
    └─ Refund or charge difference
    │
    ▼
Log conversation
    │
    ├─ Create conversation record
    ├─ Store messages
    └─ Track token usage
    │
    ▼
Return response
    │
    └─ Format JSON response
```

## Bot Integrations (Slack & Discord)

Helpmaton supports connecting agents to Slack and Discord bots, allowing team members and community members to interact with your agents directly in those platforms.

### Slack Integration

Slack bots can be connected to agents using the Slack App Manifest method. The integration handles:
- Event subscriptions (app_mentions, messages)
- Signature verification using signing secrets
- Throttled message updates (1.5s interval) to simulate streaming
- Markdown to Slack formatting conversion

For detailed setup instructions, see [Slack Integration Guide](../docs/slack-integration.md).

### Discord Integration

Discord bots can be connected to agents using the Interactions Endpoint method. The integration handles:
- Interaction events (slash commands, mentions)
- Ed25519 signature verification using public keys
- Throttled message updates (1.5s interval) to simulate streaming
- Markdown to Discord formatting conversion

For detailed setup instructions, see [Discord Integration Guide](../docs/discord-integration.md).

### Integration Management

Integrations are managed through the REST API:

- `POST /api/workspaces/:workspaceId/integrations` - Create integration
- `GET /api/workspaces/:workspaceId/integrations` - List integrations
- `GET /api/workspaces/:workspaceId/integrations/:integrationId` - Get integration
- `PATCH /api/workspaces/:workspaceId/integrations/:integrationId` - Update integration
- `DELETE /api/workspaces/:workspaceId/integrations/:integrationId` - Delete integration
- `POST /api/workspaces/:workspaceId/integrations/slack/manifest` - Generate Slack manifest

All integration credentials (bot tokens, signing secrets, public keys) are encrypted at rest in the `bot-integration` table.

## Rate Limiting

Webhook requests are subject to rate limiting based on subscription plan:

- **Free**: 100 requests/second, 200 burst
- **Starter**: 500 requests/second, 1000 burst
- **Pro**: 2000 requests/second, 4000 burst

Rate limiting is enforced at the API Gateway level using usage plans. See [API Throttling](./api-throttling.md) for details.

## Daily Request Limits

In addition to rate limiting, there are daily request limits per subscription:

- Limits are checked before each LLM call
- Limits are tracked in hourly buckets
- Exceeding the limit returns `429 Too Many Requests`

## Credit Management

Each webhook request:

1. Estimates token cost before the LLM call
2. Atomically reserves credits
3. Makes the LLM API call
4. Adjusts credits based on actual usage

See [Credit System](./credit-system.md) for detailed information.

## Conversation Tracking

Webhook requests create conversation records in the `agent-conversations` table:

- `conversationId`: Unique ID for tracking
- `conversationType`: "webhook"
- `messages`: Array of all messages
- `toolCalls`: Array of tool calls
- `toolResults`: Array of tool results
- `tokenUsage`: Aggregated token usage
- `cost`: Cost in USD

Conversations expire after a TTL period (automatic cleanup).

## Tool Support

Webhooks support the same tools as other agent endpoints:

- **Document Search**: Search workspace documents using semantic search
- **MCP Server Tools**: Tools created from configured MCP servers
- **Agent Delegation**: Agents can call other agents (if configured)
- **Client Tools**: User-defined client-side tools

Tool calls are included in the response for transparency.

## Error Handling

### Validation Errors

- **Invalid path parameters**: `400 Bad Request`
- **Invalid HTTP method**: `400 Bad Request`
- **Invalid request body**: `400 Bad Request`

### Authentication Errors

- **Invalid webhook key**: `401 Unauthorized`
- **Key not found**: `401 Unauthorized`
- **Workspace/agent mismatch**: `401 Unauthorized`

### Business Logic Errors

- **Insufficient credits**: `402 Payment Required`
- **Free plan expired**: `403 Forbidden`
- **Rate limit exceeded**: `429 Too Many Requests`
- **Daily limit exceeded**: `429 Too Many Requests`
- **Spending limit exceeded**: `402 Payment Required`

### Server Errors

- **LLM API error**: `500 Internal Server Error`
- **Database error**: `500 Internal Server Error`
- **Unexpected error**: `500 Internal Server Error`

## Best Practices

### Security

1. **Keep keys secret**: Never commit keys to version control
2. **Rotate keys regularly**: Delete and recreate keys periodically
3. **Use HTTPS**: Always use HTTPS for webhook requests
4. **Validate responses**: Verify response format and content

### Performance

1. **Handle timeouts**: Webhook requests have a 60-second timeout
2. **Retry logic**: Implement exponential backoff for retries
3. **Rate limiting**: Respect rate limits and handle 429 responses
4. **Async processing**: Consider streaming endpoints for long responses

### Error Handling

1. **Check status codes**: Handle all HTTP status codes
2. **Parse error messages**: Extract error details from responses
3. **Log requests**: Log webhook requests for debugging
4. **Monitor usage**: Track credit consumption and costs

## Example Usage

### cURL

```bash
curl -X POST \
  https://app.helpmaton.com/api/webhook/ws_123/agent_456/key_789 \
  -H "Content-Type: text/plain" \
  -d "What is the weather today?"
```

### JavaScript (Fetch API)

```javascript
async function sendWebhook(workspaceId, agentId, key, message) {
  const response = await fetch(
    `https://app.helpmaton.com/api/webhook/${workspaceId}/${agentId}/${key}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
      },
      body: message,
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Webhook request failed");
  }

  return await response.json();
}

// Usage
const result = await sendWebhook(
  "ws_123",
  "agent_456",
  "key_789",
  "What is the weather today?"
);
console.log(result.response);
```

### Python (requests)

```python
import requests

def send_webhook(workspace_id, agent_id, key, message):
    url = f"https://app.helpmaton.com/api/webhook/{workspace_id}/{agent_id}/{key}"
    response = requests.post(
        url,
        headers={"Content-Type": "text/plain"},
        data=message
    )
    response.raise_for_status()
    return response.json()

# Usage
result = send_webhook(
    "ws_123",
    "agent_456",
    "key_789",
    "What is the weather today?"
)
print(result["response"])
```

## Streaming Alternative

For real-time streaming responses, use the streaming endpoint:

```
GET /api/streams/:workspaceId/:agentId/:secret
```

See [Streaming System](./streaming-system.md) for details.

## Troubleshooting

### 401 Unauthorized

- Verify the webhook key is correct
- Check that the key belongs to the specified agent
- Ensure the workspace ID matches

### 402 Payment Required

- Check workspace credit balance
- Verify spending limits are not exceeded
- Add credits to the workspace

### 429 Too Many Requests

- Reduce request frequency
- Implement exponential backoff
- Upgrade subscription plan for higher limits

### 500 Internal Server Error

- Check agent configuration
- Verify LLM API key is valid
- Review error logs for details

## API Reference

See [API Reference](./api-reference.md) for complete endpoint documentation.
