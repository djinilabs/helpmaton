import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  runStatements,
  queryRows,
  mockConnection,
  mockInstance,
  sendCalls,
  sendError,
} = vi.hoisted(() => {
  const runStatements: string[] = [];
  const queryRows = { value: [] as unknown[] };
  const sendCalls: unknown[] = [];
  const sendError = { value: null as Error | null };

  const mockReader = {
    readAll: vi.fn(async () => undefined),
    getRowObjectsJson: vi.fn(() => queryRows.value),
  };

  const mockConnection = {
    run: vi.fn(async (sql: string) => {
      runStatements.push(sql);
      return undefined;
    }),
    runAndReadAll: vi.fn(async (sql: string) => {
      runStatements.push(sql);
      return mockReader;
    }),
    close: vi.fn(async () => undefined),
    closeSync: vi.fn(() => undefined),
  };

  const mockInstance = {
    connect: vi.fn(async () => mockConnection),
    closeSync: vi.fn(() => undefined),
  };

  return {
    runStatements,
    queryRows,
    mockConnection,
    mockInstance,
    sendCalls,
    sendError,
  };
});

vi.mock("@duckdb/node-api", () => ({
  DuckDBInstance: {
    create: vi.fn(async () => mockInstance),
  },
}));

vi.mock("@aws-sdk/client-s3", () => {
  class HeadObjectCommand {
    input: { Bucket: string; Key: string };
    constructor(input: { Bucket: string; Key: string }) {
      this.input = input;
    }
  }

  class S3Client {
    send = vi.fn(async (command: HeadObjectCommand) => {
      sendCalls.push(command);
      if (sendError.value) {
        throw sendError.value;
      }
      return {};
    });
  }

  return { S3Client, HeadObjectCommand };
});

vi.mock("../../vectordb/config", () => ({
  getS3BucketName: () => "vectordb.bucket",
}));

import { createGraphDb } from "../graphDb";

describe("createGraphDb", () => {
  beforeEach(() => {
    runStatements.length = 0;
    sendCalls.length = 0;
    sendError.value = null;
    queryRows.value = [];
    vi.clearAllMocks();
    delete process.env.ARC_ENV;
    delete process.env.HELPMATON_S3_ACCESS_KEY_ID;
    delete process.env.HELPMATON_S3_SECRET_ACCESS_KEY;
    delete process.env.HELPMATON_S3_REGION;
    delete process.env.HELPMATON_S3_ENDPOINT;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_REGION;
  });

  it("loads facts from parquet when the object exists", async () => {
    process.env.ARC_ENV = "production";
    process.env.HELPMATON_S3_ACCESS_KEY_ID = "ACCESS_KEY";
    process.env.HELPMATON_S3_SECRET_ACCESS_KEY = "SECRET_KEY";
    process.env.HELPMATON_S3_REGION = "us-east-1";

    await createGraphDb("workspace-1", "agent-1");

    expect(
      runStatements.some((statement) =>
        statement.startsWith("SET home_directory="),
      ),
    ).toBe(true);
    expect(runStatements).toContain("INSTALL httpfs;");
    expect(runStatements).toContain("LOAD httpfs;");
    expect(runStatements).toContain("INSTALL duckpgq FROM community;");
    expect(runStatements).toContain("LOAD duckpgq;");
    expect(runStatements).toContain(
      "CREATE SECRET (TYPE S3, KEY_ID 'ACCESS_KEY', SECRET 'SECRET_KEY', REGION 'us-east-1');",
    );
    expect(runStatements).toContain(
      "CREATE TABLE facts AS SELECT * FROM read_parquet('s3://vectordb.bucket/graphs/workspace-1/agent-1/facts.parquet');",
    );
    expect(runStatements).toContain(
      "CREATE PROPERTY GRAPH facts_graph VERTEX TABLES ( nodes ) EDGE TABLES ( facts SOURCE KEY ( source_id ) REFERENCES nodes ( id ) DESTINATION KEY ( target_id ) REFERENCES nodes ( id ) LABEL label );",
    );
  });

  it("bootstraps facts when parquet is missing", async () => {
    sendError.value = Object.assign(new Error("NotFound"), {
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    });
    process.env.ARC_ENV = "production";
    process.env.HELPMATON_S3_ACCESS_KEY_ID = "ACCESS_KEY";
    process.env.HELPMATON_S3_SECRET_ACCESS_KEY = "SECRET_KEY";

    await createGraphDb("workspace-2", "agent-2");

    expect(runStatements).toContain(
      "CREATE TABLE facts (id VARCHAR PRIMARY KEY, source_id VARCHAR, target_id VARCHAR, label VARCHAR, properties JSON);",
    );
  });

  it("executes CRUD operations and saves parquet", async () => {
    process.env.ARC_ENV = "production";
    process.env.HELPMATON_S3_ACCESS_KEY_ID = "ACCESS_KEY";
    process.env.HELPMATON_S3_SECRET_ACCESS_KEY = "SECRET_KEY";

    const graphDb = await createGraphDb("workspace-3", "agent-3");

    await graphDb.insertFacts([
      {
        id: "fact-1",
        source_id: "node-a",
        target_id: "node-b",
        label: "knows",
        properties: { confidence: 0.9 },
      },
    ]);
    await graphDb.updateFacts({ id: "fact-1" }, { label: "likes" });
    await graphDb.deleteFacts({ id: "fact-1" });
    queryRows.value = [{ start: "node-a", end: "node-b" }];
    const rows = await graphDb.queryGraph(
      "FROM GRAPH_TABLE (facts_graph MATCH (a)-[e]->(b) COLUMNS (a.id AS start, b.id AS end));",
    );
    await graphDb.save();
    await graphDb.close();

    expect(rows).toEqual([{ start: "node-a", end: "node-b" }]);
    expect(runStatements).toContain(
      "INSERT INTO facts (id, source_id, target_id, label, properties) VALUES ('fact-1', 'node-a', 'node-b', 'knows', CAST('{\"confidence\":0.9}' AS JSON));",
    );
    expect(runStatements).toContain(
      "UPDATE facts SET label = 'likes' WHERE id = 'fact-1';",
    );
    expect(runStatements).toContain("DELETE FROM facts WHERE id = 'fact-1';");
    expect(runStatements).toContain(
      "COPY facts TO 's3://vectordb.bucket/graphs/workspace-3/agent-3/facts.parquet' (FORMAT PARQUET, OVERWRITE 1);",
    );
    expect(mockConnection.closeSync).toHaveBeenCalledTimes(1);
    expect(mockInstance.closeSync).toHaveBeenCalledTimes(1);
  });
});
