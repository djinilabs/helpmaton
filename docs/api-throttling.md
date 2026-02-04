# API Throttling

This document explains how API throttling works in Helpmaton, including rate limits, burst limits, and subscription plan differences.

## Overview

API throttling limits the number of requests per second based on subscription plans. This prevents abuse and ensures fair resource usage across all users.

## How It Works

### Request Flow

```
Request arrives at API Gateway
    │
    ▼
Lambda Authorizer invoked
    │
    ├─ Extract workspaceId from path
    ├─ Look up subscription
    ├─ Get/create API key for subscription
    └─ Return API key ID as usageIdentifierKey
    │
    ▼
API Gateway applies throttling
    │
    ├─ Check rate limit (requests/second)
    ├─ Check burst limit (concurrent requests)
    └─ Apply usage plan limits
    │
    ├─ Exceeded → 429 Too Many Requests
    └─ OK → Forward to Lambda handler
```

### Usage Plans

Usage plans define throttling limits for each subscription tier:

- **Free Plan**: 100 req/s, 200 burst
- **Starter Plan**: 500 req/s, 1000 burst
- **Pro Plan**: 2000 req/s, 4000 burst

### API Keys

Each subscription has an associated API Gateway API key:

- **One key per subscription**: Automatically created/managed
- **Key name**: `subscription-{subscriptionId}`
- **Association**: Key is associated with usage plan
- **Dynamic creation**: Keys created via AWS SDK (not CloudFormation)

## Rate Limits

### Free Plan

- **Rate Limit**: 100 requests per second
- **Burst Limit**: 200 requests
- **Use Case**: Personal projects, testing

### Starter Plan

- **Rate Limit**: 500 requests per second
- **Burst Limit**: 1000 requests
- **Use Case**: Small teams, moderate usage

### Pro Plan

- **Rate Limit**: 2000 requests per second
- **Burst Limit**: 4000 requests
- **Use Case**: High-volume applications, production use

## Burst Limits

Burst limits control the maximum number of concurrent requests:

- **Free**: 200 concurrent requests
- **Starter**: 1000 concurrent requests
- **Pro**: 4000 concurrent requests

Burst capacity allows temporary spikes above the rate limit.

## Throttling Implementation

### Lambda Authorizer

The Lambda authorizer (`any-api-authorizer`) extracts workspace ID and returns API key ID:

```typescript
// Extract workspaceId from request path
const workspaceId = extractWorkspaceId(event);

// Look up subscription
const subscription = await getSubscription(workspaceId);

// Get/create API key
const apiKeyId = await getOrCreateApiKey(subscriptionId);

// Return API key ID for throttling
return {
  usageIdentifierKey: apiKeyId,
  // ... other context
};
```

### Usage Plan Association

API keys are associated with usage plans:

```typescript
// Associate subscription with usage plan
await associateSubscriptionWithPlan(subscriptionId, plan);
```

This creates/updates the association between the API key and usage plan.

### Throttling Application

API Gateway automatically applies throttling:

1. Request arrives with API key ID
2. API Gateway looks up usage plan for the key
3. Checks current rate and burst
4. Applies throttling limits
5. Returns 429 if exceeded, forwards if OK

## Excluded Routes

Some routes are excluded from throttling:

- `/api/auth/*` - Authentication endpoints
- `/api/authorizer` - Authorizer endpoint itself

These routes need to be accessible even when throttled.

## Error Responses

### 429 Too Many Requests

When rate limit is exceeded:

```json
{
  "message": "Too Many Requests"
}
```

**Headers**:

```
Retry-After: 1
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1234567890
```

### Handling 429 Responses

**Exponential Backoff**:

```typescript
async function makeRequestWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get("Retry-After") || "1");
        await sleep(retryAfter * 1000 * Math.pow(2, i));
        continue;
      }
      return response;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(1000 * Math.pow(2, i));
    }
  }
}
```

## Monitoring

### CloudWatch Metrics

API Gateway provides metrics:

- `Count`: Number of requests
- `4XXError`: Client errors (including 429)
- `5XXError`: Server errors
- `Latency`: Request latency

### Usage Tracking

Track API usage:

- Monitor 429 responses
- Track request counts per subscription
- Alert on high error rates

## Best Practices

### For Users

1. **Respect rate limits**: Implement retry logic with exponential backoff
2. **Monitor usage**: Track request counts and error rates
3. **Upgrade if needed**: Upgrade plan if hitting limits frequently
4. **Optimize requests**: Batch requests when possible

### For Developers

1. **Handle 429 errors**: Implement proper error handling
2. **Retry logic**: Use exponential backoff for retries
3. **Rate limit headers**: Respect `Retry-After` header
4. **Caching**: Cache responses to reduce API calls

## Configuration

### Usage Plans

Usage plans are defined in `app.arc`:

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
```

### Plugin Order

The `api-throttling` plugin must come **after** `http-to-rest`:

```arc
@plugins
plugin-typescript
s3
http-to-rest
api-throttling  # Must come after http-to-rest
custom-domain
lambda-urls
```

## Subscription Management

When subscriptions are created/updated:

```typescript
import { associateSubscriptionWithPlan } from "../utils/apiGatewayUsagePlans";

// On subscription create/update
await associateSubscriptionWithPlan(subscriptionId, "pro");
```

This ensures the API key is associated with the correct usage plan.

## Troubleshooting

### Throttling Not Working

- Verify usage plans are created in CloudFormation
- Check API keys are associated with usage plans
- Verify authorizer is returning API key ID
- Check usage plan IDs in environment variables

### 429 Errors Unexpected

- Check current subscription plan
- Verify rate limits match plan
- Monitor request patterns
- Check for burst spikes

### Authorizer Not Invoked

- Verify methods have `AuthorizationType: CUSTOM`
- Check authorizer resource exists in CloudFormation
- Verify Lambda function permissions
- Check authorizer configuration

## API Reference

See [API Reference](./api-reference.md) for complete endpoint documentation.

## Related Documentation

- [Subscription Management](./subscription-management.md) - Subscription plans and limits
- [Architecture](./architecture.md) - System architecture
- [Deployment](./deployment.md) - Deployment configuration
