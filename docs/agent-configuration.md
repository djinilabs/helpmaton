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

## Webhooks

Each agent has one or more webhooks that can be used to send messages:

- Webhooks are created automatically when you generate a key
- Each webhook has a unique key that should be kept secure
- Webhooks can be deleted if compromised
- Use webhook URLs to send messages to agents

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

### Web Tools

Enable web tools to allow agents to search the web and extract content from URLs:

- **Web Search** (`search_web`): Search the web for current information, news, articles, and other web content. Available providers:
  - **Tavily**: $0.008 per call (first 10 calls/day free for paid tiers)
  - **Jina.ai**: Free (no credits charged, rate limits may apply)
- **Web Fetch** (`fetch_url`): Extract and summarize content from specific web page URLs. Available providers:
  - **Tavily**: $0.008 per call (first 10 calls/day free for paid tiers)
  - **Jina.ai**: Free (no credits charged, rate limits may apply)

**Daily Limits (Tavily only)**:
- Free tier: 10 calls per 24 hours
- Paid tiers: 10 free calls/day, then $0.008 per call (requires workspace credits)

**Note**: Jina.ai is free to use but may have rate limits. Tavily requires credits after the free tier limit.

### Exa.ai Search

Enable the `search` tool to allow agents to perform category-specific searches using Exa.ai:

- **Tool Name**: `search` (separate from `search_web`)
- **Categories**: Supports 9 search categories:
  - `company` - Search for company information
  - `research paper` - Search for academic research papers
  - `news` - Search for news articles
  - `pdf` - Search for PDF documents
  - `github` - Search for GitHub repositories
  - `tweet` - Search for tweets
  - `personal site` - Search personal websites
  - `people` - Search for people
  - `financial report` - Search for financial reports
- **Parameters**:
  - `category` (required): One of the 9 supported categories
  - `query` (required): Search query string
  - `num_results` (optional): Number of results to return (1-100, default: 10)
- **Pricing**: Variable based on number of results:
  - 1-25 results: $5 per 1,000 requests
  - 26-100 results: $25 per 1,000 requests
- **Note**: Pay-as-you-go pricing - all requests require credits (no free tier)

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
4. **Security**: Keep webhook keys secure and rotate them regularly
5. **Tool Selection**: Enable only the tools your agent needs to minimize costs and complexity

