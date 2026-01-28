# Graph Database (DuckDB + DuckPGQ)

This project uses DuckDB with the DuckPGQ extension as a lightweight graph
database. The graph data is stored as Parquet in S3, segmented per
`workspaceId` and `agentId`.

## Overview

- **Engine**: DuckDB via `@duckdb/node-api` + `@duckdb/node-bindings`
- **Graph layer**: DuckPGQ property graphs
- **Storage**: S3 Parquet files per workspace/agent
- **Table model**: Single `facts` edge table per graph database

## Files

- Graph DB wrapper: `apps/backend/src/utils/duckdb/graphDb.ts`
- Tests: `apps/backend/src/utils/duckdb/__tests__/graphDb.test.ts`
- Container image notes: `docs/lambda-container-configuration.md`

## Storage layout

Graph data is stored in the vector DB bucket, reusing the existing S3 resolver
in `apps/backend/src/utils/vectordb/config.ts`.

```
s3://<vectordb_bucket>/graphs/<workspaceId>/<agentId>/facts.parquet
```

## Facts schema

Each graph database contains a single `facts` table:

- `id` (text, primary key)
- `source_id` (text)
- `target_id` (text)
- `label` (text)
- `properties` (json)

The property graph (`facts_graph`) uses `facts` as the edge table and a derived
`nodes` view for vertices.

## Initialization flow

`createGraphDb(workspaceId, agentId)` performs:

1. `DuckDBInstance.create(':memory:')` and `instance.connect()`
2. `INSTALL/LOAD httpfs`
3. `INSTALL/LOAD duckpgq FROM community`
4. `CREATE SECRET (TYPE S3, KEY_ID, SECRET, REGION)` using the env vars below
5. Load `facts` from S3 Parquet if it exists, else create the table
6. Build the `nodes` view and `facts_graph` property graph

## Local vs production S3

- Local testing (`ARC_ENV=testing` or missing AWS credentials) uses the local
  s3rver endpoint: `http://localhost:4568` with `S3RVER` credentials and
  `s3_url_style='path'`.
- Production uses `HELPMATON_S3_*` or `AWS_*` credentials and optional
  `HELPMATON_S3_ENDPOINT`.

## Environment variables

- `HELPMATON_S3_ACCESS_KEY_ID` / `AWS_ACCESS_KEY_ID`
- `HELPMATON_S3_SECRET_ACCESS_KEY` / `AWS_SECRET_ACCESS_KEY`
- `HELPMATON_S3_SESSION_TOKEN` / `AWS_SESSION_TOKEN` (required for IAM role / temporary AWS credentials)
- `HELPMATON_S3_REGION` / `AWS_REGION`
- `HELPMATON_S3_ENDPOINT` (optional, supports local or custom S3 endpoints)
- `ARC_ENV` (local testing detection)

When running with IAM roles or other temporary AWS credentials, the access key,
secret, and session token are propagated into the DuckDB `httpfs` S3 secret.

## API surface

`createGraphDb()` returns:

- `insertFacts(rows)`
- `updateFacts(where, updates)`
- `deleteFacts(where)`
- `queryGraph(sql)` (DuckPGQ queries)
- `save()` (writes `facts` to the S3 Parquet path)
- `close()`

## Example usage

```ts
import { createGraphDb } from "@/utils/duckdb/graphDb";

const graphDb = await createGraphDb(workspaceId, agentId);

await graphDb.insertFacts([
  {
    id: "fact-1",
    source_id: "alice",
    target_id: "bob",
    label: "knows",
    properties: { since: "2024-01-01" },
  },
]);

const rows = await graphDb.queryGraph(`
  FROM GRAPH_TABLE (
    facts_graph
    MATCH (a)-[e]->(b)
    WHERE a.id = 'alice'
    COLUMNS (a.id AS start, b.id AS end, e.label AS relation)
  );
`);

await graphDb.save();
await graphDb.close();
```
