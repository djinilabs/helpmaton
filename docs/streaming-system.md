# Streaming System

This document describes the streaming response system in Helpmaton, including Server-Sent Events (SSE) format, Lambda URL endpoints, and frontend integration.

## Overview

Helpmaton provides real-time streaming responses for agent interactions using Server-Sent Events (SSE). Streaming responses are delivered via Lambda Function URLs, which bypass API Gateway for lower latency and better streaming performance.

## Architecture

### Lambda Function URLs

Streaming endpoints use AWS Lambda Function URLs instead of API Gateway:

- **Lower Latency**: Direct connection to Lambda, bypassing API Gateway
- **Better Streaming**: Native support for streaming responses
- **CORS Support**: Configurable CORS for cross-origin requests
- **Secret-Based Auth**: Simple secret-based authentication

### Endpoint Structure

```
GET /api/streams/:workspaceId/:agentId/:secret
```

**Path Parameters**:

- `workspaceId` (String): Workspace ID containing the agent
- `agentId` (String): Agent ID to send message to
- `secret` (String): Secret for authentication (configured per agent)

**Query Parameters**:

- `message` (String, required): Message to send to the agent
- `origin` (String, optional): Origin for CORS validation

**Example**:

```
GET https://{lambda-url}/api/streams/ws_123/agent_456/secret_789?message=Hello
```

## Getting the Streaming URL

### Endpoint

```
GET /api/streams/url
```

**Response**:

```json
{
  "url": "https://{lambda-url-id}.lambda-url.eu-west-2.on.aws"
}
```

The URL is retrieved from CloudFormation stack outputs or environment variables.

### Frontend Integration

```typescript
// Get streaming URL
const response = await fetch("/api/streams/url");
const { url } = await response.json();

// Construct streaming endpoint
const streamUrl = `${url}/api/streams/${workspaceId}/${agentId}/${secret}?message=${encodeURIComponent(
  message
)}`;

// Open EventSource connection
const eventSource = new EventSource(streamUrl);
```

## Server-Sent Events (SSE) Format

### Content-Type

```
Content-Type: text/event-stream; charset=utf-8
```

### Event Format

SSE events follow the standard format:

```
data: {json}\n\n
```

Each event is a JSON object serialized as a string.

### Event Types

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
- Additional fields depend on error type

#### Done

Stream completed successfully:

```
data: {"type":"done"}\n\n
```

**Fields**:

- `type`: "done"

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

### EventSource API

The standard EventSource API is used for receiving SSE streams:

```typescript
const eventSource = new EventSource(streamUrl);

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case "text-delta":
      // Append text chunk
      appendText(data.textDelta);
      break;
    case "tool-call":
      // Handle tool call
      handleToolCall(data);
      break;
    case "tool-result":
      // Handle tool result
      handleToolResult(data);
      break;
    case "error":
      // Handle error
      handleError(data);
      break;
    case "done":
      // Stream complete
      eventSource.close();
      break;
  }
};

eventSource.onerror = (error) => {
  console.error("Stream error:", error);
  eventSource.close();
};
```

### React Hook Example

```typescript
function useAgentStream(workspaceId: string, agentId: string, secret: string) {
  const [message, setMessage] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamMessage = async (userMessage: string) => {
    setIsStreaming(true);
    setError(null);
    setMessage("");

    try {
      // Get streaming URL
      const urlResponse = await fetch("/api/streams/url");
      const { url } = await urlResponse.json();

      // Construct stream URL
      const streamUrl = `${url}/api/streams/${workspaceId}/${agentId}/${secret}?message=${encodeURIComponent(
        userMessage
      )}`;

      // Open EventSource
      const eventSource = new EventSource(streamUrl);

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "text-delta") {
          setMessage((prev) => prev + data.textDelta);
        } else if (data.type === "error") {
          setError(data.error);
          eventSource.close();
        } else if (data.type === "done") {
          eventSource.close();
          setIsStreaming(false);
        }
      };

      eventSource.onerror = () => {
        setError("Stream connection error");
        eventSource.close();
        setIsStreaming(false);
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setIsStreaming(false);
    }
  };

  return { message, isStreaming, error, streamMessage };
}
```

## Error Handling

### Error Events

Errors are streamed as SSE events:

```json
{
  "type": "error",
  "error": "Error message",
  "workspaceId": "ws_123",
  "required": 0.01,
  "available": 0.005,
  "currency": "usd"
}
```

### Common Errors

- **401 Unauthorized**: Invalid secret
- **403 Forbidden**: CORS origin not allowed
- **402 Payment Required**: Insufficient credits (streamed as error event)
- **429 Too Many Requests**: Rate limit exceeded
- **500 Internal Server Error**: Server error

### Error Recovery

- Errors are streamed as events, not HTTP status codes
- Clients should handle error events and close the connection
- Retry logic can be implemented by the client

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
- **Method**: GET
- **Response**: Server-Sent Events (SSE)
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

1. **Handle All Event Types**: Implement handlers for all event types
2. **Error Handling**: Always handle error events
3. **Connection Management**: Close connections when done
4. **Reconnection**: Implement reconnection logic for dropped connections
5. **UI Updates**: Update UI incrementally as chunks arrive

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

- **Event Parsing**: Verify JSON parsing is correct
- **Event Handling**: Check all event types are handled
- **Connection State**: Monitor connection state
- **Error Events**: Handle error events properly

### Performance Issues

- **Latency**: Check Lambda region and configuration
- **Concurrency**: Monitor Lambda concurrency limits
- **Bandwidth**: Consider compression
- **Connection Reuse**: Reuse EventSource connections

## API Reference

See [API Reference](./api-reference.md) for complete endpoint documentation.
