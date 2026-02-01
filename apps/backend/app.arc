@app
helpmaton

@static
spa true

@http
post /api/webhooks/lemonsqueezy
post /api/webhook/:workspaceId/:agentId/:key
post /api/widget/:workspaceId/:agentId/:key
post /api/scrape
get /api/usage
get /api/usage/daily
get /api/models
get /api/version
get /api/health
get /api/pricing
get /api/stream-url
any /api/discord
any /api/auth
any /api/auth/*
any /api/email/oauth/:provider/callback
any /api/mcp/oauth/:serviceType/callback
any /api/subscription
any /api/subscription/*
any /api/user/*
any /api/workspaces
any /api/workspaces/*
any /api/authorizer
any /api/streams/*
any /api/webhooks/:type/:workspaceId/:integrationId
any /*

@tables

next-auth
  pk *String
  sk **String
  expires TTL
  encrypt true

workspace
  pk *String
  sk **String
  encrypt true

permission
  pk *String
  sk **String
  resourceType String
  parentPk String
  type Number
  encrypt true

agent
  pk *String
  sk **String
  encrypt true

agent-key
  pk *String
  sk **String
  encrypt true

workspace-api-key
  pk *String
  sk **String
  encrypt true

workspace-document
  pk *String
  sk **String
  encrypt true

output_channel
  pk *String
  sk **String
  encrypt true

email-connection
  pk *String
  sk **String
  encrypt true

mcp-server
  pk *String
  sk **String
  encrypt true

trial-credit-requests
  pk *String
  sk **String
  encrypt true

subscription
  pk *String
  sk **String
  encrypt true

request-buckets
  pk *String
  expires TTL
  encrypt true

workspace-invite
  pk *String
  sk **String
  expires TTL
  encrypt true

agent-stream-servers
  pk *String
  sk **String
  encrypt true

user-api-key
  pk *String
  sk **String
  encrypt true

user-refresh-token
  pk *String
  sk **String
  encrypt true

workspace-credit-transactions
  pk *String
  sk **String
  expires TTL
  encrypt true

agent-conversations
  pk *String
  expires TTL

credit-reservations
  pk *String
  expires TTL

token-usage-aggregates
  pk *String
  sk **String

tool-usage-aggregates
  pk *String
  sk **String

agent-delegation-tasks
  pk *String
  sk **String
  ttl TTL

bot-integration
  pk *String
  sk **String
  encrypt true

agent-eval-judge
  pk *String
  sk **String
  encrypt true

agent-eval-result
  pk *String
  sk **String

agent-schedule
  pk *String
  sk **String
  encrypt true

@tables-indexes

next-auth
  gsi1pk *String
  gsi1sk **String
  name GSI2

permission
  resourceType *String
  sk **String
  name byResourceTypeAndEntityId

agent
  workspaceId *String
  pk **String
  name byWorkspaceId

agent-key
  agentId *String
  pk **String
  name byAgentId

workspace
  subscriptionId *String
  pk **String
  name bySubscriptionId

workspace
  lemonSqueezyOrderId *String
  pk **String
  name byLemonSqueezyOrderId

workspace-api-key
  workspaceId *String
  pk **String
  name byWorkspaceId

subscription
  lemonSqueezySyncKey *String
  pk **String
  name byLemonSqueezySubscription

workspace-document
  workspaceId *String
  pk **String
  name byWorkspaceId

user-refresh-token
  tokenLookupHash *String
  pk **String
  name byTokenHash

user-api-key
  keyLookupHash *String
  pk **String
  name byKeyHash

output_channel
  workspaceId *String
  pk **String
  name byWorkspaceId

email-connection
  workspaceId *String
  pk **String
  name byWorkspaceId

mcp-server
  workspaceId *String
  pk **String
  name byWorkspaceId

agent-conversations
  agentId *String
  pk **String
  name byAgentId

agent-conversations
  agentId *String
  lastMessageAt **String
  name byAgentIdAndLastMessageAt

token-usage-aggregates
  workspaceId *String
  date **String
  name byWorkspaceIdAndDate

token-usage-aggregates
  agentId *String
  date **String
  name byAgentIdAndDate

token-usage-aggregates
  userId *String
  date **String
  name byUserIdAndDate

tool-usage-aggregates
  workspaceId *String
  date **String
  name byWorkspaceIdAndDate

tool-usage-aggregates
  agentId *String
  date **String
  name byAgentIdAndDate

tool-usage-aggregates
  userId *String
  date **String
  name byUserIdAndDate

subscription
  userId *String
  pk **String
  name byUserId

request-buckets
  subscriptionId *String
  categoryHourTimestamp **String
  name bySubscriptionIdAndCategoryAndHour

workspace-invite
  workspaceId *String
  pk **String
  name byWorkspaceId

credit-reservations
  expiresHour *Number
  expires **Number
  name byExpiresHour

credit-reservations
  workspaceId *String
  pk **String
  name byWorkspaceId

workspace-credit-transactions
  agentId *String
  sk **String
  name byAgentId

agent-delegation-tasks
  gsi1pk *String
  gsi1sk **String
  name byWorkspaceAndAgent

bot-integration
  workspaceId *String
  pk **String
  name byWorkspaceId

bot-integration
  agentId *String
  pk **String
  name byAgentId

agent-eval-judge
  agentId *String
  pk **String
  name byAgentId

agent-eval-result
  agentId *String
  pk **String
  name byAgentId

agent-eval-result
  conversationId *String
  pk **String
  name byConversationId

agent-schedule
  agentId *String
  createdAt **String
  name byAgentId

agent-schedule
  duePartition *String
  nextRunAt **Number
  name byNextRunAt

@scheduled
aggregate-token-usage rate(1 day)
cleanup-expired-reservations rate(10 minutes)
sync-lemonsqueezy-subscriptions rate(1 hour)
summarize-memory-daily rate(1 day)
summarize-memory-weekly rate(7 days)
summarize-memory-monthly rate(30 days)
summarize-memory-quarterly rate(90 days)
summarize-memory-yearly rate(365 days)
cleanup-memory-retention rate(1 day)
run-agent-schedules rate(1 minute)

@queues
agent-temporal-grain-queue
  timeout 660
  fifo true
  visibilityTimeout 1320
  messageRetentionPeriod 1209600
openrouter-cost-verification-queue
  timeout 660
  visibilityTimeout 1320
  messageRetentionPeriod 1209600
agent-delegation-queue
  timeout 900
  visibilityTimeout 1800
bot-webhook-queue
  timeout 900
  visibilityTimeout 1800
  messageRetentionPeriod 1209600
webhook-queue
  timeout 900
  visibilityTimeout 1800
  messageRetentionPeriod 1209600
agent-eval-queue
  timeout 900
  visibilityTimeout 1800
  messageRetentionPeriod 1209600
agent-schedule-queue
  timeout 900
  visibilityTimeout 1800
  messageRetentionPeriod 1209600

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

@lambda-urls
any /api/streams/*
post /api/scrape

@container-images
# Format: method route image-name [group-name]
# Example: any /api/streams/* my-custom-image
any /api/streams/* lancedb llm-shared-stream
post /api/webhook/:workspaceId/:agentId/:key lancedb llm-shared-http
post /api/scrape puppeteer
any /api/workspaces lancedb llm-shared-http
any /api/workspaces/* lancedb llm-shared-http

scheduled summarize-memory-daily lancedb llm-shared-http
scheduled summarize-memory-weekly lancedb llm-shared-http
scheduled summarize-memory-monthly lancedb llm-shared-http
scheduled summarize-memory-quarterly lancedb llm-shared-http
scheduled summarize-memory-yearly lancedb llm-shared-http
scheduled cleanup-memory-retention lancedb llm-shared-http

queue agent-temporal-grain-queue lancedb llm-shared-http
queue agent-delegation-queue lancedb llm-shared-http
queue bot-webhook-queue lancedb llm-shared-http
queue agent-schedule-queue lancedb llm-shared-http
queue agent-eval-queue lancedb llm-shared-http
queue webhook-queue lancedb llm-shared-http

@plugins
architect/plugin-typescript
s3
http-to-rest
api-throttling
custom-domain
lambda-urls
container-images
sqs-partial-batch-failures
enable-scheduled-rules

@aws
runtime typescript
region eu-west-2
timeout 900

@typescript
build dist
base-runtime nodejs20.x
esbuild-config ../../esbuild-config.cjs

