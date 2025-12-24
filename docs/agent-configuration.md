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

## Available Tools

Agents can be configured with various tools to extend their capabilities:

### Document Search

Enable the `search_documents` tool to allow agents to search workspace documents using semantic vector search.

### Memory Search

Enable the `search_memory` tool to allow agents to recall past conversations and information from their memory system.

### Email Sending

Enable the `send_email` tool to allow agents to send emails using the workspace email connection (requires email connection configuration).

### Tavily Tools

Enable Tavily tools to allow agents to search the web and extract content from URLs:

- **Tavily Search** (`tavily_search`): Search the web for current information, news, articles, and other web content
- **Tavily Fetch** (`tavily_fetch`): Extract and summarize content from specific web page URLs

**Daily Limits**:
- Free tier: 10 calls per 24 hours
- Paid tiers: 10 free calls/day, then $0.008 per call (requires workspace credits)

See [Tavily Integration](./tavily-integration.md) for detailed documentation.

### MCP Server Tools

Enable MCP (Model Context Protocol) servers to expose their tools to agents. Each enabled MCP server provides tools based on its configuration.

### Agent Delegation

Configure `delegatableAgentIds` to allow agents to delegate tasks to other agents in the workspace.

### Client-Side Tools

Define custom client-side tools that execute in the client application rather than on the server.

## Best Practices

1. **Clear Prompts**: Write specific, actionable system prompts
2. **Iterate**: Test and refine prompts based on agent responses
3. **Document Context**: Upload relevant documents to inform agent behavior
4. **Security**: Keep agent keys secure and rotate them regularly
5. **Tool Selection**: Enable only the tools your agent needs to minimize costs and complexity

