import { spawn, ChildProcess } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";

import { FullConfig } from "@playwright/test";

import { validateEnvironment } from "./config/env";

// Store process references and PIDs for reliable cleanup
let backendProcess: ChildProcess | null = null;
let frontendProcess: ChildProcess | null = null;
let backendPid: number | null = null;
let frontendPid: number | null = null;

// Path to store process info for teardown
const processInfoPath = join(process.cwd(), ".test-processes.json");

/**
 * Check if a service is ready by making an HTTP request to it
 * Returns true if the service responds with a non-5xx status, false otherwise
 */
async function checkServiceReady(
  url: string,
  maxAttempts: number = 60,
  intervalMs: number = 1000,
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(2000), // 2 second timeout per request
      });
      // If we get a non-5xx response, the service is ready (even 404 is fine, means handlers are compiled)
      if (response.status < 500) {
        console.log(
          `✅ Service at ${url} is ready (status: ${response.status})`,
        );
        return true;
      }
      // 5xx means service is up but not ready (e.g., handlers not compiled)
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    } catch {
      // Service not ready yet, continue polling
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
  }
  return false;
}

async function killProcessesOnPort(port: number): Promise<void> {
  try {
    const { execSync } = await import("child_process");
    // First check if there are any processes on the port
    const pids = execSync(`lsof -ti:${port}`, { encoding: "utf-8" }).trim();
    if (pids) {
      // Only kill if there are processes found
      execSync(`kill -9 ${pids}`);
      console.log(`Killed processes on port ${port}`);
    } else {
      console.log(`No processes found on port ${port}`);
    }
  } catch (error: unknown) {
    // If lsof returns no results, it exits with code 1, which is expected
    if (
      (error as { status?: number; code?: number }).status === 1 ||
      (error as { code?: number }).code === 1
    ) {
      console.log(`No processes found on port ${port}`);
    } else {
      console.warn(`Error checking/killing processes on port ${port}:`, error);
    }
  }
}

async function globalSetup(config: FullConfig) {
  // Validate environment variables before starting tests
  console.log("Validating environment configuration...");
  await validateEnvironment({ promptIfMissing: true });
  await ensureMcpOauthEnv();

  const { baseURL } = config.projects[0].use;
  console.log("Setting up test environment...");
  console.log(`Base URL: ${baseURL}`);

  // Only start local services if testing against localhost
  if (!baseURL || !baseURL.startsWith("http://localhost")) {
    console.log(
      "Testing against remote environment, skipping local service startup",
    );
    console.log("✅ Test environment setup completed");
    return;
  }

  // Start fresh services for local testing
  const backendPort = 3333;
  const frontendPort = 5173;

  // Kill any existing processes on these ports first
  console.log("Ensuring clean ports for test services...");
  await killProcessesOnPort(backendPort);
  await killProcessesOnPort(frontendPort);

  // Start the backend sandbox
  console.log("Starting backend sandbox...");

  try {
    // Ensure AUTH_SECRET is available
    const authSecret = (() => {
      if (process.env.CI && !process.env.AUTH_SECRET) {
        throw new Error(
          "AUTH_SECRET environment variable is required in CI environment",
        );
      }
      // Only allow fallback in local development
      return process.env.AUTH_SECRET || "test-secret-key-for-e2e-tests-only";
    })();

    if (!authSecret) {
      throw new Error("AUTH_SECRET is not set and no fallback is available");
    }

    // Ensure MAILGUN_KEY is available
    const mailgunKey = process.env.MAILGUN_KEY;
    if (!mailgunKey) {
      console.warn("⚠️  MAILGUN_KEY is not set - email sending may fail");
    }

    // Get frontend URL from config or environment, default to localhost:5173
    const frontendUrl =
      config.projects[0]?.use?.baseURL ||
      process.env.BASE_URL ||
      "http://localhost:5173";
    const oauthRedirectBaseUrl =
      process.env.OAUTH_REDIRECT_BASE_URL || "http://localhost:3333";
    if (oauthRedirectBaseUrl.includes("localhost:5173")) {
      process.env.OAUTH_REDIRECT_BASE_URL = "http://localhost:3333";
    }

    // Prepare environment variables for the backend process
    // We need to explicitly set all required variables to ensure they're available
    // Note: ARC_DB_PATH is relative to apps/backend directory since we run from there
    // Note: Architect sandbox reads from .env file, but we also set them in process env as backup
    const backendEnv = {
      ...process.env,
      NODE_ENV: "test",
      ARC_ENV: "testing", // Explicitly set to "testing" to skip API Gateway operations
      ARC_DB_PATH: "./db",
      // Pass through Mailgun credentials for email sending
      MAILGUN_KEY: mailgunKey || "",
      MAILGUN_DOMAIN: process.env.MAILGUN_DOMAIN || "helpmaton.com",
      // Pass through AUTH_SECRET (required for auth to work)
      AUTH_SECRET: authSecret,
      // FRONTEND_URL is critical for auth redirects
      FRONTEND_URL: frontendUrl,
      // OAuth redirect base URL for MCP OAuth callbacks
      OAUTH_REDIRECT_BASE_URL:
        process.env.OAUTH_REDIRECT_BASE_URL || "http://localhost:3333",
      // E2E test overrides - allow team invitations in tests
      E2E_OVERRIDE_MAX_USERS: process.env.E2E_OVERRIDE_MAX_USERS || "10",
      // Bypass auth gate in E2E environment
      E2E_AUTH_GATE_BYPASS: "true",
    };

    console.log(`Starting backend with environment variables:`);
    console.log(`  - AUTH_SECRET: ${authSecret ? "***SET***" : "NOT SET"}`);
    console.log(`  - MAILGUN_KEY: ${mailgunKey ? "***SET***" : "NOT SET"}`);
    console.log(`  - MAILGUN_DOMAIN: ${backendEnv.MAILGUN_DOMAIN}`);
    console.log(`  - FRONTEND_URL: ${frontendUrl}`);
    console.log(
      `  - ARC_DB_PATH: ${backendEnv.ARC_DB_PATH} (relative to apps/backend)`,
    );
    console.log(
      `  - E2E_OVERRIDE_MAX_USERS: ${backendEnv.E2E_OVERRIDE_MAX_USERS} (allows team invitations in tests)`,
    );

    // Create .env file in apps/backend directory for Architect sandbox
    // Architect sandbox reads environment variables from .env file
    const backendDir = join(process.cwd(), "apps", "backend");
    const envFilePath = join(backendDir, ".env");

    // Get TESTMAIL variables for the .env file (used by test code)
    const testmailNamespace = process.env.TESTMAIL_NAMESPACE || "";
    const testmailApiKey = process.env.TESTMAIL_API_KEY || "";

    // Collect all environment variables that need to be in the .env file
    // Architect sandbox only reads from .env file, so we must include everything here
    const envVars: Record<string, string> = {
      AUTH_SECRET: authSecret,
      MAILGUN_KEY: mailgunKey || "",
      MAILGUN_DOMAIN: backendEnv.MAILGUN_DOMAIN,
      ARC_DB_PATH: backendEnv.ARC_DB_PATH,
      NODE_ENV: "test",
      ARC_ENV: "testing", // Explicitly set to "testing" to skip API Gateway operations
      FRONTEND_URL: frontendUrl,
      OAUTH_REDIRECT_BASE_URL:
        process.env.OAUTH_REDIRECT_BASE_URL || "http://localhost:3333",
      // TESTMAIL variables (for test code that might need them)
      TESTMAIL_NAMESPACE: testmailNamespace,
      TESTMAIL_API_KEY: testmailApiKey,
      // E2E test overrides - allow team invitations in tests
      E2E_OVERRIDE_MAX_USERS: process.env.E2E_OVERRIDE_MAX_USERS || "10",
      // Bypass auth gate in E2E environment
      E2E_AUTH_GATE_BYPASS: "true",
    };

    // Add optional environment variables if they're set
    // These are used by various parts of the backend
    const optionalVars = [
      "GEMINI_API_KEY",
      "SENTRY_DSN",
      "ALLOWED_EMAILS",
      "HELPMATON_S3_BUCKET",
      "HELPMATON_S3_ENDPOINT",
      "HELPMATON_S3_DATA_DIR",
      "OAUTH_REDIRECT_BASE_URL",
      "GMAIL_CLIENT_ID",
      "GMAIL_CLIENT_SECRET",
      "OUTLOOK_CLIENT_ID",
      "OUTLOOK_CLIENT_SECRET",
      "DISCORD_BOT_TOKEN",
      "DISCORD_TRIAL_CREDIT_CHANNEL_ID",
      "CLOUDFLARE_TURNSTILE_SECRET_KEY",
      "CLOUDFLARE_TURNSTILE_SITE_KEY",
      "DISABLE_TRIAL_PERIOD_CHECK",
      // Note: E2E_OVERRIDE_MAX_USERS is handled explicitly above with a default value
    ];

    for (const varName of optionalVars) {
      if (process.env[varName]) {
        envVars[varName] = process.env[varName];
      }
    }

    // Build .env file content
    // Escape values that might contain special characters
    const escapeEnvValue = (value: string): string => {
      // If value contains spaces, quotes, or special chars, wrap in quotes
      if (
        value.includes(" ") ||
        value.includes('"') ||
        value.includes("'") ||
        value.includes("$")
      ) {
        // Escape quotes and backslashes
        const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        return `"${escaped}"`;
      }
      return value;
    };

    const envFileContent =
      Object.entries(envVars)
        .map(([key, value]) => `${key}=${escapeEnvValue(value)}`)
        .join("\n") + "\n";

    writeFileSync(envFilePath, envFileContent, "utf-8");
    console.log(`Created .env file at ${envFilePath}`);
    console.log(
      `  Included ${Object.keys(envVars).length} environment variables`,
    );
    console.log(`  FRONTEND_URL: ${frontendUrl}`);

    // Start the backend sandbox process directly
    // We run the sandbox command directly instead of through the npm script
    // to ensure environment variables are properly passed through
    backendProcess = spawn("pnpm", ["arc", "sandbox"], {
      cwd: backendDir,
      stdio: "pipe",
      detached: false,
      env: backendEnv,
    });

    // Wait for the backend to be ready
    console.log("Waiting for backend to start...");
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Backend startup timeout"));
      }, 60000); // 60 second timeout (compilation can take ~20-30 seconds)

      if (backendProcess?.stdout) {
        let sandboxStarted = false;
        let compilationComplete = false;
        let sawCompiling = false;

        backendProcess.stdout.on("data", (data: Buffer) => {
          const output = data.toString();
          console.log(`Backend: ${output.trim()}`);

          // Check if the sandbox has started
          if (
            output.includes("Sandbox Started") ||
            output.includes("Local environment ready") ||
            output.includes("Server ready")
          ) {
            sandboxStarted = true;
          }

          // Check if TypeScript compilation started
          if (output.includes("Compiling TypeScript")) {
            sawCompiling = true;
          }

          // Check if TypeScript compilation is complete
          // The backend logs "Compiled project" or "Sandbox Ran Sandbox startup plugins" after compilation
          if (
            output.includes("Compiled project") ||
            output.includes("Sandbox Ran Sandbox startup plugins") ||
            output.includes("File watcher now looking")
          ) {
            compilationComplete = true;
          }

          // Backend is fully ready when:
          // 1. Sandbox has started, AND
          // 2. Either compilation didn't happen (sawCompiling = false) OR compilation is complete
          if (sandboxStarted && (!sawCompiling || compilationComplete)) {
            clearTimeout(timeout);
            resolve(true);
          }
        });
      }

      if (backendProcess?.stderr) {
        backendProcess.stderr.on("data", (data: Buffer) => {
          const output = data.toString();
          console.log(`Backend stderr: ${output.trim()}`);
        });
      }

      if (backendProcess) {
        backendProcess.on("error", (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        });

        backendProcess.on("exit", (code: number) => {
          if (code !== 0) {
            clearTimeout(timeout);
            reject(new Error(`Backend process exited with code ${code}`));
          }
        });
      }
    });

    console.log("✅ Backend sandbox process started");

    // Store backend PID for reliable cleanup
    if (backendProcess?.pid) {
      backendPid = backendProcess.pid;
      console.log(`Backend process PID: ${backendPid}`);
    }

    // Verify backend is actually ready (handlers compiled and responding)
    // We check for a non-5xx response to ensure TypeScript compilation is complete
    console.log(
      "Waiting for backend compilation to complete and handlers to be ready...",
    );
    const backendReady = await checkServiceReady(
      "http://localhost:3333",
      90,
      1000,
    );
    if (!backendReady) {
      throw new Error(
        "Backend did not become ready within 90 seconds. Check logs above for compilation errors.",
      );
    }
    console.log("✅ Backend sandbox is ready and handlers are compiled");
  } catch (error) {
    console.error("Failed to start backend:", error);
    // Clean up on failure
    if (backendProcess) {
      backendProcess.kill("SIGKILL");
    }
    throw error;
  }

  // Start the frontend server
  console.log("Starting frontend server...");
  frontendProcess = spawn("pnpm", ["dev:frontend"], {
    cwd: process.cwd(),
    stdio: "pipe",
    detached: false,
    env: {
      ...process.env,
      NODE_ENV: "test",
    },
  });

  // Wait for the frontend to be ready
  console.log("Waiting for frontend to start...");
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Frontend startup timeout"));
    }, 30000); // 30 second timeout

    if (frontendProcess?.stdout) {
      frontendProcess.stdout.on("data", (data: Buffer) => {
        const output = data.toString();
        console.log(`Frontend: ${output.trim()}`);

        // Check if the frontend is ready (Vite typically shows "Local:" when ready)
        if (
          output.includes("Local:") ||
          output.includes("ready in") ||
          output.includes("VITE v") ||
          output.includes("5173")
        ) {
          clearTimeout(timeout);
          resolve(true);
        }
      });
    }

    if (frontendProcess?.stderr) {
      frontendProcess.stderr.on("data", (data: Buffer) => {
        const output = data.toString();
        console.log(`Frontend stderr: ${output.trim()}`);
      });
    }

    if (frontendProcess) {
      frontendProcess.on("error", (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });

      frontendProcess.on("exit", (code: number) => {
        if (code !== 0) {
          clearTimeout(timeout);
          reject(new Error(`Frontend process exited with code ${code}`));
        }
      });
    }
  });

  console.log("✅ Frontend server started successfully");

  // Store frontend PID for reliable cleanup
  if (frontendProcess?.pid) {
    frontendPid = frontendProcess.pid;
    console.log(`Frontend process PID: ${frontendPid}`);
  }

  // Save process info to file for teardown (in case of crashes)
  try {
    writeFileSync(
      processInfoPath,
      JSON.stringify({
        backendPid,
        frontendPid,
        timestamp: Date.now(),
      }),
      "utf-8",
    );
  } catch (error) {
    console.warn("Failed to save process info:", error);
  }

  // Wait a bit more for the frontend to fully initialize
  // Then wait additional time to ensure both servers are fully ready before tests start
  console.log(
    "Waiting for servers to fully stabilize before starting tests...",
  );
  await new Promise((resolve) => setTimeout(resolve, 8000)); // 8 seconds total (5 + 3 extra)

  console.log("✅ Test environment setup completed");
  console.log("✅ Servers are ready - tests can now run");
}

async function ensureMcpOauthEnv(): Promise<void> {
  if (process.env.RUN_MCP_OAUTH_E2E !== "true") {
    return;
  }

  const requiredConfig = [
    "MCP_OAUTH_SHOPIFY_SHOP_DOMAIN",
    "MCP_OAUTH_ZENDESK_SUBDOMAIN",
    "MCP_OAUTH_ZENDESK_CLIENT_ID",
    "MCP_OAUTH_ZENDESK_CLIENT_SECRET",
    "SHOPIFY_OAUTH_CLIENT_ID",
    "SHOPIFY_OAUTH_CLIENT_SECRET",
  ];
  const missing = requiredConfig.filter((key) => !process.env[key]);

  if (missing.length === 0) {
    return;
  }

  if (process.stdin.isTTY && !process.env.CI) {
    const readline = await import("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    process.stdout.write("\x07");

    for (const key of missing) {
      const value = await new Promise<string>((resolve) => {
        rl.question(`Enter value for ${key}: `, (answer) => {
          resolve(answer.trim());
        });
      });

      if (value) {
        process.env[key] = value;
      }
    }

    rl.close();
  }

  const stillMissing = requiredConfig.filter((key) => !process.env[key]);
  if (stillMissing.length > 0) {
    throw new Error(
      `Missing required MCP OAuth environment variables: ${stillMissing.join(", ")}\n` +
        "Set them in tests/e2e/.env or export them before running the tests.",
    );
  }
}

export default globalSetup;

// Export the processes and PIDs so they can be accessed in teardown
export { backendProcess, frontendProcess, backendPid, frontendPid };
