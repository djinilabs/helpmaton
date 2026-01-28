# Lambda Container Image Configuration

**Last Updated:** 2025-12-15  
**Function Name:** `HelpmatonStagingPR5-AnyApiStreamsWorkspaceIdAgentI-4dODUr7Z2zdv`  
**Region:** `eu-west-2`

## Overview

This document describes the current AWS Lambda function configuration for the container image deployment. The function uses a Docker container image instead of a ZIP package.

## Function Details

| Property               | Value                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Function Name**      | `HelpmatonStagingPR5-AnyApiStreamsWorkspaceIdAgentI-4dODUr7Z2zdv`                                                |
| **Function ARN**       | `arn:aws:lambda:eu-west-2:307946679392:function:HelpmatonStagingPR5-AnyApiStreamsWorkspaceIdAgentI-4dODUr7Z2zdv` |
| **Package Type**       | `Image`                                                                                                          |
| **Architecture**       | `arm64`                                                                                                          |
| **Runtime**            | `null` (container image)                                                                                         |
| **Handler**            | `null` (container image)                                                                                         |
| **Memory Size**        | `1152 MB`                                                                                                        |
| **Timeout**            | `60 seconds`                                                                                                     |
| **Code Size**          | `0` (container image)                                                                                            |
| **Last Modified**      | `2025-12-15T16:10:30.000+0000`                                                                                   |
| **State**              | `Active`                                                                                                         |
| **Last Update Status** | `Successful`                                                                                                     |

## Container Image Configuration

### ImageConfig

The function uses `ImageConfig` to specify how the container image should be executed:

```json
{
  "ImageConfig": {
    "Command": [
      "http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"
    ],
    "WorkingDirectory": "/var/task"
  }
}
```

**Configuration Details:**

- **Command**: `["http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"]`

  - Points directly to the handler file within the container
  - Format: `path/to/file.exportname` (relative to WorkingDirectory)
  - Handler file: `/var/task/http/any-api-streams-000workspaceId-000agentId-000secret/index.js`
  - Handler export: `handler`

- **WorkingDirectory**: `"/var/task"`

  - Default Lambda task root directory
  - All paths in Command are relative to this directory

- **EntryPoint**: Not explicitly set in ImageConfig
  - Uses the base image's default ENTRYPOINT: `/lambda-entrypoint.sh`
  - The AWS Lambda Node.js base image (`public.ecr.aws/lambda/nodejs:20`) sets this automatically

### Container Image URI

- **Image URI**: `307946679392.dkr.ecr.eu-west-2.amazonaws.com/helpmaton-lambda-images:lancedb-ba0536d5748c131f109666a957f7ee55f4c54444`
- **ECR Repository**: `helpmaton-lambda-images`
- **Image Tag**: `lancedb-ba0536d5748c131f109666a957f7ee55f4c54444` (includes commit SHA)

### Base Image

The container image is built from:

- **Base Image**: `public.ecr.aws/lambda/nodejs:20`
- **Custom Image**: `lancedb` (includes LanceDB dependencies)

The base image provides:

- Node.js 20.x runtime
- Lambda Runtime Interface Client (RIC)
- Default ENTRYPOINT: `/lambda-entrypoint.sh`
- Default WORKDIR: `/var/task`

## Function URL Configuration

| Property          | Value                                                                   |
| ----------------- | ----------------------------------------------------------------------- |
| **Function URL**  | `https://ykmp5afxgjxivueicq3o3u7a340rqtsg.lambda-url.eu-west-2.on.aws/` |
| **Auth Type**     | `NONE`                                                                  |
| **Invoke Mode**   | `RESPONSE_STREAM`                                                       |
| **Creation Time** | `2025-12-15T09:12:04.988663654Z`                                        |
| **Last Modified** | `2025-12-15T09:12:04.988663654Z`                                        |

**Note:** The function uses `RESPONSE_STREAM` mode, which requires the handler to be wrapped with `awslambda.streamifyResponse()`.

## IAM Role

- **Role ARN**: `arn:aws:iam::307946679392:role/HelpmatonStagingPR5-Role-j6Oo0rG0pwpM`
- **Role Name**: `HelpmatonStagingPR5-Role-j6Oo0rG0pwpM`

## VPC Configuration

- **VPC**: Not configured (no VPC)
- **Subnets**: None
- **Security Groups**: None

## Environment Variables

The function has the following environment variables configured:

- `ARC_ROLE`: IAM role name
- `ARC_APP_NAME`: Application name
- `ARC_STACK_NAME`: CloudFormation stack name
- `ARC_ENV`: Environment (`staging`)
- `ARC_STATIC_BUCKET`: S3 bucket for static assets
- `ARC_SESSION_TABLE_NAME`: DynamoDB session table name
- `BASE_URL`: Base URL for the application
- `FRONTEND_URL`: Frontend URL
- `HELPMATON_CUSTOM_DOMAIN`: Custom domain
- `HELPMATON_S3_BUCKET`: S3 bucket for workspace documents
- `HELPMATON_S3_REGION`: S3 region
- `HELPMATON_S3_ACCESS_KEY_ID`: S3 access key
- `HELPMATON_S3_SECRET_ACCESS_KEY`: S3 secret key
- `AUTH_SECRET`: Authentication secret
- `SENTRY_DSN`: Sentry error tracking DSN
- `OPENROUTER_API_KEY`: OpenRouter API key
- `GEMINI_API_KEY`: (Optional) Google Gemini API key for pricing/model updates
- `GOOGLE_OAUTH_CLIENT_ID`: Google OAuth client ID
- `GOOGLE_OAUTH_CLIENT_SECRET`: Google OAuth client secret
- `OUTLOOK_CLIENT_ID`: Outlook OAuth client ID
- `OUTLOOK_CLIENT_SECRET`: Outlook OAuth client secret
- `OAUTH_REDIRECT_BASE_URL`: OAuth redirect base URL
- `MAILGUN_KEY`: Mailgun API key
- `MAILGUN_DOMAIN`: Mailgun domain
- `DISCORD_BOT_TOKEN`: Discord bot token
- `DISCORD_PUBLIC_KEY`: Discord public key
- `DISCORD_TRIAL_CREDIT_CHANNEL_ID`: Discord channel ID
- `DISCORD_CS_USERS`: Discord customer support users
- `CLOUDFLARE_TURNSTILE_SECRET_KEY`: Cloudflare Turnstile secret
- `AWS_CERTIFICATE_ARN`: ACM certificate ARN
- `AWS_ZONE_ID`: Route53 zone ID
- `ENABLE_CREDIT_DEDUCTION`: Credit deduction flag
- `ENABLE_CREDIT_VALIDATION`: Credit validation flag
- `ENABLE_SPENDING_LIMIT_CHECKS`: Spending limit checks flag
- `RESTRICT_LOGIN_TO_WHITELIST`: Login whitelist restriction flag

## Logging Configuration

- **Log Format**: `Text`
- **Log Group**: `/aws/lambda/HelpmatonStagingPR5-AnyApiStreamsWorkspaceIdAgentI-4dODUr7Z2zdv`
- **Tracing Mode**: `PassThrough`

## Ephemeral Storage

- **Size**: `512 MB`

## SnapStart

- **Apply On**: `None`
- **Optimization Status**: `Off`

## Current Status

### Configuration Status

- ✅ **State**: Active
- ✅ **Last Update Status**: Successful
- ✅ **Package Type**: Image (correctly configured)
- ✅ **ImageConfig**: Command and WorkingDirectory set
- ⚠️ **EntryPoint**: Not explicitly set (uses base image default)

### Known Issues

1. **Runtime.InvalidEntrypoint / ProcessSpawnFailed Error**

   - **Status**: Currently experiencing this error
   - **Error Message**: `RequestId: <id> Error: ProcessSpawnFailed`
   - **Possible Causes**:
     - Handler path resolution issue
     - Missing EntryPoint in ImageConfig (AWS may require all three properties)
     - Handler file not accessible at the specified path
     - Handler module fails to load (e.g., `awslambda` not available during INIT)

2. **Handler Path Format**
   - Current: `http/any-api-streams-000workspaceId-000agentId-000secret/index.handler`
   - This should resolve to: `/var/task/http/any-api-streams-000workspaceId-000agentId-000secret/index.js` with export `handler`

## Handler Implementation

The handler is located at:

- **Path**: `apps/backend/src/http/any-api-streams-000workspaceId-000agentId-000secret/index.ts`
- **Compiled Path**: `apps/backend/dist/http/any-api-streams-000workspaceId-000agentId-000secret/index.js`
- **Handler Export**: `export const handler = awslambda.streamifyResponse(internalHandler)`

**Important Notes:**

- The handler uses `awslambda.streamifyResponse()` for RESPONSE_STREAM mode
- The handler calls `streamifyResponse` at module load time, which requires `awslambda` to be available
- The compiled file is ~11MB (bundled with dependencies)

## Docker Image Details

### Dockerfile Location

- `apps/backend/docker/lancedb/Dockerfile`

### Runtime Additions

- The `lancedb` image now includes DuckDB for in-memory analytics. Lambda handlers can use `apps/backend/src/utils/duckdb/duckdbClient.ts` to create an in-memory DuckDB instance that installs/loads the `httpfs` extension for querying S3-backed data sources (Parquet/CSV).

### Build Process

1. Base image: `public.ecr.aws/lambda/nodejs:20`
2. Installs system dependencies (python3, make, gcc-c++, git)
3. Installs pnpm and dependencies
4. Copies compiled code from `apps/backend/dist/` to `/var/task/`
5. Verifies handler file exists and entrypoint is executable

### Verification Steps in Dockerfile

- Verifies `/lambda-entrypoint.sh` exists and is executable
- Verifies handler file exists at expected path
- Lists file structure for debugging

## Deployment Configuration

The function is configured via the `container-images` Architect plugin:

- **Plugin**: `apps/backend/src/plugins/container-images/index.js`
- **Configuration**: Set via `@container-images` pragma in `app.arc`
- **Route**: `any /api/streams/:workspaceId/:agentId/:secret`
- **Image Name**: `lancedb`

## Recommendations

1. **Set EntryPoint Explicitly**: Even though the base image has a default ENTRYPOINT, AWS Lambda may require all three ImageConfig properties to be explicitly set when ImageConfig is present.

2. **Verify Handler Path**: Ensure the handler file exists at the specified path in the container image.

3. **Test Handler Loading**: Verify that the handler module can be loaded without errors (check for `awslambda` availability).

4. **Check Build Logs**: Review Docker build logs to ensure the handler file is copied correctly and the entrypoint verification passes.

## Related Documentation

- [AWS Lambda Container Images](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html)
- [Lambda Container Image Configuration](https://docs.aws.amazon.com/lambda/latest/api/API_ImageConfig.html)
- [Node.js Container Image](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-image.html)
- [Lambda Function URLs](https://docs.aws.amazon.com/lambda/latest/dg/lambda-urls.html)
