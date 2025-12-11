@app
helpmaton

@static
spa true

@http
post /api/webhook/:workspaceId/:agentId/:key
get /api/usage
get /api/models
get /api/streams/url
any /api/discord
any /api/auth
any /api/auth/*
any /api/email/oauth/:provider/callback
any /api/subscription
any /api/subscription/*
any /api/user/*
any /api/workspaces
any /api/workspaces/*
any /api/authorizer
any /api/streams/:workspaceId/:agentId/:secret
any /*

@tables

next-auth
  pk *String
  sk **String
  expires TTL
  encrypt true

webhook-logs
  pk *String
  sk **String
  expires TTL

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

llm-request-buckets
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

agent-conversations
  pk *String
  expires TTL

credit-reservations
  pk *String
  expires TTL

token-usage-aggregates
  pk *String
  sk **String

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

workspace-api-key
  workspaceId *String
  pk **String
  name byWorkspaceId

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

subscription
  userId *String
  pk **String
  name byUserId

llm-request-buckets
  subscriptionId *String
  hourTimestamp **String
  name bySubscriptionIdAndHour

workspace-invite
  workspaceId *String
  pk **String
  name byWorkspaceId

credit-reservations
  expiresHour *Number
  expires **Number
  name byExpiresHour

@scheduled
aggregate-token-usage rate(1 day)
cleanup-expired-reservations rate(10 minutes)

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
any /api/streams/:workspaceId/:agentId/:secret

@plugins
architect/plugin-typescript
s3
http-to-rest
api-throttling
custom-domain
lambda-urls

@aws
runtime typescript
region eu-west-2
timeout 60

@typescript
build dist
base-runtime nodejs20.x
esbuild-config ../../esbuild-config.cjs

