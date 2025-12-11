import { exec } from "child_process";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

import {
  backendProcess,
  frontendProcess,
  backendPid,
  frontendPid,
} from "./global-setup";

// Path to process info file
const processInfoPath = join(process.cwd(), ".test-processes.json");

async function killProcessByPid(pid: number): Promise<boolean> {
  try {
    // Check if process exists
    try {
      await execAsync(`kill -0 ${pid}`);
    } catch {
      // Process doesn't exist
      return false;
    }

    // Try graceful shutdown first
    try {
      await execAsync(`kill -TERM ${pid}`);
      // Wait a bit for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check if still running
      try {
        await execAsync(`kill -0 ${pid}`);
        // Still running, force kill
        await execAsync(`kill -9 ${pid}`);
      } catch {
        // Process already terminated
      }
      console.log(`Killed process ${pid}`);
      return true;
    } catch (error) {
      console.warn(`Failed to kill process ${pid}:`, error);
      // Try force kill
      try {
        await execAsync(`kill -9 ${pid}`);
        console.log(`Force killed process ${pid}`);
        return true;
      } catch (killError) {
        console.log(`Failed to kill process ${pid}:`, killError);
        return false;
      }
    }
  } catch (error) {
    console.log(`Error killing process ${pid}:`, error);
    return false;
  }
}

async function findAndKillProcessesOnPort(
  port: number,
  excludePids: number[] = []
): Promise<void> {
  try {
    // Find processes listening on the specified port
    const { stdout } = await execAsync(`lsof -ti:${port}`);

    if (stdout.trim()) {
      const pids = stdout
        .trim()
        .split("\n")
        .map((pid) => parseInt(pid, 10));

      // Filter out PIDs we're managing separately
      const pidsToKill = pids.filter((pid) => !excludePids.includes(pid));

      if (pidsToKill.length > 0) {
        console.log(
          `Found ${pidsToKill.length} process(es) on port ${port} to clean up:`,
          pidsToKill
        );
        for (const pid of pidsToKill) {
          await killProcessByPid(pid);
        }
      } else {
        console.log(
          `No additional processes found on port ${port} (our processes are already being managed)`
        );
      }
    } else {
      console.log(`No processes found on port ${port}`);
    }
  } catch (error) {
    // If lsof returns no results, it exits with code 1, which is expected
    if (
      (error as { status?: number; code?: number }).status === 1 ||
      (error as { code?: number }).code === 1
    ) {
      console.log(`No processes found on port ${port}`);
    } else {
      console.warn(`Error checking processes on port ${port}:`, error);
    }
  }
}

async function globalTeardown() {
  console.log("🧹 Starting test environment cleanup...");

  // Check if we're testing against localhost to determine if we need to clean up local services
  const baseURL = process.env.BASE_URL || process.env.PLAYWRIGHT_BASE_URL;

  if (!baseURL || !baseURL.startsWith("http://localhost")) {
    console.log(
      "Testing against remote environment, skipping local service cleanup"
    );
    console.log("✅ Test environment cleanup completed");
    return;
  }

  // Try to load process info from file (in case of crash)
  let savedBackendPid: number | null = null;
  let savedFrontendPid: number | null = null;
  try {
    if (existsSync(processInfoPath)) {
      const processInfo = JSON.parse(readFileSync(processInfoPath, "utf-8"));
      savedBackendPid = processInfo.backendPid || null;
      savedFrontendPid = processInfo.frontendPid || null;
      console.log(
        `Loaded saved process info: backend=${savedBackendPid}, frontend=${savedFrontendPid}`
      );
    }
  } catch (error) {
    console.warn("Failed to load process info from file:", error);
  }

  // Use PIDs from module or from saved file
  const actualBackendPid = backendPid || savedBackendPid;
  const actualFrontendPid = frontendPid || savedFrontendPid;

  const pidsToExclude: number[] = [];
  if (actualBackendPid) pidsToExclude.push(actualBackendPid);
  if (actualFrontendPid) pidsToExclude.push(actualFrontendPid);

  // Clean up .env file created for backend sandbox
  const backendEnvPath = join(process.cwd(), "apps", "backend", ".env");
  try {
    if (existsSync(backendEnvPath)) {
      unlinkSync(backendEnvPath);
      console.log("Removed temporary .env file from apps/backend");
    }
  } catch (error) {
    console.warn("Failed to remove .env file:", error);
  }

  // Stop the processes we started (by PID for reliability)
  if (actualBackendPid) {
    console.log(`Stopping backend sandbox (PID: ${actualBackendPid})...`);
    try {
      // Try graceful shutdown via process object first
      if (backendProcess && !backendProcess.killed) {
        backendProcess.kill("SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (!backendProcess.killed) {
          backendProcess.kill("SIGKILL");
        }
      } else {
        // Fall back to killing by PID
        await killProcessByPid(actualBackendPid);
      }
      console.log("✅ Backend sandbox stopped");
    } catch (error) {
      console.error("Error stopping backend sandbox:", error);
      // Try force kill by PID as last resort
      if (actualBackendPid) {
        await killProcessByPid(actualBackendPid);
      }
    }
  }

  if (actualFrontendPid) {
    console.log(`Stopping frontend server (PID: ${actualFrontendPid})...`);
    try {
      // Try graceful shutdown via process object first
      if (frontendProcess && !frontendProcess.killed) {
        frontendProcess.kill("SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (!frontendProcess.killed) {
          frontendProcess.kill("SIGKILL");
        }
      } else {
        // Fall back to killing by PID
        await killProcessByPid(actualFrontendPid);
      }
      console.log("✅ Frontend server stopped");
    } catch (error) {
      console.error("Error stopping frontend server:", error);
      // Try force kill by PID as last resort
      if (actualFrontendPid) {
        await killProcessByPid(actualFrontendPid);
      }
    }
  }

  // Clean up any remaining processes on the ports (excluding our managed PIDs)
  const backendPort = 3333;
  const frontendPort = 5173;

  console.log("Cleaning up any remaining processes on ports...");
  await findAndKillProcessesOnPort(backendPort, pidsToExclude);
  await findAndKillProcessesOnPort(frontendPort, pidsToExclude);

  // Clean up process info file
  try {
    if (existsSync(processInfoPath)) {
      unlinkSync(processInfoPath);
    }
  } catch (error) {
    console.warn("Failed to remove process info file:", error);
  }

  console.log("✅ Test environment cleanup completed");
}

export default globalTeardown;
