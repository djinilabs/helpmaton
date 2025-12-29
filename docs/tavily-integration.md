# Tavily Integration

This document describes the Tavily API integration for web search and content extraction in Helpmaton agents. Note: Agents can also use Jina.ai as an alternative provider for both search and fetch tools (free, no credits required).

## Overview

Tavily provides two tools for agents:

- **Web search**: Search the web for current information, news, articles, and other web content
- **Web fetch**: Extract and summarize content from specific web page URLs

Both tools require agent-level configuration to enable and are subject to daily rate limits and credit-based billing.

## Configuration

### Enabling Tavily Tools

To enable Tavily tools for an agent:

1. Navigate to the agent's detail page
2. Go to the "Web Search Tool" or "Web Fetch Tool" section
3. Toggle the switch to enable the desired tool
4. Save the configuration

### Environment Setup

The Tavily integration requires a system-wide API key:

- **Environment Variable**: `TAVILY_API_KEY`
- **Required**: Yes (for Tavily tools to function)
- **How to obtain**: 
  1. Go to [Tavily Dashboard](https://tavily.com)
  2. Sign up or log in to your account
  3. Navigate to API Keys section
  4. Create a new API key
  5. Copy the key value

See [Environment Variables](../apps/backend/ENV.md) for configuration details.

## Daily Limits

### Free Tier

- **Limit**: 10 Tavily API calls per 24 hours
- **Enforcement**: Requests are blocked once the limit is reached
- **Reset**: Rolling 24-hour window (not calendar day)

### Paid Tiers (Starter, Pro)

- **Free Allowance**: 10 calls per 24 hours (no charge)
- **Additional Calls**: $0.008 per call (requires workspace credits)
- **Enforcement**: 
  - First 10 calls: Free (no credit deduction)
  - Calls 11+: Require sufficient workspace credits

## Pricing

- **Cost per call**: $0.008 USD (8,000 millionths)
- **Billing**: Pay-as-you-go based on actual credits consumed
- **Credit System**: Uses the same credit system as LLM calls

### Credit Reservation Flow

1. **Reservation**: Credits are reserved before the API call (estimate: 1 Tavily API call ≈ 8,000 millionths = $0.008)
2. **API Call**: Tavily API is called and returns usage information
3. **Adjustment**: Credits are adjusted based on actual usage from API response
   - If actual usage < estimate: Difference is refunded
   - If actual usage = estimate: No adjustment needed
   - If actual usage > estimate: Additional credits are charged

## Tool Details

### Web Search Tool (`search_web`)

**Description**: Search the web for current information.

**Parameters**:
- `query` (string, required): The search query. Must be a non-empty string.
- `max_results` (number, optional): Maximum number of results to return (1-10, default: 5)

**Returns**: 
- Search results with titles, URLs, content snippets, and relevance scores
- Optional summary answer if available

**Cost**: $0.008 per call (first 10 calls/day free for paid tiers)

**Example**:
```json
{
  "query": "latest news about AI",
  "max_results": 5
}
```

### Web Fetch Tool (`fetch_url`)

**Description**: Extract and summarize content from a web page URL.

**Parameters**:
- `url` (string, required): The URL to extract content from. Must be a valid URL starting with http:// or https://

**Returns**:
- Extracted content, title, and metadata
- Optional images if available

**Cost**: $0.008 per call (first 10 calls/day free for paid tiers)

**Example**:
```json
{
  "url": "https://example.com/article"
}
```

## Error Handling

### Rate Limit Exceeded

When the daily limit is exceeded:
- **Free tier**: Returns error message with limit information
- **Paid tiers**: Returns error if insufficient credits for additional calls

### API Errors

- Tavily API errors are returned to the agent with the error message
- Reserved credits are automatically refunded on API errors
- Network errors are retried with exponential backoff (max 3 retries)

### Insufficient Credits

When a paid tier workspace exceeds the free limit and has insufficient credits:
- Error message includes current credit balance and required amount
- Request is blocked until credits are added to the workspace

## Usage Tracking

Tavily API calls are tracked per subscription using hourly buckets in the unified `request-buckets` table:

- **Tracking**: `request-buckets` table with categories "search" (for `search_web`) and "fetch" (for `fetch_url`)
- **Window**: Rolling 24-hour window
- **Granularity**: Hourly buckets with 25-hour TTL
- **Query**: Uses GSI `bySubscriptionIdAndCategoryAndHour` for efficient queries
- **Daily Limits**: Sums counts from both "search" and "fetch" categories to determine total Tavily usage
- **Entity Lookup**: Workspace ID is converted to subscription ID before tracking (subscription-based limits)

## Integration Points

### Agent Setup

Web tools are conditionally added to agents based on configuration:

- `searchWebProvider === "tavily"` → Adds `search_web` tool using Tavily
- `searchWebProvider === "jina"` → Adds `search_web` tool using Jina.ai (free)
- `enableTavilySearch === true` → Legacy field, migrates to `searchWebProvider === "tavily"`
- `enableTavilyFetch === true` → Adds `fetch_url` tool

### Agent Delegation

When agents delegate to other agents, Tavily tools are available if the target agent has them enabled.

### Frontend UI

- Toggle switches in agent detail page
- Tool information in Tools Help Dialog
- Daily limit and pricing information displayed

## Best Practices

1. **Use Search for Research**: Use `search_web` when you need to find current information or multiple sources
2. **Use Fetch for Specific Pages**: Use `fetch_url` when you have a specific URL and need its content
3. **Monitor Usage**: Track daily call counts to stay within free tier limits
4. **Credit Management**: Ensure sufficient credits for paid tier workspaces exceeding free limits
5. **Error Handling**: Handle rate limit and credit errors gracefully in agent prompts

## Troubleshooting

### Tool Not Available

- Check that the tool is enabled in agent configuration
- Verify `TAVILY_API_KEY` is set in environment variables
- Check agent detail page for tool status

### Rate Limit Errors

- Free tier: Wait for 24-hour window to reset or upgrade plan
- Paid tier: Add credits to workspace if exceeding free limit

### API Errors

- Check Tavily API status
- Verify API key is valid and has sufficient quota
- Review error messages in tool responses

## See Also

- [Agent Configuration Guide](./agent-configuration.md)
- [Credit System](./credit-system.md)
- [Environment Variables](../apps/backend/ENV.md)

