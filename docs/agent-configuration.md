# Agent Configuration Guide

This guide covers how to configure and manage agents in Helpmaton.

## Creating an Agent

When creating a new agent, you'll need to provide:

- **Name**: A descriptive name for your agent
- **System Prompt**: Instructions that define how the agent behaves and responds

## System Prompts

The system prompt is crucial for agent behavior. It should include:

- The agent's role and purpose
- Guidelines for how to respond
- Any constraints or limitations
- Context about the workspace or domain

### Example System Prompt

```
You are a helpful customer support agent for a software company.
Your role is to:
- Answer customer questions politely and professionally
- Escalate technical issues to the engineering team
- Provide clear, concise responses
- Always maintain a friendly tone

If you don't know the answer, acknowledge it and offer to find out more information.
```

## Agent Keys

Each agent has one or more API keys that can be used to authenticate requests:

- Keys are generated automatically when created
- Each key is unique and should be kept secure
- Keys can be deleted if compromised
- Use keys in webhook URLs to send messages to agents

## Testing Agents

You can test your agents using:

- The test endpoint: `/api/workspaces/{workspaceId}/agents/{agentId}/test`
- Webhook endpoints: `/api/webhook/{workspaceId}/{agentId}/{key}`

## Stream Servers

Stream servers enable real-time streaming responses from your agent using Lambda Function URLs. This provides lower latency and better user experience compared to non-streaming webhooks.

### Configuration

To configure a stream server for an agent:

1. Navigate to the agent's detail page
2. Go to the "Stream Servers" section
3. Configure allowed CORS origins (or use `["*"]` for all origins)
4. Save the configuration to receive a secret

### Protocol

Stream servers use **Server-Sent Events (SSE)** format compatible with the [AI SDK](https://sdk.vercel.ai/docs):

- **Text chunks**: `data: {"type":"text-delta","textDelta":"Hello"}\n\n`
- **Tool calls**: `data: {"type":"tool-call","toolCallId":"...","toolName":"...","args":{...}}\n\n`

The stream is delivered over `text/event-stream` content type using standard SSE format.

### Integration

For React applications, use the `useChat` hook from `@ai-sdk/react`:

```typescript
import { useChat } from '@ai-sdk/react';

const { messages, append } = useChat({
  api: `${streamUrl}/api/streams/${workspaceId}/${agentId}/${secret}`,
});
```

For complete protocol documentation, examples, and integration guides, see the [Streaming System documentation](./streaming-system.md).

## Best Practices

1. **Clear Prompts**: Write specific, actionable system prompts
2. **Iterate**: Test and refine prompts based on agent responses
3. **Document Context**: Upload relevant documents to inform agent behavior
4. **Security**: Keep agent keys secure and rotate them regularly

