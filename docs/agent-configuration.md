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

## Best Practices

1. **Clear Prompts**: Write specific, actionable system prompts
2. **Iterate**: Test and refine prompts based on agent responses
3. **Document Context**: Upload relevant documents to inform agent behavior
4. **Security**: Keep agent keys secure and rotate them regularly

