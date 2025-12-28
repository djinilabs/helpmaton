# Architecture Overview

This document provides a comprehensive overview of the Helpmaton system architecture, including components, request flows, and technology stack.

## System Architecture

Helpmaton is built on AWS serverless infrastructure using the Architect Framework. The system is designed for scalability, reliability, and cost-effectiveness.

### High-Level Architecture

```
┌─────────────┐
│   Client    │
│  (Browser)  │
└──────┬──────┘
       │
       │ HTTPS
       ▼
┌─────────────────────────────────────────────────┐
│              CloudFront                         │
│  (CDN + SPA Routing + Custom Domain)            │
└──────┬──────────────────────────────────────────┘
       │
       │
       ▼
┌─────────────────────────────────────────────────┐
│           API Gateway (REST API)                │
│  ┌──────────────────────────────────────────┐   │
│  │  Lambda Authorizer                       │   │
│  │  (Extracts workspace, applies throttling)│   │
│  └──────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────┐   │
│  │  Usage Plans (Free/Starter/Pro)         │    │
│  │  Rate Limits & Burst Limits             │    │
│  └──────────────────────────────────────────┘   │
└──────┬──────────────────────────────────────────┘
       │
       │ Routes to Lambda Functions
       ▼
┌─────────────────────────────────────────────────┐
│           AWS Lambda Functions                  │
│  ┌──────────────────────────────────────────┐   │
│  │  HTTP Handlers                           │   │
│  │  - Workspace Management                  │   │
│  │  - Agent Management                      │   │
│  │  - Document Management                   │   │
│  │  - Webhook Handlers                      │   │
│  │  - Authentication                        │   │
│  └──────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────┐   │
│  │  Scheduled Functions                     │   │
│  │  - Token Usage Aggregation               │   │
│  │  - Credit Reservation Cleanup            │   │
│  └──────────────────────────────────────────┘   │
└──────┬──────────────────────────────────────────┘
       │
       ├─────────────────┬─────────────────┐
       ▼                 ▼                 ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  DynamoDB   │  │     S3      │  │  Lambda URL │
│  (Database) │  │ (Documents) │  │  (Streaming)│
└─────────────┘  └─────────────┘  └─────────────┘
       │
       │ External Services
       ▼
┌─────────────────────────────────────────────────┐
│         External Services                       │
│  - Google Gemini API (LLM)                      │
│  - Mailgun (Email)                              │
│  - Discord API                                  │
│  - MCP Servers (User-configured)                │
└─────────────────────────────────────────────────┘
```

## Core Components

### 1. Frontend (React + TypeScript)

- **Location**: `apps/frontend/`
- **Framework**: React with TypeScript
- **Build Tool**: Vite
- **Deployment**: Static files served via CloudFront + S3
- **Features**:
  - Single Page Application (SPA) with client-side routing
  - Real-time streaming via Server-Sent Events (SSE)
  - Session-based authentication with cookies
  - JWT token management for API calls

### 2. API Gateway (REST API)

- **Type**: AWS API Gateway REST API (transformed from HTTP API v2)
- **Region**: `eu-west-2` (London)
- **Custom Domain**: Configured via CloudFront and Route53
- **Features**:
  - Custom domain support (`app.helpmaton.com`)
  - Lambda authorizer for request validation and throttling
  - Usage plans for subscription-based rate limiting
  - CORS configuration for frontend access

### 3. Lambda Functions

- **Runtime**: Node.js 20.x
- **Language**: TypeScript (compiled to JavaScript)
- **Timeout**: 60 seconds
- **Build**: esbuild for fast compilation
- **Types**: Architect Framework with TypeScript plugin

#### HTTP Handlers

Each route in `app.arc` maps to a Lambda function:

- **Workspace Management**: `/api/workspaces/*`
- **Agent Management**: `/api/workspaces/:workspaceId/agents/*`
- **Document Management**: `/api/workspaces/:workspaceId/documents/*`
- **Webhook Endpoints**: `/api/webhook/:workspaceId/:agentId/:key`
- **Streaming Endpoints**: `/api/streams/:workspaceId/:agentId/:secret` (Lambda URL)
- **Authentication**: `/api/auth/*`
- **User Management**: `/api/user/*`
- **Subscription Management**: `/api/subscription/*`

#### Scheduled Functions

- **Token Usage Aggregation**: Runs daily to aggregate token usage statistics
- **Credit Reservation Cleanup**: Runs every 10 minutes to clean up expired reservations

### 4. DynamoDB (Database)

- **Type**: NoSQL database with encryption at rest
- **Tables**: 17+ tables for different data types
- **Indexes**: Global Secondary Indexes (GSI) for efficient queries
- **Features**:
  - Automatic encryption at rest
  - TTL (Time To Live) for temporary data
  - Atomic operations for credit management
  - Optimistic locking with version numbers

Key Tables:

- `workspace` - Workspace data and credit balances
- `agent` - Agent configurations
- `workspace-document` - Document metadata
- `permission` - Access control
- `subscription` - Subscription plans
- `token-usage-aggregates` - Usage statistics
- `credit-reservations` - Temporary credit reservations

### 5. S3 (Document Storage)

- **Purpose**: Store workspace documents (markdown, text files)
- **Bucket**: Configurable via `HELPMATON_S3_BUCKET`
- **Local Development**: Uses s3rver for local S3 emulation
- **Features**:
  - Document versioning
  - Folder organization
  - Direct file uploads and text-based document creation

### 6. Lambda URLs (Streaming)

- **Purpose**: Direct streaming endpoints for real-time agent responses
- **Route**: `/api/streams/:workspaceId/:agentId/:secret`
- **Protocol**: Server-Sent Events (SSE)
- **Features**:
  - Bypasses API Gateway for lower latency
  - CORS configuration for cross-origin requests
  - Secret-based authentication
  - Configurable allowed origins

### 7. CloudFront (CDN)

- **Purpose**:
  - Serve static frontend assets
  - Custom domain routing
  - SPA routing via CloudFront Function
- **Features**:
  - Custom domain with SSL/TLS
  - SPA routing (404/403 → `/index.html`)
  - Edge caching for static assets

## Request Flows

### 1. Webhook Request Flow

```
Client → API Gateway → Lambda Authorizer
                          │
                          ├─ Extract workspaceId from path
                          ├─ Look up subscription
                          ├─ Apply throttling (usage plan)
                          └─ Return API key ID
                          │
                          ▼
                    Webhook Handler Lambda
                          │
                          ├─ Validate agent key
                          ├─ Load agent configuration
                          ├─ Reserve credits (atomic)
                          ├─ Call LLM (Gemini API)
                          ├─ Adjust credits (actual cost)
                          └─ Return response
                          │
                          ▼
                    Client receives response
```

### 2. Streaming Request Flow

```
Client → Lambda URL (Direct)
          │
          ├─ Validate secret
          ├─ Load agent configuration
          ├─ Reserve credits
          ├─ Stream LLM response (SSE)
          │   │
          │   ├─ Text chunks
          │   ├─ Tool calls
          │   └─ Tool results
          │
          └─ Adjust credits on completion
          │
          ▼
    Client receives streamed response
```

### 3. Authentication Flow

#### Magic Link Authentication

```
User enters email
    │
    ▼
Backend generates token
    │
    ▼
Email sent via Mailgun
    │
    ▼
User clicks link
    │
    ▼
Backend validates token
    │
    ▼
Session cookie created
    │
    ▼
User authenticated
```

#### JWT Token Authentication

```
User logs in
    │
    ▼
Backend generates:
  - Access token (JWT, short-lived)
  - Refresh token (stored in DB)
    │
    ▼
Client stores tokens
    │
    ▼
API requests include:
  Authorization: Bearer <access_token>
    │
    ▼
Backend validates JWT
    │
    ├─ Valid → Process request
    └─ Expired → Use refresh token
         │
         ▼
    Generate new access token
```

### 4. Credit Management Flow

```
Request arrives
    │
    ▼
Estimate token cost
    │
    ▼
Check spending limits
    │
    ├─ Exceeded → Error
    └─ OK → Continue
    │
    ▼
Atomically reserve credits
  (DynamoDB atomic update)
    │
    ├─ Insufficient → Error
    └─ Reserved → Continue
    │
    ▼
Call LLM API
    │
    ▼
Get actual token usage
    │
    ▼
Adjust credit reservation
  (Refund if less, charge if more)
    │
    ▼
Clean up reservation
  (TTL-based cleanup)
```

## Technology Stack

### Backend

- **Framework**: Architect Framework (AWS serverless)
- **Language**: TypeScript
- **Runtime**: Node.js 20.x
- **Build Tool**: esbuild
- **Database**: DynamoDB
- **Storage**: S3
- **API**: REST API (via API Gateway)
- **Authentication**: NextAuth.js (Auth.js)
- **LLM Integration**: Google Gemini API (via Vercel AI SDK)

### Frontend

- **Framework**: React 18
- **Language**: TypeScript
- **Build Tool**: Vite
- **State Management**: React Hooks
- **HTTP Client**: Fetch API
- **Streaming**: Server-Sent Events (SSE)
- **UI Components**: Custom components

### Infrastructure

- **Cloud Provider**: AWS
- **Region**: eu-west-2 (London)
- **CDN**: CloudFront
- **DNS**: Route53
- **SSL/TLS**: AWS Certificate Manager (ACM)
- **CI/CD**: GitHub Actions
- **Monitoring**: Sentry (errors), PostHog (analytics)

### Development Tools

- **Package Manager**: pnpm
- **Local Database**: Architect Sandbox (DynamoDB emulator)
- **Local S3**: s3rver
- **Testing**: Vitest, Playwright
- **Linting**: ESLint
- **Type Checking**: TypeScript

## Data Flow

### Document Upload Flow

```
User uploads document
    │
    ▼
Frontend → API Gateway → Lambda Handler
    │
    ├─ Validate permissions
    ├─ Check subscription limits
    ├─ Upload to S3
    ├─ Create metadata in DynamoDB
    └─ Return document ID
    │
    ▼
Document available for agents
```

### Agent Execution Flow

```
Webhook request
    │
    ▼
Load agent configuration
    │
    ├─ System prompt
    ├─ Model selection
    ├─ Enabled tools
    └─ Document context
    │
    ▼
Load relevant documents
    │
    ├─ Query DynamoDB for documents
    ├─ Fetch from S3
    └─ Build context
    │
    ▼
Setup tools
    │
    ├─ Document search tools
    ├─ MCP server tools
    └─ Agent calling tools
    │
    ▼
Call LLM with:
    │
    ├─ System prompt
    ├─ Conversation history
    ├─ Document context
    └─ Tool definitions
    │
    ▼
Process response
    │
    ├─ Text generation
    ├─ Tool calls (if any)
    └─ Tool execution
    │
    ▼
Return response to client
```

## Security

### Authentication & Authorization

- **Session-based**: Cookie-based sessions for web UI
- **JWT Tokens**: Short-lived access tokens for API
- **API Keys**: User and workspace API keys
- **Webhooks**: Per-agent webhook endpoints for sending messages

### Data Protection

- **Encryption at Rest**: All DynamoDB tables encrypted
- **Encryption in Transit**: HTTPS/TLS for all communications
- **Key Management**: Secure key storage with hashing (scrypt)
- **Secret Management**: Environment variables in Lambda bundles

### Access Control

- **Workspace Permissions**: READ, WRITE, OWNER levels
- **Subscription Limits**: Enforced at subscription level
- **Spending Limits**: Workspace and agent-level limits
- **Rate Limiting**: Subscription-based throttling

## Scalability

### Horizontal Scaling

- **Lambda**: Automatically scales based on request volume
- **DynamoDB**: Handles high throughput with on-demand capacity
- **API Gateway**: Handles millions of requests
- **CloudFront**: Global edge locations for low latency

### Performance Optimizations

- **Lambda URLs**: Direct streaming bypasses API Gateway
- **DynamoDB Indexes**: Fast queries via GSI
- **Atomic Operations**: Efficient credit management
- **Streaming Responses**: Low-latency real-time responses
- **CDN Caching**: Static assets cached at edge

## Monitoring & Observability

### Error Tracking

- **Sentry**: Backend and frontend error tracking
- **CloudWatch Logs**: Lambda function logs
- **API Gateway Logs**: Request/response logging

### Analytics

- **PostHog**:
  - Frontend: Page views, user interactions
  - Backend: LLM calls, token usage, costs, latency

### Metrics

- **Token Usage**: Aggregated daily by workspace, agent, user
- **Credit Balances**: Tracked per workspace
- **Request Counts**: Tracked per subscription (for throttling)

## Deployment

### CI/CD Pipeline

1. **GitHub Actions**: Automated testing and deployment
2. **Test Workflow**: Type checking, linting, unit tests
3. **Deploy Workflow**:
   - Build frontend
   - Deploy backend (Architect)
   - Register Discord commands
   - Environment variable injection

### Environments

- **Production**: Main branch → Production stack
- **PR Deployments**: Each PR gets isolated CloudFormation stack
- **Local Development**: Architect Sandbox + local S3

### Environment Variables

- **Build-time Injection**: Variables embedded in Lambda bundles
- **Isolation**: Each PR deployment has isolated variables
- **Secrets**: Stored in GitHub Secrets, injected during build

## Plugins

Helpmaton uses several Architect plugins:

1. **architect/plugin-typescript**: TypeScript compilation
2. **s3**: S3 bucket creation
3. **http-to-rest**: Transforms HTTP API v2 to REST API
4. **api-throttling**: Subscription-based rate limiting
5. **custom-domain**: Custom domain configuration
6. **lambda-urls**: Lambda URL endpoints for streaming

## External Integrations

### Google Gemini API

- **Purpose**: LLM for agent responses
- **Integration**: Vercel AI SDK
- **Models**: Various Gemini models (flash, pro)
- **Features**: Streaming, tool calling, reasoning tokens

### Mailgun

- **Purpose**: Send authentication emails
- **Features**: Magic link emails, OAuth callback emails

### Discord

- **Purpose**:
  - Slash command integration
  - Trial credit request notifications
- **Features**: Bot commands, channel notifications

### MCP Servers

- **Purpose**: User-configured external tool servers
- **Protocol**: JSON-RPC 2.0
- **Authentication**: None, header, or basic auth
- **Integration**: Tools created dynamically from MCP servers

## Future Considerations

- **Multi-region**: Potential for global deployment
- **Caching**: Additional caching layers for documents
- **WebSocket**: Real-time bidirectional communication
- **GraphQL**: Alternative API interface
- **Event-driven**: More event-driven architecture patterns
