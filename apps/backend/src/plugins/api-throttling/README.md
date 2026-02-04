# API Throttling Plugin

This Architect plugin configures API Gateway usage plans and a Lambda authorizer for per-workspace API throttling based on subscription plans.

## Overview

The plugin:

1. Creates usage plans for each subscription tier (free, starter, pro)
2. Configures a Lambda authorizer that extracts workspace ID from request paths
3. Associates API keys (created per subscription) with usage plans
4. Applies throttling limits to all `/api/*` routes (except `/api/auth/*` and `/api/authorizer`)

## Configuration

Add the `@api-throttling` pragma to `app.arc`:

```arc
@api-throttling
free
  rateLimit 100
  burstLimit 200
starter
  rateLimit 500
  burstLimit 1000
pro
  rateLimit 2000
  burstLimit 4000

@plugins
plugin-typescript
s3
http-to-rest
api-throttling
custom-domain
```

**Important**: The `api-throttling` plugin must come **after** `http-to-rest` to work with REST API resources.

## How It Works

### Request Flow

1. Request arrives at API Gateway: `POST /api/webhook/:workspaceId/:agentId/:key`
2. API Gateway invokes Lambda Authorizer
3. Authorizer extracts `workspaceId` from path
4. Authorizer queries database: workspace → subscription
5. Authorizer gets/creates API key for subscription
6. Authorizer returns API key ID as `usageIdentifierKey`
7. API Gateway applies throttling limits from associated usage plan
8. If within limits → forward to Lambda handler
9. If exceeded → return 429 Too Many Requests

### Usage Plans

Usage plans are created as CloudFormation resources:

- `UsagePlanFree` - Free tier limits
- `UsagePlanStarter` - Starter tier limits
- `UsagePlanPro` - Pro tier limits

Each plan defines:

- `RateLimit`: Requests per second
- `BurstLimit`: Maximum burst capacity

### API Keys

API keys are created dynamically (not in CloudFormation):

- One API key per subscription
- Key name: `subscription-{subscriptionId}`
- Keys are associated with usage plans via AWS SDK

### Authorizer

The Lambda authorizer (`any-api-authorizer`):

- Extracts workspace ID from request path
- Looks up subscription from workspace
- Returns API key ID for throttling
- Must be configured before the plugin runs

## Subscription Management

When subscriptions are created/upgraded/downgraded, call:

```typescript
import { associateSubscriptionWithPlan } from "../utils/apiGatewayUsagePlans";

// On subscription create/update
await associateSubscriptionWithPlan(subscriptionId, "pro");
```

## Environment Variables

The authorizer Lambda function requires:

- `API_GATEWAY_REST_API_ID` - REST API ID (set automatically)
- `USAGE_PLAN_FREE_ID` - Free plan ID (set automatically)
- `USAGE_PLAN_STARTER_ID` - Starter plan ID (set automatically)
- `USAGE_PLAN_PRO_ID` - Pro plan ID (set automatically)

## IAM Permissions

The authorizer and subscription management functions require:

```json
{
  "Effect": "Allow",
  "Action": [
    "apigateway:GET",
    "apigateway:POST",
    "apigateway:PUT",
    "apigateway:DELETE",
    "apigateway:PATCH"
  ],
  "Resource": [
    "arn:aws:apigateway:*::/usageplans/*",
    "arn:aws:apigateway:*::/apikeys/*",
    "arn:aws:apigateway:*::/usageplans/*/keys/*"
  ]
}
```

## Troubleshooting

### Authorizer Not Invoked

- Check that methods have `AuthorizationType: CUSTOM`
- Verify authorizer resource exists in CloudFormation
- Check Lambda function permissions

### Throttling Not Working

- Verify API keys are associated with usage plans
- Check usage plan IDs in environment variables
- Verify usage plan is associated with the correct API stage

### 401 Errors

- Check authorizer Lambda logs
- Verify workspace has a subscription
- Check database connectivity
