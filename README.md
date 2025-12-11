<div align="center" style="background-color: white; padding: 20px; display: inline-block; border-radius: 8px;">
  <img src="apps/frontend/public/images/helpmaton_logo.svg" alt="Helpmaton Logo" width="200">
</div>

# Helpmaton

**Deploy and manage AI agents with ease**

Helpmaton is a workspace-based platform that empowers you to create, configure, and deploy AI agents for your applications. Organize your agents, manage knowledge bases, and integrate seamlessly through webhooks and APIs.

**[Try Helpmaton now →](https://helpmaton.com)**

## What is Helpmaton?

Helpmaton is a comprehensive AI agent management platform designed for teams and developers who need to deploy intelligent assistants at scale. Whether you're building customer support bots, internal knowledge assistants, or specialized AI workflows, Helpmaton provides the infrastructure and tools to make it happen.

Available as a fully managed SaaS platform at [helpmaton.com](https://helpmaton.com), you can get started in minutes without any infrastructure setup.

### Core Concept

Create workspaces to organize your AI agents and their knowledge bases. Each agent can be configured with custom system prompts and has access to documents you upload, enabling context-aware responses tailored to your specific use case. Agents expose webhook endpoints that can be integrated into any application or service.

### Use Cases

- **Customer Support**: Deploy intelligent support agents that understand your product documentation
- **Internal Knowledge Bases**: Create assistants that help teams find information quickly
- **Specialized Workflows**: Build domain-specific agents for technical documentation, legal research, or any specialized field
- **API Integration**: Embed AI capabilities into your applications via webhook endpoints

## Key Features

### Workspace Organization

Organize your agents and documents into workspaces. Perfect for teams managing multiple projects or departments, each with their own isolated environment.

### AI Agent Management

Create and configure AI agents with custom system prompts. Define their behavior, personality, and response style. Each agent gets its own webhook endpoint for easy integration.

### Document Management

Upload markdown and text documents to build knowledge bases for your agents. Organize documents into folders and keep them updated as your information evolves.

### Webhook API

Every agent exposes a webhook endpoint that accepts HTTP requests. Send messages and receive AI-powered responses, making integration with your applications straightforward.

### Team Collaboration

Workspace permissions allow you to control who can view, edit, or manage agents and documents. Perfect for teams that need granular access control.

### Flexible Subscription Plans

Choose from Free, Starter, or Pro plans that scale with your needs. Each plan includes different limits for workspaces, agents, documents, and team members. [View plans and pricing at helpmaton.com](https://helpmaton.com)

## Quick Start

Get started with Helpmaton in minutes:

1. **Sign up** at [helpmaton.com](https://helpmaton.com) - Create your account and get instant access
2. **Create a Workspace** - Set up your first workspace to organize your agents
3. **Add an Agent** - Create an AI agent with a custom system prompt
4. **Upload Documents** - Add knowledge base documents to inform your agent
5. **Test Your Agent** - Use the webhook endpoint to send messages and receive responses

For detailed setup instructions, see the [Getting Started Guide](./docs/getting-started.md).

## For Developers

Helpmaton is built with developers in mind. Integrate AI capabilities into your applications through our REST API and webhook endpoints. Access the platform at [helpmaton.com](https://helpmaton.com) and start building immediately.

Join our [Discord community](https://discord.gg/Zf9Q7GpuKx) to discuss integrations, share code examples, and get developer support.

### REST API

Full programmatic access to all platform features. Create workspaces, manage agents, upload documents, and configure permissions—all through our comprehensive API.

### Webhook Endpoints

Each agent exposes a webhook URL that accepts POST requests. Send messages and receive AI responses in real-time. Perfect for chatbots, integrations, and automated workflows.

### OpenAPI Documentation

Complete API documentation available in OpenAPI format. Generate client libraries, explore endpoints, and understand request/response schemas.

### Integration Examples

- Connect agents to Slack, Discord, or other chat platforms
- Embed AI responses in web applications
- Build automated workflows that leverage AI capabilities
- Create custom interfaces for agent interactions

See the [API Reference](./docs/api-reference.md) for complete endpoint documentation.

## Contributing

We welcome contributions to Helpmaton! Whether you're fixing bugs, adding features, or improving documentation, your help makes Helpmaton better for everyone.

- **[Contributing Guide](./CONTRIBUTING.md)** - Learn how to contribute, including our CLA requirements and PR workflow
- **[License](./LICENSE.md)** - View the Business Source License 1.1 terms
- **[Notice](./NOTICE.md)** - Copyright and attribution information

## Technology Stack

Helpmaton is built on modern, scalable infrastructure:

- **Backend**: TypeScript, Node.js, AWS Lambda, API Gateway
- **Database**: DynamoDB for high-performance data storage
- **Storage**: S3 for document management
- **Frontend**: React with TypeScript
- **AI**: Google Gemini API integration
- **Deployment**: Automated CI/CD with GitHub Actions

The platform is designed for reliability, scalability, and performance, handling everything from individual developers to enterprise teams.

## Documentation

### Getting Started

- **[Try Helpmaton](https://helpmaton.com)** - Sign up and start building AI agents in minutes
- [Getting Started Guide](./docs/getting-started.md) - New to Helpmaton? Start here for a quick introduction and basic setup.
- [Development Setup](./docs/development-setup.md) - Set up your local development environment

### Architecture & Infrastructure

- [Architecture Overview](./docs/architecture.md) - System architecture, components, and request flows
- [Database Schema](./docs/database-schema.md) - Complete DynamoDB table structure and access patterns
- [Deployment Guide](./docs/deployment.md) - Automated deployment process and infrastructure setup

### Core Features

- [Agent Configuration](./docs/agent-configuration.md) - Learn how to create, configure, and manage AI agents
- [Document Management](./docs/document-management.md) - Guide to uploading, organizing, and managing documents
- [Workspace Permissions](./docs/workspace-permissions.md) - Understanding the permission system and access control

### Core Systems

- [Authentication System](./docs/authentication.md) - Session-based auth, JWT tokens, API keys, and OAuth
- [Credit System](./docs/credit-system.md) - Credit reservation, adjustment, and spending limits
- [Webhook System](./docs/webhook-system.md) - Webhook endpoints, authentication, and response formats
- [Streaming System](./docs/streaming-system.md) - Server-Sent Events (SSE) and Lambda URL streaming
- [API Throttling](./docs/api-throttling.md) - Rate limits, burst limits, and subscription plan differences

### Integrations

- [MCP Servers](./docs/mcp-servers.md) - Configure and use MCP servers for external tools
- [Discord Setup](./docs/discord-setup.md) - Configure Discord integration for your agents
- [Email Setup](./docs/email-setup.md) - Configure email authentication and notifications

### Reference

- [API Reference](./docs/api-reference.md) - Complete API endpoint documentation with examples
- [Subscription Management](./docs/subscription-management.md) - Subscription plans, limits, and management
- [Pricing Calculation](./docs/pricing-calculation.md) - How token usage costs are calculated

### Development

- [Development Setup](./docs/development-setup.md) - Local development environment setup
- [OpenAPI Generation](./docs/openapi-generation.md) - How to generate and maintain OpenAPI documentation
- [Testing Aggregation](./docs/testing-aggregation.md) - Testing strategies and aggregation patterns

### Support

- [Troubleshooting](./docs/troubleshooting.md) - Common issues and their solutions
- [Join our Discord Community](https://discord.gg/Zf9Q7GpuKx) - Get help, share ideas, and connect with other Helpmaton users

## Getting Help

If you need assistance:

1. Check the [Troubleshooting Guide](./docs/troubleshooting.md) for common issues
2. Review the [API Reference](./docs/api-reference.md) for technical details
3. Consult the relevant feature documentation for specific questions
4. [Join our Discord community](https://discord.gg/Zf9Q7GpuKx) - Get support, share your projects, and connect with other users

## License

Helpmaton is licensed under the **Business Source License 1.1**. On **November 1st, 2029**, it will automatically be made available under the **Apache License, Version 2.0**.

- **[LICENSE](./LICENSE.md)** - Full license terms and conditions
- **[NOTICE](./NOTICE.md)** - Copyright notice and attribution requirements

For more information about contributing, see our [Contributing Guide](./CONTRIBUTING.md).

---

**Ready to get started?** [Sign up at helpmaton.com](https://helpmaton.com) to create your first workspace and deploy your first AI agent. No credit card required for the free plan.

For detailed instructions, check out the [Getting Started Guide](./docs/getting-started.md).

**Need help or want to connect?** [Join our Discord community](https://discord.gg/Zf9Q7GpuKx) to get support, share your projects, and connect with other Helpmaton users.
