import { spawnSync } from "child_process";
import dotenv from "dotenv";

const args = process.argv.slice(2);
dotenv.config({ path: "tests/e2e/.env" });

function normalizeServiceArg(raw) {
  if (!raw) {
    return "";
  }
  if (raw.startsWith("--services=")) {
    const value = raw.slice("--services=".length);
    if (!value) {
      throw new Error("The --services flag requires a non-empty value.");
    }
    return value;
  }
  if (raw.startsWith("-")) {
    return "";
  }
  return raw;
}

const serviceArg =
  normalizeServiceArg(args.find((arg) => arg.startsWith("--services="))) ||
  normalizeServiceArg(args.find((arg) => arg && !arg.startsWith("-")));

const env = {
  ...process.env,
  ARC_ENV: "testing",
  RUN_MCP_TOOLS_INTEGRATION: "true",
};

if (serviceArg) {
  const services = serviceArg
    .split(",")
    .map((service) => service.trim())
    .filter(Boolean);
  if (services.length === 0) {
    throw new Error("No valid services were provided.");
  }
  const invalidServices = services.filter(
    (name) => !/^[A-Za-z0-9:_-]+$/.test(name)
  );
  if (invalidServices.length > 0) {
    throw new Error(
      `Invalid MCP service name(s): ${invalidServices.join(", ")}`
    );
  }
  env.MCP_TOOL_SERVICES = services.join(",");
}

const result = spawnSync(
  "pnpm",
  [
    "--filter",
    "backend",
    "exec",
    "vitest",
    "src/utils/__tests__/mcp-tools-integration.test.ts",
  ],
  {
    stdio: "inherit",
    env,
  }
);

if (result.status !== 0) {
  const exitCode = result.status == null ? 1 : result.status;
  process.exit(exitCode);
}
