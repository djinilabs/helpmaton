import { createWriteStream } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { DuckDBInstance } from "@duckdb/node-api";

import { getS3BucketName } from "../vectordb/config";

const DEFAULT_S3_REGION = "eu-west-2";
const DEFAULT_LOCAL_S3_ENDPOINT = "http://localhost:4568";
const LOCAL_S3_ACCESS_KEY = "S3RVER";
const LOCAL_S3_SECRET_KEY = "S3RVER";

/** Prefix for graph parquet temp files (load and save). */
const GRAPH_TEMP_FILE_PREFIX = "helpmaton-graph";

type DuckDbInstance = Awaited<ReturnType<typeof DuckDBInstance.create>>;
type DuckDbConnection = Awaited<ReturnType<DuckDbInstance["connect"]>>;

export type FactRow = {
  id: string;
  source_id: string;
  target_id: string;
  label: string;
  properties?: Record<string, unknown> | null;
};

export type FactWhere = Partial<
  Pick<FactRow, "id" | "source_id" | "target_id" | "label">
>;

export type GraphDb = {
  insertFacts: (rows: FactRow[]) => Promise<void>;
  updateFacts: (where: FactWhere, updates: Partial<FactRow>) => Promise<void>;
  deleteFacts: (where: FactWhere) => Promise<void>;
  queryGraph: <T = unknown>(sql: string) => Promise<T[]>;
  save: () => Promise<void>;
  close: () => Promise<void>;
};

type S3Location = {
  bucket: string;
  key: string;
  uri: string;
};

function logS3Config(note: string, details: Record<string, unknown>) {
  console.log(`[Graph DB][S3] ${note}`, details);
}

function escapeSingleQuotes(value: string): string {
  return value.replace(/'/g, "''");
}

function formatSqlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "string") {
    return `'${escapeSingleQuotes(value)}'`;
  }

  const jsonValue = JSON.stringify(value);
  return `CAST('${escapeSingleQuotes(jsonValue)}' AS JSON)`;
}

function buildWhereClause(where: FactWhere): string {
  const entries = Object.entries(where).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) {
    throw new Error("Graph DB operations require at least one where clause.");
  }
  const clauses = entries.map(
    ([key, value]) => `${key} = ${formatSqlValue(value)}`,
  );
  return `WHERE ${clauses.join(" AND ")}`;
}

function buildUpdateClause(updates: Partial<FactRow>): string {
  const entries = Object.entries(updates).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) {
    throw new Error("Graph DB updates require at least one field.");
  }
  const assignments = entries.map(
    ([key, value]) => `${key} = ${formatSqlValue(value)}`,
  );
  return `SET ${assignments.join(", ")}`;
}

function buildFactsS3Location(
  workspaceId: string,
  agentId: string,
): S3Location {
  const bucket = getS3BucketName();
  const key = `graphs/${workspaceId}/${agentId}/facts.parquet`;
  return {
    bucket,
    key,
    uri: `s3://${bucket}/${key}`,
  };
}

function resolveS3Credentials(): {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  endpoint?: string;
  urlStyle?: "path" | "vhost";
  useSsl?: boolean;
} {
  const arcEnv = process.env.ARC_ENV;
  const envAccessKeyId = process.env.HELPMATON_S3_ACCESS_KEY_ID;
  const envSecretAccessKey = process.env.HELPMATON_S3_SECRET_ACCESS_KEY;
  const roleAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const roleSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const accessKeyId = envAccessKeyId || roleAccessKeyId;
  const secretAccessKey = envSecretAccessKey || roleSecretAccessKey;
  const sessionToken =
    envAccessKeyId && envSecretAccessKey
      ? process.env.HELPMATON_S3_SESSION_TOKEN
      : process.env.AWS_SESSION_TOKEN;
  const region =
    process.env.HELPMATON_S3_REGION ||
    process.env.AWS_REGION ||
    DEFAULT_S3_REGION;
  const customEndpoint = process.env.HELPMATON_S3_ENDPOINT;
  const isLocal = arcEnv === "testing" || !accessKeyId || !secretAccessKey;

  if (isLocal) {
    const endpoint = customEndpoint || DEFAULT_LOCAL_S3_ENDPOINT;
    logS3Config("Resolved local S3 credentials", {
      arcEnv,
      region: DEFAULT_S3_REGION,
      endpoint,
      urlStyle: "path",
      useSsl: !endpoint.startsWith("http://"),
      accessKeyId: accessKeyId ? "env" : "local-default",
      secretAccessKey: secretAccessKey ? "env" : "local-default",
      sessionToken: sessionToken ? "set" : "missing",
    });
    return {
      accessKeyId: LOCAL_S3_ACCESS_KEY,
      secretAccessKey: LOCAL_S3_SECRET_KEY,
      sessionToken,
      region: DEFAULT_S3_REGION,
      endpoint,
      urlStyle: "path",
      useSsl: !endpoint.startsWith("http://"),
    };
  }

  // In production with no custom endpoint, use path-style to match s3.ts and DuckDB httpfs
  const isProductionAws =
    arcEnv === "production" &&
    !customEndpoint?.includes("localhost") &&
    !customEndpoint?.includes("127.0.0.1");
  const urlStyle =
    isProductionAws && !customEndpoint ? "path" : "vhost";
  const endpoint =
    isProductionAws && !customEndpoint
      ? `https://s3.${region}.amazonaws.com`
      : customEndpoint;

  logS3Config("Resolved AWS S3 credentials", {
    arcEnv,
    region,
    endpoint: endpoint ?? "aws-default",
    urlStyle,
    useSsl: endpoint ? !endpoint.startsWith("http://") : undefined,
    accessKeyId: envAccessKeyId ? "env" : roleAccessKeyId ? "role" : "missing",
    secretAccessKey: envSecretAccessKey
      ? "env"
      : roleSecretAccessKey
        ? "role"
        : "missing",
    sessionToken: sessionToken ? "set" : "missing",
  });
  return {
    accessKeyId: accessKeyId ?? "",
    secretAccessKey: secretAccessKey ?? "",
    sessionToken,
    region,
    endpoint,
    urlStyle,
    useSsl: endpoint ? !endpoint.startsWith("http://") : undefined,
  };
}

function createS3Client() {
  const credentials = resolveS3Credentials();
  return new S3Client({
    region: credentials.region,
    endpoint: credentials.endpoint || undefined,
    forcePathStyle: credentials.urlStyle === "path",
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
  });
}

/**
 * Downloads the graph parquet from S3 to a temp file. Caller must unlink the returned path.
 * We use the SDK instead of DuckDB read_parquet(s3://...) because httpfs can yield HTTP 400 in production.
 */
async function downloadParquetToTemp(location: S3Location): Promise<string> {
  const tmpDir = tmpdir();
  await mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(
    tmpDir,
    `${GRAPH_TEMP_FILE_PREFIX}-load-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.parquet`,
  );
  try {
    const client = createS3Client();
    const response = await client.send(
      new GetObjectCommand({
        Bucket: location.bucket,
        Key: location.key,
      }),
    );
    if (!response.Body) {
      throw new Error(`S3 GetObject returned no body for ${location.uri}`);
    }
    await pipeline(
      response.Body as NodeJS.ReadableStream,
      createWriteStream(tmpPath),
    );
    logS3Config("Graph parquet downloaded via SDK", {
      bucket: location.bucket,
      key: location.key,
    });
    return tmpPath;
  } catch (error) {
    try {
      await unlink(tmpPath);
    } catch {
      // Best-effort cleanup of partial file
    }
    const cause =
      error instanceof Error ? error : new Error(String(error));
    throw new Error(
      `Graph DB load failed: ${cause.message} | bucket=${location.bucket} key=${location.key}`,
      { cause },
    );
  }
}

async function parquetExists(location: S3Location): Promise<boolean> {
  const client = createS3Client();
  logS3Config("HEAD parquet", {
    bucket: location.bucket,
    key: location.key,
    uri: location.uri,
  });
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: location.bucket,
        Key: location.key,
      }),
    );
    return true;
  } catch (error) {
    const statusCode =
      error && typeof error === "object" && "$metadata" in error
        ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
        : undefined;
    const requestId =
      error &&
      typeof error === "object" &&
      "$metadata" in error &&
      (error.$metadata as { requestId?: string }).requestId
        ? (error.$metadata as { requestId?: string }).requestId
        : undefined;
    const errorMessage =
      error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message)
        : String(error);
    logS3Config("HEAD parquet failed", {
      bucket: location.bucket,
      key: location.key,
      statusCode,
      requestId,
      errorName:
        error && typeof error === "object" && "name" in error
          ? (error as { name?: string }).name
          : undefined,
    });
    if (
      statusCode === 404 ||
      (error as { name?: string }).name === "NotFound"
    ) {
      return false;
    }
    const cause =
      error instanceof Error ? error : new Error(String(error));
    throw new Error(
      `S3 HeadObject failed for graph facts: ${errorMessage} (bucket=${location.bucket}, key=${location.key}, statusCode=${statusCode ?? "unknown"}, requestId=${requestId ?? "unknown"})`,
      { cause },
    );
  }
}

async function runStatement(connection: DuckDbConnection, sql: string) {
  await connection.run(sql);
}

async function runQuery<T>(
  connection: DuckDbConnection,
  sql: string,
): Promise<T[]> {
  const reader = await connection.runAndReadAll(sql);
  await reader.readAll();
  return reader.getRowObjectsJson() as T[];
}

async function configureDuckDb(connection: DuckDbConnection): Promise<boolean> {
  const homeDirectory =
    process.env.HELPMATON_DUCKDB_HOME ||
    process.env.HOME ||
    path.join("/tmp", "helpmaton-duckdb");
  await mkdir(homeDirectory, { recursive: true });
  await runStatement(
    connection,
    `SET home_directory='${escapeSingleQuotes(homeDirectory)}';`,
  );

  // Graph facts are read/written via the SDK (temp file + GetObject/PutObject). DuckDB only
  // uses read_parquet(local path) and COPY TO local path, so we do not install httpfs or set S3 credentials.
  let duckpgqEnabled = false;
  try {
    await runStatement(connection, "INSTALL duckpgq FROM community;");
    await runStatement(connection, "LOAD duckpgq;");
    duckpgqEnabled = true;
  } catch (error) {
    console.warn("[Graph DB] DuckPGQ extension unavailable:", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return duckpgqEnabled;
}

async function initializeFactsTable(
  connection: DuckDbConnection,
  location: S3Location,
  duckpgqEnabled: boolean,
): Promise<void> {
  const exists = await parquetExists(location);
  if (exists) {
    let tmpPath: string | null = null;
    try {
      tmpPath = await downloadParquetToTemp(location);
      const escapedPath = escapeSingleQuotes(tmpPath);
      await runStatement(
        connection,
        `CREATE TABLE facts AS SELECT * FROM read_parquet('${escapedPath}');`,
      );
    } finally {
      if (tmpPath) {
        try {
          await unlink(tmpPath);
        } catch {
          // Best-effort cleanup
        }
      }
    }
  } else {
    await runStatement(
      connection,
      "CREATE TABLE facts (id VARCHAR PRIMARY KEY, source_id VARCHAR, target_id VARCHAR, label VARCHAR, properties JSON);",
    );
  }

  await runStatement(
    connection,
    "CREATE OR REPLACE VIEW nodes AS SELECT DISTINCT source_id AS id FROM facts UNION SELECT DISTINCT target_id AS id FROM facts;",
  );
  if (duckpgqEnabled) {
    await runStatement(
      connection,
      "DROP PROPERTY GRAPH IF EXISTS facts_graph;",
    );
    await runStatement(
      connection,
      "CREATE PROPERTY GRAPH facts_graph VERTEX TABLES ( nodes ) EDGE TABLES ( facts SOURCE KEY ( source_id ) REFERENCES nodes ( id ) DESTINATION KEY ( target_id ) REFERENCES nodes ( id ) LABEL label );",
    );
  }
}

async function closeDuckDb(
  connection: DuckDbConnection,
  instance: DuckDbInstance,
) {
  connection.closeSync();
  instance.closeSync();
}

/**
 * Exports the DuckDB facts table to S3 by writing to a temp file then uploading
 * via the AWS SDK. We avoid DuckDB's httpfs COPY TO S3 because it can yield
 * HTTP 400 Bad Request in production; the SDK PutObject path is reliable.
 */
async function saveFactsToS3(
  connection: DuckDbConnection,
  location: S3Location,
): Promise<void> {
  const tmpDir = tmpdir();
  await mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(
    tmpDir,
    `${GRAPH_TEMP_FILE_PREFIX}-save-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.parquet`,
  );
  const escapedTmpPath = escapeSingleQuotes(tmpPath);
  try {
    await runStatement(
      connection,
      `COPY facts TO '${escapedTmpPath}' (FORMAT PARQUET, OVERWRITE 1);`,
    );
    const body = await readFile(tmpPath);
    const client = createS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: location.bucket,
        Key: location.key,
        Body: body,
        ContentType: "application/vnd.apache.parquet",
      }),
    );
    logS3Config("Graph facts uploaded via SDK (temp file)", {
      bucket: location.bucket,
      key: location.key,
    });
  } catch (error) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message)
        : String(error);
    logS3Config("Graph DB save failed", {
      bucket: location.bucket,
      key: location.key,
      uri: location.uri,
      errorMessage: message,
    });
    const cause =
      error instanceof Error ? error : new Error(String(error));
    throw new Error(
      `Graph DB save failed: ${message} | s3Uri=${location.uri} | bucket=${location.bucket} key=${location.key}`,
      { cause },
    );
  } finally {
    try {
      await unlink(tmpPath);
    } catch {
      // Best-effort cleanup; ignore if file did not exist or already removed
    }
  }
}

export async function createGraphDb(
  workspaceId: string,
  agentId: string,
): Promise<GraphDb> {
  const location = buildFactsS3Location(workspaceId, agentId);
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    const duckpgqEnabled = await configureDuckDb(connection);
    await initializeFactsTable(connection, location, duckpgqEnabled);
  } catch (error) {
    try {
      await closeDuckDb(connection, instance);
    } catch {
      // Ignore cleanup errors to preserve original failure.
    }
    throw error;
  }

  return {
    insertFacts: async (rows: FactRow[]) => {
      if (rows.length === 0) return;
      const columns = ["id", "source_id", "target_id", "label", "properties"];
      const values = rows.map((row) => {
        const propertiesValue =
          row.properties === null
            ? formatSqlValue(null)
            : formatSqlValue(row.properties ?? {});
        const valuesList = [
          formatSqlValue(row.id),
          formatSqlValue(row.source_id),
          formatSqlValue(row.target_id),
          formatSqlValue(row.label),
          propertiesValue,
        ];
        return `(${valuesList.join(", ")})`;
      });
      await runStatement(
        connection,
        `INSERT INTO facts (${columns.join(", ")}) VALUES ${values.join(", ")};`,
      );
    },
    updateFacts: async (where: FactWhere, updates: Partial<FactRow>) => {
      const updateClause = buildUpdateClause(updates);
      const whereClause = buildWhereClause(where);
      await runStatement(
        connection,
        `UPDATE facts ${updateClause} ${whereClause};`,
      );
    },
    deleteFacts: async (where: FactWhere) => {
      const whereClause = buildWhereClause(where);
      await runStatement(connection, `DELETE FROM facts ${whereClause};`);
    },
    queryGraph: async <T = unknown>(sql: string) =>
      runQuery<T>(connection, sql),
    save: () => saveFactsToS3(connection, location),
    close: async () => closeDuckDb(connection, instance),
  };
}

export async function deleteGraphFactsFile(
  workspaceId: string,
  agentId: string,
): Promise<void> {
  const location = buildFactsS3Location(workspaceId, agentId);
  const client = createS3Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: location.bucket,
      Key: location.key,
    }),
  );
}
