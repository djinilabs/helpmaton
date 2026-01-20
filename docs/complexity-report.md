# Function Complexity Report

Generated: 2026-01-20T12:54:49.490Z

## Summary

- Total functions analyzed: 9559
- Functions with complexity >= 2: 2631

## Top 10 most complex functions

| Rank | Complexity | Function | Location |
| --- | --- | --- | --- |
| 1 | 170 | <anonymous> | apps/frontend/src/pages/AgentDetail.tsx:344 |
| 2 | 127 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:369 |
| 3 | 73 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:171 |
| 4 | 70 | importWorkspace | apps/backend/src/utils/workspaceImport.ts:150 |
| 5 | 63 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/put-mcp-server.ts:98 |
| 6 | 63 | callAgentNonStreaming | apps/backend/src/http/utils/agentCallNonStreaming.ts:60 |
| 7 | 62 | <anonymous> | apps/frontend/src/components/PlanComparison.tsx:17 |
| 8 | 61 | aggregateTokenUsageForDate | apps/backend/src/scheduled/aggregate-token-usage/index.ts:20 |
| 9 | 60 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/__tests__/post-generate-prompt.test.ts:92 |
| 10 | 60 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/post-generate-prompt.ts:92 |

## How to run

`pnpm complexity:report`

Options:
- `--top <number>`: limit list size (default 10)
- `--out <path>`: output path (default docs/complexity-report.md)

