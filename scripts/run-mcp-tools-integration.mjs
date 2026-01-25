import { spawnSync } from "child_process";
import dotenv from "dotenv";

const args = process.argv.slice(2);
dotenv.config({ path: "tests/e2e/.env" });

function normalizeServiceArg(raw) {
  if (!raw) {
    return "";
  }
  if (raw.startsWith("--services=")) {
    return raw.slice("--services=".length);
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
  env.MCP_TOOL_SERVICES = serviceArg;
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
  process.exit(result.status ?? 1);
}
