import type * as DuckDbTypes from "duckdb";

const DEFAULT_S3_REGION = "eu-west-2";
const DEFAULT_LOCAL_S3_ENDPOINT = "http://localhost:4568";
const ALLOWED_S3_SETTINGS = new Set([
  "s3_region",
  "s3_access_key_id",
  "s3_secret_access_key",
  "s3_session_token",
  "s3_endpoint",
  "s3_url_style",
  "s3_use_ssl",
]);

type DuckDbDatabase = DuckDbTypes.Database;
type DuckDbConnection = DuckDbTypes.Connection;
type DuckDbTableData = DuckDbTypes.TableData;

type DuckDbClient = {
  db: DuckDbDatabase;
  connection: DuckDbConnection;
  run: (sql: string) => Promise<void>;
  all: <T = unknown>(sql: string) => Promise<T[]>;
  close: () => Promise<void>;
};

type S3Setting = {
  key: string;
  value: string | boolean;
};

function escapeSingleQuotes(value: string): string {
  return value.replace(/'/g, "''");
}

function formatSettingValue(value: string | boolean): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return `'${escapeSingleQuotes(value)}'`;
}

function buildS3Settings(): S3Setting[] {
  const arcEnv = process.env.ARC_ENV;
  const accessKeyId =
    process.env.HELPMATON_S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.HELPMATON_S3_SECRET_ACCESS_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN;
  const region =
    process.env.HELPMATON_S3_REGION ||
    process.env.AWS_REGION ||
    DEFAULT_S3_REGION;

  const isLocal = arcEnv === "testing" || !accessKeyId || !secretAccessKey;
  const settings: S3Setting[] = [];

  if (isLocal) {
    const endpoint =
      process.env.HELPMATON_S3_ENDPOINT || DEFAULT_LOCAL_S3_ENDPOINT;
    settings.push(
      { key: "s3_region", value: DEFAULT_S3_REGION },
      { key: "s3_access_key_id", value: "S3RVER" },
      { key: "s3_secret_access_key", value: "S3RVER" },
      { key: "s3_endpoint", value: endpoint },
      { key: "s3_url_style", value: "path" },
      { key: "s3_use_ssl", value: !endpoint.startsWith("http://") },
    );

    return settings;
  }

  settings.push({ key: "s3_region", value: region });

  if (accessKeyId && secretAccessKey) {
    settings.push(
      { key: "s3_access_key_id", value: accessKeyId },
      { key: "s3_secret_access_key", value: secretAccessKey },
    );
  }

  if (sessionToken) {
    settings.push({ key: "s3_session_token", value: sessionToken });
  }

  const customEndpoint = process.env.HELPMATON_S3_ENDPOINT;
  if (customEndpoint) {
    settings.push({ key: "s3_endpoint", value: customEndpoint });
    if (customEndpoint.startsWith("http://")) {
      settings.push({ key: "s3_use_ssl", value: false });
    }
  }

  return settings;
}

function runStatement(
  connection: DuckDbConnection,
  sql: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.run(sql, (error: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function runAll<T = unknown>(
  connection: DuckDbConnection,
  sql: string,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    connection.all(sql, (error: Error | null, rows: DuckDbTableData) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows as T[]);
    });
  });
}

async function configureHttpfs(
  connection: DuckDbConnection,
  settings: S3Setting[],
): Promise<void> {
  await runStatement(connection, "INSTALL httpfs;");
  await runStatement(connection, "LOAD httpfs;");

  for (const setting of settings) {
    if (!ALLOWED_S3_SETTINGS.has(setting.key)) {
      throw new Error(`Unsupported DuckDB S3 setting: ${setting.key}`);
    }
    const formattedValue = formatSettingValue(setting.value);
    await runStatement(connection, `SET ${setting.key}=${formattedValue};`);
  }
}

function closeDuckDb(
  connection: DuckDbConnection,
  db: DuckDbDatabase,
): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.close((connectionError: Error | null) => {
      if (connectionError) {
        reject(connectionError);
        return;
      }

      db.close((dbError: Error | null) => {
        if (dbError) {
          reject(dbError);
          return;
        }

        resolve();
      });
    });
  });
}

export async function createInMemoryDuckDb(): Promise<DuckDbClient> {
  const duckdbModule = await import("duckdb");
  const DatabaseConstructor =
    duckdbModule.default?.Database ?? duckdbModule.Database;
  const db = new DatabaseConstructor(":memory:") as DuckDbDatabase;
  const connection = db.connect();
  const settings = buildS3Settings();

  await configureHttpfs(connection, settings);

  return {
    db,
    connection,
    run: (sql: string) => runStatement(connection, sql),
    all: <T = unknown>(sql: string) => runAll<T>(connection, sql),
    close: () => closeDuckDb(connection, db),
  };
}
