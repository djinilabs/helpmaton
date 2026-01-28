import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  runStatements,
  databasePaths,
  connectCalls,
  closeErrors,
  closeCalls,
  mockRun,
  mockAll,
  mockConnection,
  MockDatabase,
} = vi.hoisted(() => {
  const runStatements: string[] = [];
  const databasePaths: string[] = [];
  const connectCalls = { value: 0 };
  const closeErrors = {
    connection: null as Error | null,
    database: null as Error | null,
  };
  const closeCalls = {
    connection: 0,
    database: 0,
  };
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
      closeCalls.connection += 1;
      callback?.(closeErrors.connection);
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
      closeCalls.database += 1;
      callback?.(closeErrors.database);
    }
  }

  return {
    runStatements,
    databasePaths,
    connectCalls,
    closeErrors,
    closeCalls,
    mockRun,
    mockAll,
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
    closeCalls.connection = 0;
    closeCalls.database = 0;
    closeErrors.connection = null;
    closeErrors.database = null;
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

  it("sets session token and custom endpoint for production", async () => {
    process.env.ARC_ENV = "production";
    process.env.HELPMATON_S3_ACCESS_KEY_ID = "ACCESS_KEY";
    process.env.HELPMATON_S3_SECRET_ACCESS_KEY = "SECRET_KEY";
    process.env.AWS_SESSION_TOKEN = "SESSION_TOKEN";
    process.env.HELPMATON_S3_ENDPOINT = "http://s3.example.test";

    await createInMemoryDuckDb();

    expect(runStatements).toEqual([
      "INSTALL httpfs;",
      "LOAD httpfs;",
      "SET s3_region='eu-west-2';",
      "SET s3_access_key_id='ACCESS_KEY';",
      "SET s3_secret_access_key='SECRET_KEY';",
      "SET s3_session_token='SESSION_TOKEN';",
      "SET s3_endpoint='http://s3.example.test';",
      "SET s3_use_ssl=false;",
    ]);
  });

  it("exposes run/all/close helpers", async () => {
    const client = await createInMemoryDuckDb();

    await client.run("SELECT 1;");
    await client.all("SELECT 1;");
    await client.close();

    expect(mockRun).toHaveBeenCalledWith("SELECT 1;", expect.any(Function));
    expect(mockAll).toHaveBeenCalledWith("SELECT 1;", expect.any(Function));
    expect(closeCalls.connection).toBe(1);
    expect(closeCalls.database).toBe(1);
  });

  it("fails when httpfs install fails", async () => {
    mockRun.mockImplementationOnce(function run(
      sql: string,
      callback?: (error: Error | null) => void,
    ) {
      runStatements.push(sql);
      callback?.(new Error("install failed"));
    });

    await expect(createInMemoryDuckDb()).rejects.toThrow("install failed");
  });

  it("rejects when close fails", async () => {
    closeErrors.connection = new Error("close failed");
    const client = await createInMemoryDuckDb();

    await expect(client.close()).rejects.toThrow("close failed");
  });
});
