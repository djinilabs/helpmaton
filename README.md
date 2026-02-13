[![Tests](https://github.com/djinilabs/helpmaton/actions/workflows/test.yml/badge.svg)](https://github.com/djinilabs/helpmaton/actions/workflows/test.yml) [![E2E Tests](https://github.com/djinilabs/helpmaton/actions/workflows/test-e2e.yml/badge.svg)](https://github.com/djinilabs/helpmaton/actions/workflows/test-e2e.yml) [![Deploy Prod](https://github.com/djinilabs/helpmaton/actions/workflows/deploy-prod.yml/badge.svg)](https://github.com/djinilabs/helpmaton/actions/workflows/deploy-prod.yml) ![GitHub release (latest by SemVer)](https://img.shields.io/github/v/release/djinilabs/helpmaton)

<div style="background-color: white; padding: 20px; display: inline-block; border-radius: 8px;">
  <img src="apps/frontend/public/images/logo.svg" alt="Helpmaton Logo" width="200">
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
- **Chat Platform Bots**: Deploy your agents as Slack or Discord bots for team collaboration and community engagement
- **Research Assistants**: Build agents that can search the web for current information, find recent articles, and analyze web content
- **News Monitoring**: Create agents that monitor news, track industry developments, and provide real-time updates
- **Content Analysis**: Deploy agents that extract and summarize content from web pages, articles, and online resources
- **Google Workspace Automation**: Connect agents to Gmail, Google Calendar, and Google Drive for email management, calendar scheduling, and document analysis workflows
- **Scheduled Automation**: Create agents that run automatically on schedules for daily reports, weekly summaries, proactive monitoring, and routine operational tasks
- **CRM & Sales Automation**: Integrate agents with HubSpot, Salesforce, or Zendesk for automated customer support, lead management, and sales workflows
- **E-commerce Operations**: Connect agents to Shopify for automated order processing, inventory management, and sales analytics
- **Project Management**: Use agents with Linear, Notion, or Todoist for automated task management, project tracking, and team coordination
- **Specialized Workflows**: Build domain-specific agents for technical documentation, legal research, or any specialized field
- **API Integration**: Embed AI capabilities into your applications via webhook endpoints

## Key Features

### Workspace Organization

Organize your agents and documents into workspaces. Perfect for teams managing multiple projects or departments, each with their own isolated environment.

### AI Agent Management

Create and configure AI agents with custom system prompts. Define their behavior, personality, and response style. Each agent gets its own webhook endpoint for easy integration.

### Document Management

Upload markdown and text documents to build knowledge bases for your agents. Organize documents into folders and keep them updated as your information evolves.

### Conversation Attachments

Attach files and images directly to conversations. Upload documents, screenshots, and other files to give agents richer context and enable more accurate, multi-modal responses.

### Agent Memory System

Agents remember important facts, people, and events from conversations through a stratified memory architecture. Memories are progressively summarized across temporal grains (daily, weekly, monthly, quarterly, yearly) and searchable via semantic vector search, enabling context-aware responses informed by past interactions.

### Custom Summarization Prompts

Tailor memory summaries with per-agent, per-grain prompts (daily, weekly, monthly, quarterly, yearly) so each agent retains and synthesizes context in a way that fits your workflow.

### Agent Schedules

Automate agent runs on a schedule with cron-based prompts. Create multiple schedules per agent, each with its own cron expression and custom prompt. Schedules can be enabled or disabled individually, and agents automatically execute scheduled runs at the specified times. Perfect for recurring reports, proactive monitoring, routine operational tasks, and automated workflows that need to run on a regular cadence.

### Web Search & Content Extraction

Give your agents access to real-time, up-to-date information beyond their training data. Enable web search and content extraction tools to make your AI assistants more capable and current.

**Web Search** (`search_web`): Agents can search the web for current information, news, articles, and research. Perfect for finding the latest developments, answering questions about recent events, or discovering new resources. Search results include titles, URLs, content snippets, and relevance scores.

**Content Extraction** (`fetch_url`): Extract and summarize content from any web page URL. Agents can read and understand specific web pages, analyze articles, extract key information, and provide insights from any online content.

**Available Providers**:
- **Tavily**: $0.008 per call (first 10 calls/day free for paid tiers)
- **Jina.ai**: Free (no credits charged, rate limits may apply)

**Exa.ai Search** (`search`): Perform category-specific searches across 9 specialized categories: company information, research papers, news articles, PDF documents, GitHub repositories, tweets, personal sites, people, and financial reports. Variable pricing based on result count ($5-$25 per 1,000 requests).

**Key Advantages**:

- **Real-Time Information**: Access current information that isn't in training data
- **Always Current**: Answer questions about recent events, news, and developments
- **Cost-Effective**: Free daily allowance (10 calls/day with Tavily) with transparent pay-as-you-go pricing
- **Multiple Providers**: Choose between Tavily (paid) or Jina.ai (free) for web search
- **Specialized Search**: Use Exa.ai for category-specific searches across research papers, companies, and more
- **Easy Integration**: Enable per-agent with simple toggle switches
- **Intelligent Extraction**: Automatically extracts main content, titles, and metadata from web pages

**Pricing**: 
- **Tavily**: Free tier includes 10 calls per 24 hours. Paid tiers get 10 free calls per day, then $0.008 per additional call.
- **Jina.ai**: Free (no credits charged, rate limits may apply)
- **Exa.ai**: Pay-as-you-go pricing - all requests require credits (no free tier)

Perfect for research assistants, news monitoring, content analysis workflows, and specialized information discovery.

### Tool Integration & Extensibility

Agents come with a comprehensive set of built-in tools and can be extended with MCP (Model Context Protocol) servers to connect to external APIs and services.

**Built-in Tools**:

- **Document Search**: Semantic vector search across workspace documents
- **Memory Search**: Recall past conversations and information from the agent's memory system
- **Web Search**: Search the web for current information, news, and articles
- **Web Fetch**: Extract and summarize content from any web page URL
- **Email Sending**: Send emails using workspace email connections
- **Notification Sending**: Send notifications to Discord channels (with API support for Slack)
- **Agent Delegation**: Agents can delegate tasks to other agents in the workspace, with support for async delegation, query-based matching, and delegation tracking. Configure which agents can receive delegations and let your agents collaborate to handle complex workflows

**Extensibility**: Configure MCP servers with custom authentication and enable them per-agent to give your AI assistants access to databases, business logic, weather APIs, and any other external services you need.

**Google Workspace Integration**: Connect your agents to Google Workspace services through OAuth-based MCP servers. Enable powerful integrations with Gmail, Google Calendar, and Google Drive to give your agents access to your Google data.

- **Gmail Integration**: Create MCP servers that connect to Gmail accounts via OAuth, enabling agents to list, search, and read emails. Agents can search using Gmail's powerful search syntax (e.g., "from:example@gmail.com", "subject:meeting", "is:unread") and retrieve full email content including headers, body, and attachments.

- **Google Calendar Integration**: Connect agents to Google Calendar for full calendar management. Agents can list events, search by query, read event details, create new events, update existing events, and delete events. Perfect for scheduling assistants, meeting coordinators, and calendar management workflows.

- **Google Drive Integration**: Give agents access to files stored in Google Drive. Agents can read text files, Google Docs (exported as plain text), Google Sheets (exported as CSV), and Google Slides (exported as plain text). Ideal for document analysis, data extraction, and content management workflows.

All Google Workspace integrations use secure OAuth 2.0 authentication, ensuring your data remains private and secure. Simply create an MCP server with the appropriate service type (Gmail, Google Calendar, or Google Drive), connect your Google account via OAuth, and enable the server for your agents.

**Additional MCP Integrations**:

- **GitHub**: Read repositories, issues, pull requests, commits, and files
- **Slack**: List channels, read channel history, and post messages
- **Linear**: Access teams, projects, issues, and search
- **HubSpot**: Read CRM contacts, companies, deals, and owners
- **PostHog**: Access projects, events, feature flags, insights, and persons
- **Salesforce**: Discover objects, inspect fields, and run queries
- **Notion**: Read, search, create, and update pages and databases with shared workspace access
- **Shopify**: Look up orders, check product inventory, and summarize sales for date ranges
- **Intercom**: Read and reply to conversations, and manage contacts as an admin
- **Todoist**: Create, list, and complete tasks with natural language due dates
- **Zendesk**: Search tickets, read ticket threads, draft private replies, and search Help Center articles
- **Stripe**: Read-only access to Stripe balance, refunds, and charge search via Stripe's query language

See the [MCP Servers](./docs/mcp-servers.md) guide for setup and full tool coverage.

### Agent Skills

Enhance your agents with **skills**—optional instruction blocks that teach agents how to use their tools effectively. Skills are appended to the agent's system prompt and provide step-by-step guidance, examples, and edge-case handling for specific workflows.

**How it works**: Enable tools (MCP servers or built-in tools like document search, web search, email) for your agent, then pick from available skills that match those tools. Each skill is only available when all its required tools are enabled and connected. Skills cover analytics (PostHog, HubSpot), support (Zendesk, Intercom), project management (Linear, Notion, Todoist), e-commerce (Shopify), CRM (Salesforce), and more.

**Benefits**:
- **Better tool usage**: Agents follow structured instructions instead of guessing how to use tools
- **Domain expertise**: Skills include examples, edge cases, and tool-specific guidance
- **Easy configuration**: Enable skills per-agent from the Agent detail page → External tools → Skills
- **Export/import**: Skills are included in workspace export for reproducible setups

See [Agent Skills](./docs/agent-skills.md) for the full catalog and tool requirements.

### Cost Management & Billing

**Credit System**: Purchase credits and pay only for what you use with transparent, usage-based billing. Credits are automatically reserved before LLM calls and adjusted after based on actual token usage, with atomic operations preventing race conditions.

**Bring Your Own Key (BYOK)**: Use your own LLM API keys instead of credits. Pay providers directly while still benefiting from Helpmaton's infrastructure, analytics, and management features.

**Spending Limits**: Set granular daily, monthly, or yearly spending limits at both workspace and individual agent levels to prevent runaway costs and maintain budget control.

**Advanced Pricing**: Support for tiered pricing models (different rates based on token thresholds), separate reasoning token billing, and tracking of cached prompt tokens for accurate cost calculation.

### Usage Analytics & Monitoring

Comprehensive token usage tracking across all dimensions: prompt tokens, completion tokens, reasoning tokens, and cached tokens. View detailed usage statistics with daily and hourly aggregation, historical data with date range filtering, and per-workspace or per-agent breakdowns.

**Error Tracking**: Conversations automatically persist and display errors when LLM calls fail, including detailed error messages, stack traces, provider information, and metadata. Error badges in conversation lists and detailed error views help you quickly identify and debug issues.

### Evaluation & Quality Control

Configure eval judges to score conversations, track outcomes, and validate agent behavior. Sampling controls let you run evaluations on a subset of traffic to balance insight with cost.

### Trial & Free Access

Request trial credits to test the platform risk-free. The free plan includes 1 workspace and 1 agent with 7-day access, perfect for evaluation. After the trial period, agents are blocked until you upgrade to a paid plan.

### Flexible Authentication

Multiple authentication methods to fit your workflow: session-based authentication for web users, JWT tokens with 24-hour expiration for API access, workspace API keys for programmatic integration, and OAuth support for email-based login.

### Subscription Sharing

Pro plan subscriptions support multiple managers with shared access to all workspaces. Perfect for teams that need collaborative management of AI agents and resources, with unlimited managers on Pro plans.

### Memory Retention Policies

Automatic memory management with subscription plan-based retention periods. Free plans retain 48 hours of working memory and 30 days of daily summaries, while Pro plans extend to 240 hours and 120 days respectively. Old memories are automatically cleaned up to optimize storage.

### Streaming Support

Get real-time, streaming responses from your agents using Server-Sent Events (SSE) or Lambda Function URLs. Perfect for chat interfaces, interactive applications, and real-time user experiences. Responses stream token-by-token as they're generated, providing immediate feedback and a smooth conversational experience.

### Webhook API

Every agent exposes a webhook endpoint that accepts HTTP requests. Send messages and receive AI-powered responses, making integration with your applications straightforward. Supports both synchronous responses and streaming via dedicated streaming endpoints.

### Chat Platform Bot Integration

Deploy your agents as Slack or Discord bots, enabling team members and community users to interact with your AI agents directly in their favorite chat platforms. Create integrations that connect your agents to Slack workspaces or Discord servers, with full support for mentions, commands, and direct messages.

**Slack Integration**:

- Deploy agents as Slack bots that respond to mentions and direct messages
- Dynamic Slack App Manifest generation for easy setup
- Secure webhook handling with signature verification
- Throttled message updates for streaming-like experience
- Support for both channel mentions and direct messages

**Discord Integration**:

- Deploy agents as Discord bots with slash command support
- Ed25519 signature verification for secure interactions
- Throttled message updates for real-time responses
- Full support for Discord's interaction system

**Key Features**:

- **Unified Management**: Manage all integrations from a single Integrations page
- **Secure by Default**: Platform-specific signature verification ensures only legitimate requests are processed
- **Easy Setup**: Step-by-step guides for both platforms with manifest generation
- **Streaming Simulation**: Throttled message updates provide near-real-time response experience
- **Full Agent Capabilities**: Bots have access to all agent tools, memory, and knowledge bases

See [Slack Integration](./docs/slack-integration.md) and [Discord Integration](./docs/discord-integration.md) for detailed setup guides.

### Notification Channels

Configure notification channels for your workspaces to enable agents to send messages to external platforms. Create Discord channels with bot tokens and channel IDs, or use Slack webhooks via the API. Agents can use the `send_notification` tool to deliver messages to configured channels, perfect for alerts, updates, and automated communications.

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

- **Chat Platform Bots**: Deploy agents as Slack or Discord bots for team collaboration and community engagement
- **Web Applications**: Embed AI responses in web applications with real-time streaming
- **Automated Workflows**: Build automated workflows that leverage AI capabilities, including scheduled agent runs
- **Research Assistants**: Create research assistants that search the web for current information using Tavily, Jina.ai, or Exa.ai
- **News Monitoring**: Deploy news monitoring agents that track industry developments with scheduled runs
- **Content Analysis**: Build content analysis tools that extract insights from web pages
- **Google Workspace Automation**: Connect agents to Gmail for email management, Google Calendar for scheduling, and Google Drive for document analysis
- **CRM Integration**: Connect agents to HubSpot, Salesforce, or Zendesk for customer support and sales workflows
- **E-commerce Automation**: Integrate with Shopify for order management, inventory tracking, and sales reporting
- **Project Management**: Connect agents to Linear, Notion, or Todoist for task management and project tracking
- **Payment Processing**: Integrate with Stripe for payment analytics and charge management
- **Customer Support**: Use Intercom or Zendesk integrations for automated customer support workflows
- **Custom Interfaces**: Create custom interfaces for agent interactions
- **MCP Extensions**: Extend agents with MCP servers for database access, external APIs, and custom business logic
- **Scheduled Automation**: Create agents that run automatically on cron schedules for reports, monitoring, and routine tasks

See the [API Reference](./docs/api-reference.md) for complete endpoint documentation and [MCP Servers](./docs/mcp-servers.md) for tool integration guide.

## Contributing

We welcome contributions to Helpmaton! Whether you're fixing bugs, adding features, or improving documentation, your help makes Helpmaton better for everyone.

- **[Contributing Guide](./CONTRIBUTING.md)** - Learn how to contribute, including our CLA requirements and PR workflow
- **[License](./LICENSE.md)** - View the Business Source License 1.1 terms
- **[Notice](./NOTICE.md)** - Copyright and attribution information

## Technology Stack

Helpmaton is built on modern, scalable infrastructure:

- **Backend**: TypeScript, Node.js, AWS Lambda (including custom container images), API Gateway
- **Database**: DynamoDB for high-performance data storage with atomic operations
- **Vector Database**: LanceDB with S3 backend for agent memory and semantic search
- **Storage**: S3 for document management and vector database persistence
- **Frontend**: React with TypeScript
- **AI**: OpenRouter for embeddings and LLM capabilities—use any provider and any model
- **Queue Processing**: SQS FIFO queues with message groups for serialized memory writes and partial batch failure support for efficient error handling
- **Deployment**: Automated CI/CD with GitHub Actions, multi-stage Docker builds for optimization
- **Payments**: Lemon Squeezy integration for subscriptions and credit purchases
- **Monitoring**: Comprehensive usage tracking and analytics with automated aggregation

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
- [Agent Skills](./docs/agent-skills.md) - Enhance agents with instruction blocks for effective tool usage
- [Document Management](./docs/document-management.md) - Guide to uploading, organizing, and managing documents
- [Workspace Permissions](./docs/workspace-permissions.md) - Understanding the permission system and access control

### Core Systems

- [Authentication System](./docs/authentication.md) - Session-based auth, JWT tokens, API keys, and OAuth
- [Agent Memory System](./docs/agent-memory-system.md) - Stratified memory architecture, temporal grains, and semantic search
- [Credit System](./docs/credit-system.md) - Credit reservation, adjustment, and spending limits
- [Webhook System](./docs/webhook-system.md) - Webhook endpoints, authentication, and response formats
- [Streaming System](./docs/streaming-system.md) - Server-Sent Events (SSE) and Lambda URL streaming
- [API Throttling](./docs/api-throttling.md) - Rate limits, burst limits, and subscription plan differences

### Integrations

- [Slack Bot Integration](./docs/slack-integration.md) - Deploy your agents as Slack bots for team collaboration
- [Discord Bot Integration](./docs/discord-integration.md) - Deploy your agents as Discord bots for community engagement
- [MCP Servers](./docs/mcp-servers.md) - Configure and use MCP servers (GitHub, Slack, Linear, HubSpot, PostHog, Salesforce, Zendesk, Notion, Google Workspace, Shopify, Intercom, Todoist, Stripe)
- [Tavily Integration](./docs/tavily-integration.md) - Web search and content extraction with Tavily API
- [Discord Setup](./docs/discord-setup.md) - Configure Discord notification channels for your agents
- [Email Setup](./docs/email-setup.md) - Configure email authentication and notifications
- Notification Channels - Configure Discord and Slack webhook channels for agent notifications via the API

### Reference

- [API Reference](./docs/api-reference.md) - Complete API endpoint documentation with examples
- [Subscription Management](./docs/subscription-management.md) - Subscription plans, limits, manager sharing, and free trial details
- [Pricing Calculation](./docs/pricing-calculation.md) - Token usage costs, tiered pricing, and reasoning token billing
- [Vector Database](./docs/vector-database.md) - LanceDB architecture, temporal grains, and query patterns

### Development

- [Development Setup](./docs/development-setup.md) - Local development environment setup
- [Internal docs (workspace / meta-agent)](./docs/README.md#internal-docs-workspace--meta-agent) - How the workspace assistant and Configure with AI get their doc index and how to add docs
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
