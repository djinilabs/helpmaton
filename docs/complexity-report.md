# Function Complexity Report

Generated: 2026-01-20T12:41:19.040Z

## Summary

- Total functions analyzed: 9538
- Functions with complexity >= 2: 2617

## Top 10 most complex functions

| Rank | Complexity | Function | Location |
| --- | --- | --- | --- |
| 1 | 170 | <anonymous> | apps/frontend/src/pages/AgentDetail.tsx:344 |
| 2 | 127 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:369 |
| 3 | 73 | callAgentInternal | apps/backend/src/http/utils/call-agent-internal.ts:285 |
| 4 | 73 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:171 |
| 5 | 72 | <anonymous> | apps/backend/src/http/any-api-streams-catchall/index.ts:88 |
| 6 | 70 | importWorkspace | apps/backend/src/utils/workspaceImport.ts:150 |
| 7 | 63 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/put-mcp-server.ts:98 |
| 8 | 63 | callAgentNonStreaming | apps/backend/src/http/utils/agentCallNonStreaming.ts:60 |
| 9 | 62 | <anonymous> | apps/frontend/src/components/PlanComparison.tsx:17 |
| 10 | 61 | aggregateTokenUsageForDate | apps/backend/src/scheduled/aggregate-token-usage/index.ts:20 |

## How to run

`pnpm complexity:report`

Options:
- `--top <number>`: limit list size (default 10)
- `--out <path>`: output path (default docs/complexity-report.md)

