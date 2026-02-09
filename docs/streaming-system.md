# Streaming System

This document describes the streaming response system in Helpmaton, including the AI SDK streaming protocol, Lambda URL endpoints, and frontend integration.

## Overview

Helpmaton provides real-time streaming responses for agent interactions using the [AI SDK streaming protocol](https://sdk.vercel.ai/docs). Streaming responses are delivered via Lambda Function URLs, which bypass API Gateway for lower latency and better streaming performance.

## Architecture

### Lambda Function URLs

Streaming endpoints use AWS Lambda Function URLs instead of API Gateway:

- **Lower Latency**: Direct connection to Lambda, bypassing API Gateway
- **Better Streaming**: Native support for streaming responses
- **CORS Support**: Configurable CORS for cross-origin requests
- **Secret-Based Auth**: Simple secret-based authentication

### Endpoint Structure

```
POST /api/streams/:workspaceId/:agentId/:secret
```

**Path Parameters**:

- `workspaceId` (String): Workspace ID containing the agent
- `agentId` (String): Agent ID to send message to
- `secret` (String): Secret for authentication (configured per agent)

**Request Body**:

The request body should be a JSON array of messages in the AI SDK format (or plain text for simple requests):

```json
[
  {
    "role": "user",
    "content": "Hello, how can you help me?"
  }
]
```

For conversations with tool results, include tool result messages:

```json
[
  {
    "role": "user",
    "content": "Search for documents about weather"
  },
  {
    "role": "assistant",
    "content": "",
    "toolCalls": [
      {
        "toolCallId": "call_123",
        "toolName": "search_documents",
        "args": { "query": "weather" }
      }
    ]
  },
  {
    "role": "tool",
    "toolCallId": "call_123",
    "toolName": "search_documents",
    "result": "Document content..."
  }
]
```

**Headers**:

- `Content-Type: application/json` (required)
- `Origin` (optional): Origin for CORS validation

**Example**:

```bash
POST https://{lambda-url}/api/streams/ws_123/agent_456/secret_789
Content-Type: application/json

[
  {
    "role": "user",
    "content": "Hello"
  }
]
```

### Stream path variants

All stream paths use `POST` and the same request body (AI SDK message array). Authentication and use differ by path:

| Path | Auth | Use |
|------|------|-----|
| `POST /api/streams/:workspaceId/:agentId/:secret` | Secret (path segment) | Production streaming; secret from agent stream server config |
| `POST /api/streams/:workspaceId/:agentId/test` | Session/JWT | Test a specific agent in the UI |
| `POST /api/streams/:workspaceId/_workspace/test` | Session/JWT | Workspace assistant (virtual workspace agent) |
| `POST /api/streams/:workspaceId/:agentId/config/test` | Session/JWT | Meta-agent "Configure with AI" chat for that agent |

- **Secret path**: `:secret` is the stream server secret; no cookies/headers required.
- **Test paths**: Require authenticated session (cookie or `Authorization: Bearer`). Use the same base URL as the app (e.g. `https://app.helpmaton.com` or the Lambda stream URL from `GET /api/stream-url`).

## Getting the Streaming URL

### Endpoint

```
GET /api/stream-url
```

**Response**:

```json
{
  "url": "https://{lambda-url-id}.lambda-url.eu-west-2.on.aws"
}
```

The URL is retrieved from CloudFormation stack outputs or environment variables.

### Frontend Integration

The recommended way to integrate streaming is using the AI SDK's React hooks:

```typescript
import { useChat } from '@ai-sdk/react';

const { messages, append, isLoading } = useChat({
  api: `${streamUrl}/api/streams/${workspaceId}/${agentId}/${secret}`,
  body: {
    // Your request body with messages
  },
});
```

For manual integration, you can use `fetch` with a ReadableStream:

```typescript
// Get streaming URL
const response = await fetch("/api/stream-url");
const { url } = await response.json();

// Construct streaming endpoint
const streamUrl = `${url}/api/streams/${workspaceId}/${agentId}/${secret}`;

// Make POST request with messages
const streamResponse = await fetch(streamUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(messages),
});

// Read the stream
const reader = streamResponse.body?.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop() || ''; // Keep incomplete line
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const jsonStr = line.substring(6); // Remove "data: " prefix
      const data = JSON.parse(jsonStr);
      
      if (data.type === 'text-delta') {
        // Handle text chunk
        handleTextChunk(data.textDelta);
      } else if (data.type === 'tool-call') {
        // Handle tool call
        handleToolCall(data);
      } else if (data.type === 'error') {
        // Handle error
        handleError(data);
      } else if (data.type === 'done') {
        // Stream complete
        break;
      }
    }
  }
}
```

## Server-Sent Events (SSE) Format

### Content-Type

```
Content-Type: text/event-stream; charset=utf-8
```

### Protocol Format

Helpmaton uses **Server-Sent Events (SSE)** format compatible with the [AI SDK](https://sdk.vercel.ai/docs). The stream uses standard SSE format with JSON objects containing UI message data.

### Event Format

SSE events follow the standard format:

```
data: {json}\n\n
```

Each event is a JSON object serialized as a string, prefixed with `data: ` and terminated with `\n\n`.

### Message Types

#### Text Delta

Incremental text chunks as they're generated:

```
data: {"type":"text-delta","textDelta":"Hello"}\n\n
data: {"type":"text-delta","textDelta":" world"}\n\n
data: {"type":"text-delta","textDelta":"!"}\n\n
```

**Fields**:

- `type`: "text-delta"
- `textDelta`: Incremental text chunk

#### Text

Complete text message (alternative to text-delta):

```
data: {"type":"text","text":"Hello world!"}\n\n
```

**Fields**:

- `type`: "text"
- `text`: Complete text content

#### Tool Call

Tool call made by the agent:

```
data: {"type":"tool-call","toolCallId":"call_123","toolName":"search_documents","args":{"query":"weather"}}\n\n
```

**Fields**:

- `type`: "tool-call"
- `toolCallId`: Unique ID for the tool call
- `toolName`: Name of the tool
- `args`: Tool arguments (object)

#### Tool Result

Result from tool execution:

```
data: {"type":"tool-result","toolCallId":"call_123","toolName":"search_documents","result":"Document content..."}\n\n
```

**Fields**:

- `type`: "tool-result"
- `toolCallId`: ID of the tool call this result belongs to
- `toolName`: Name of the tool
- `result`: Tool execution result

#### Error

Error occurred during processing:

```
data: {"type":"error","error":"Insufficient credits","workspaceId":"ws_123","required":0.01,"available":0.005,"currency":"usd"}\n\n
```

**Fields**:

- `type`: "error"
- `error`: Error message
- Additional fields depend on error type (e.g., `workspaceId`, `required`, `available`, `currency` for credit errors)

#### Done

Stream completed successfully:

```
data: {"type":"done"}\n\n
```

**Fields**:

- `type`: "done"

### Protocol Summary

- **Format**: Standard SSE format with `data: {json}\n\n`
- **Content-Type**: `text/event-stream; charset=utf-8`
- **Compatibility**: Works with AI SDK's `useChat` hook and standard SSE clients

For complete protocol documentation and examples, see the [AI SDK documentation](https://sdk.vercel.ai/docs).

## Authentication

### Secret-Based Authentication

Streaming endpoints use secret-based authentication:

1. **Secret Generation**: Secrets are generated as UUIDs when stream servers are configured
2. **Secret Storage**: Secrets are stored in `agent-stream-servers` table, encrypted at rest
3. **Secret Validation**: Secrets are validated against the database on each request

### Secret Configuration

Secrets are configured per agent via the stream server configuration:

- Each agent can have one stream server configuration
- Secrets are generated automatically
- Secrets can be regenerated if compromised

### CORS Configuration

Streaming endpoints support configurable CORS:

- **Allowed Origins**: List of allowed origins or `["*"]` for wildcard
- **CORS Headers**: Automatically set based on request origin
- **Preflight Support**: OPTIONS requests are handled

## Request Processing Flow

```
Streaming request arrives
    │
    ▼
Validate secret
    │
    ├─ Query agent-stream-servers table
    ├─ Match secret value
    └─ Verify workspace/agent match
    │
    ├─ Invalid → 401 Unauthorized
    └─ Valid → Continue
    │
    ▼
Check CORS
    │
    ├─ Get allowed origins
    ├─ Validate request origin
    └─ Set CORS headers
    │
    ├─ Not allowed → 403 Forbidden
    └─ Allowed → Continue
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
    ├─ Insufficient → Stream error
    └─ OK → Continue
    │
    ▼
Start streaming response
    │
    ├─ Set SSE headers
    ├─ Write initial connection
    └─ Begin LLM stream
    │
    ▼
Stream LLM response
    │
    ├─ Read chunks from LLM API
    ├─ Write text-delta events
    ├─ Write tool-call events
    ├─ Write tool-result events
    └─ Stream until complete
    │
    ▼
Adjust credit reservation
    │
    ├─ Calculate actual cost
    ├─ Compare to reserved amount
    └─ Refund or charge difference
    │
    ▼
End stream
    │
    ├─ Write done event
    └─ Close connection
```

## Frontend Integration

### Using AI SDK React Hooks (Recommended)

The easiest way to integrate streaming is using the AI SDK's `useChat` hook, which automatically handles SSE parsing:

```typescript
import { useChat } from '@ai-sdk/react';

function ChatComponent({ workspaceId, agentId, secret, streamUrl }) {
  const { messages, append, isLoading } = useChat({
    api: `${streamUrl}/api/streams/${workspaceId}/${agentId}/${secret}`,
  });

  return (
    <div>
      {messages.map((msg) => (
        <div key={msg.id}>{msg.content}</div>
      ))}
      <button onClick={() => append({ role: 'user', content: 'Hello!' })}>
        Send
      </button>
    </div>
  );
}
```

See the [AI SDK useChat documentation](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat#usechat) for complete examples.

### Manual Integration Example

If you need to implement SSE parsing manually:

```typescript
async function streamAgentMessage(
  workspaceId: string,
  agentId: string,
  secret: string,
  userMessage: string
) {
  // Get streaming URL
  const urlResponse = await fetch("/api/stream-url");
  const { url } = await urlResponse.json();

  // Construct stream endpoint
  const streamUrl = `${url}/api/streams/${workspaceId}/${agentId}/${secret}`;

  // Make POST request with messages
  const response = await fetch(streamUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([
      { role: 'user', content: userMessage }
    ]),
  });

  if (!response.body) {
    throw new Error('No response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line

    for (const line of lines) {
      if (!line.trim()) continue;

      // Parse SSE format: data: {...}
      if (line.startsWith('data: ')) {
        const jsonStr = line.substring(6); // Remove "data: " prefix
        const data = JSON.parse(jsonStr);
        
        if (data.type === 'text-delta') {
          // Handle text chunk
          handleTextChunk(data.textDelta);
        } else if (data.type === 'text') {
          // Handle complete text
          handleText(data.text);
        } else if (data.type === 'tool-call') {
          // Handle tool call
          handleToolCall(data);
        } else if (data.type === 'error') {
          // Handle error
          console.error('Stream error:', data.error);
        } else if (data.type === 'done') {
          // Stream complete
          break;
        }
      }
    }
  }
}
```

For more examples and complete protocol details, see the [AI SDK documentation](https://sdk.vercel.ai/docs).

## Error Handling

### Error Messages

Errors are streamed as SSE events with error objects:

```
data: {"type":"error","error":"Insufficient credits","workspaceId":"ws_123","required":0.01,"available":0.005,"currency":"usd"}\n\n
```

When parsing, check the event type:

```typescript
if (line.startsWith('data: ')) {
  const jsonStr = line.substring(6); // Remove "data: " prefix
  const data = JSON.parse(jsonStr);
  
  if (data.type === 'error') {
    // Handle error
    console.error('Stream error:', data.error);
  }
}
```

### Common Errors

- **401 Unauthorized**: Invalid secret
- **403 Forbidden**: CORS origin not allowed
- **402 Payment Required**: Insufficient credits (streamed as error event)
- **429 Too Many Requests**: Rate limit exceeded
- **500 Internal Server Error**: Server error

### Error Recovery

- Errors are streamed as text messages in the AI SDK format
- Clients should parse messages and check for error objects
- Retry logic can be implemented by the client
- The stream connection remains open until explicitly closed or the stream ends

## CORS Configuration

### Allowed Origins

Stream servers can be configured with allowed origins:

- **Wildcard**: `["*"]` allows all origins
- **Specific Origins**: `["https://example.com", "https://app.example.com"]` allows only listed origins
- **No Configuration**: Defaults to allowing all origins (permissive)

### CORS Headers

Headers are automatically set based on configuration:

```
Access-Control-Allow-Origin: https://example.com
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, Origin, Accept
Access-Control-Allow-Credentials: true
```

### Preflight Requests

OPTIONS requests are handled automatically:

```
OPTIONS /api/streams/:workspaceId/:agentId/:secret
```

Returns appropriate CORS headers.

## Performance Considerations

### Latency

- **Lambda URLs**: Lower latency than API Gateway (direct connection)
- **Streaming**: Real-time response chunks (no buffering)
- **Connection**: Persistent connection for multiple chunks

### Bandwidth

- **Incremental Updates**: Only new text is sent (not full response)
- **Compression**: Consider enabling gzip compression
- **Connection Reuse**: EventSource maintains persistent connection

### Scalability

- **Concurrent Streams**: Lambda supports concurrent streaming connections
- **Resource Limits**: Monitor Lambda concurrency limits
- **Cost**: Pay per request and duration

## Security

### Secret Management

- **Generation**: Secrets are cryptographically secure UUIDs
- **Storage**: Encrypted at rest in DynamoDB
- **Rotation**: Secrets can be regenerated if compromised
- **Validation**: Secrets are validated on every request

### CORS Security

- **Origin Validation**: Only configured origins are allowed
- **No Wildcard in Production**: Avoid `["*"]` in production
- **Credential Support**: Credentials can be included if needed

### Rate Limiting

- **Subscription-Based**: Rate limits apply to streaming requests
- **Daily Limits**: Daily request limits are enforced
- **Throttling**: Excessive requests are throttled

## Comparison: Streaming vs Non-Streaming

### Streaming Endpoint

- **URL**: `/api/streams/:workspaceId/:agentId/:secret`
- **Method**: POST (request body contains messages array)
- **Response**: Server-Sent Events (SSE) format with `text/event-stream` content type
- **Latency**: Lower (Lambda URL)
- **User Experience**: Real-time incremental updates

### Non-Streaming Webhook

- **URL**: `/api/webhook/:workspaceId/:agentId/:key`
- **Method**: POST
- **Response**: JSON (complete response)
- **Latency**: Higher (API Gateway)
- **User Experience**: Wait for complete response

## Best Practices

### Frontend

1. **Use AI SDK Hooks**: Prefer `useChat` from `@ai-sdk/react` for React applications - it handles SSE parsing automatically
2. **Parse SSE Format**: When implementing manually, parse lines starting with `data: ` and extract JSON objects
3. **Error Handling**: Always check for `type: "error"` in parsed event objects
4. **Connection Management**: Close connections when done or on error
5. **Reconnection**: Implement reconnection logic for dropped connections
6. **UI Updates**: Update UI incrementally as text-delta events arrive

### Backend

1. **CORS Configuration**: Configure allowed origins properly
2. **Secret Rotation**: Rotate secrets periodically
3. **Error Streaming**: Stream errors as events, not HTTP errors
4. **Resource Cleanup**: Ensure proper cleanup on errors
5. **Monitoring**: Monitor stream performance and errors

## Troubleshooting

### Connection Issues

- **Check Secret**: Verify secret is correct
- **Check CORS**: Verify origin is in allowed list
- **Check URL**: Verify streaming URL is correct
- **Network**: Check network connectivity

### Streaming Issues

- **SSE Parsing**: Verify you're correctly parsing SSE format (lines starting with `data: `)
- **Message Handling**: Check that all event types (text-delta, tool-call, error, done) are handled
- **Connection State**: Monitor connection state and handle disconnections
- **Error Handling**: Parse error objects from SSE events correctly
- **AI SDK Integration**: If using AI SDK hooks, ensure the API endpoint is correctly configured

### Performance Issues

- **Latency**: Check Lambda region and configuration
- **Concurrency**: Monitor Lambda concurrency limits
- **Bandwidth**: Consider compression
- **Connection Reuse**: Reuse EventSource connections

## Additional Resources

- **[AI SDK Documentation](https://sdk.vercel.ai/docs)**: Complete protocol specification and examples
- **[AI SDK React Hooks](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat#usechat)**: React integration guide
- **[API Reference](./api-reference.md)**: Complete endpoint documentation
- **[Agent Configuration](./agent-configuration.md)**: How to configure stream servers for agents
