import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  runStatements,
  databasePaths,
  connectCalls,
  mockConnection,
  MockDatabase,
} = vi.hoisted(() => {
  const runStatements: string[] = [];
  const databasePaths: string[] = [];
  const connectCalls = { value: 0 };
  const mockRun = vi.fn(function run(
    sql: string,
    callback?: (error: Error | null) => void,
  ) {
    runStatements.push(sql);
    callback?.(null);
  });
  const mockAll = vi.fn(function all(
    _sql: string,
    callback?: (error: Error | null, rows: unknown[]) => void,
  ) {
    callback?.(null, []);
  });
  const mockConnection = {
    run: mockRun,
    all: mockAll,
    close: vi.fn(function close(callback?: (error: Error | null) => void) {
      callback?.(null);
    }),
  };

  class MockDatabase {
    constructor(path: string) {
      databasePaths.push(path);
    }

    connect() {
      connectCalls.value += 1;
      return mockConnection;
    }

    close(callback?: (error: Error | null) => void) {
      callback?.(null);
    }
  }

  return {
    runStatements,
    databasePaths,
    connectCalls,
    mockConnection,
    MockDatabase,
  };
});

vi.mock("duckdb", () => ({
  default: {
    Database: MockDatabase,
  },
  Database: MockDatabase,
}));

import { createInMemoryDuckDb } from "../duckdbClient";

describe("createInMemoryDuckDb", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runStatements.length = 0;
    databasePaths.length = 0;
    connectCalls.value = 0;
    delete process.env.ARC_ENV;
    delete process.env.HELPMATON_S3_ACCESS_KEY_ID;
    delete process.env.HELPMATON_S3_SECRET_ACCESS_KEY;
    delete process.env.HELPMATON_S3_REGION;
    delete process.env.HELPMATON_S3_ENDPOINT;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_REGION;
    delete process.env.AWS_SESSION_TOKEN;
  });

  it("configures httpfs for local testing mode", async () => {
    process.env.ARC_ENV = "testing";

    await createInMemoryDuckDb();

    expect(databasePaths).toEqual([":memory:"]);
    expect(connectCalls.value).toBe(1);
    expect(mockConnection.run).toHaveBeenCalled();
    expect(runStatements).toEqual([
      "INSTALL httpfs;",
      "LOAD httpfs;",
      "SET s3_region='eu-west-2';",
      "SET s3_access_key_id='S3RVER';",
      "SET s3_secret_access_key='S3RVER';",
      "SET s3_endpoint='http://localhost:4568';",
      "SET s3_url_style='path';",
      "SET s3_use_ssl=false;",
    ]);
  });

  it("configures httpfs with provided credentials", async () => {
    process.env.ARC_ENV = "production";
    process.env.HELPMATON_S3_ACCESS_KEY_ID = "ACCESS_KEY";
    process.env.HELPMATON_S3_SECRET_ACCESS_KEY = "SECRET_KEY";
    process.env.HELPMATON_S3_REGION = "us-east-1";

    await createInMemoryDuckDb();

    expect(runStatements).toEqual([
      "INSTALL httpfs;",
      "LOAD httpfs;",
      "SET s3_region='us-east-1';",
      "SET s3_access_key_id='ACCESS_KEY';",
      "SET s3_secret_access_key='SECRET_KEY';",
    ]);
  });
});
