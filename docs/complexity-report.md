# Function Complexity Report

Generated: 2026-01-20T10:15:58.297Z

## Summary

- Total functions analyzed: 9402
- Functions with complexity >= 2: 2526

## Top 10 most complex functions

| Rank | Complexity | Function | Location |
| --- | --- | --- | --- |
| 1 | 172 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/put-workspace-agent.ts:99 |
| 2 | 170 | <anonymous> | apps/frontend/src/pages/AgentDetail.tsx:344 |
| 3 | 127 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:369 |
| 4 | 109 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/__tests__/put-workspace-agent.test.ts:46 |
| 5 | 108 | convertUIMessagesToModelMessages | apps/backend/src/http/utils/messageConversion.ts:400 |
| 6 | 102 | callAgentInternal | apps/backend/src/http/utils/agentUtils.ts:806 |
| 7 | 95 | processSlackTask | apps/backend/src/queues/bot-webhook-queue/index.ts:613 |
| 8 | 94 | convertAiSdkUIMessageToUIMessage | apps/backend/src/http/utils/messageConversion.ts:31 |
| 9 | 88 | <anonymous> | apps/backend/src/http/post-api-webhook-000workspaceId-000agentId-000key/index.ts:168 |
| 10 | 88 | <anonymous> | apps/backend/src/utils/handlingErrors.ts:22 |

## How to run

`pnpm complexity:report`

Options:
- `--top <number>`: limit list size (default 50)
- `--out <path>`: output path (default docs/complexity-report.md)

