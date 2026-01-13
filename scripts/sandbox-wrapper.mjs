#!/usr/bin/env node

/**
 * Wrapper script for Architect sandbox that handles signals gracefully
 * and ensures quick shutdown when Control-C is pressed.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const backendDir = join(projectRoot, 'apps', 'backend');

const isWindows = process.platform === 'win32';
const SHUTDOWN_WAIT_MS = 1000; // Wait 1 second before force killing

// Spawn the sandbox process
const sandboxProcess = spawn('pnpm', ['arc', 'sandbox'], {
  cwd: backendDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    ARC_DB_PATH: process.env.ARC_DB_PATH || './db',
  },
  shell: false,
});

let isShuttingDown = false;
let shutdownTimeout = null;
const sandboxPid = sandboxProcess.pid;

/**
 * Find all child processes of a given PID (recursively)
 */
async function findAllChildProcesses(parentPid) {
  if (isWindows) {
    // On Windows, use tasklist to find all child processes in the tree
    try {
      const { stdout } = await execAsync(
        `wmic process where (ParentProcessId=${parentPid}) get ProcessId /format:value 2>NUL`
      );
      const pids = stdout
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('ProcessId='))
        .map(line => parseInt(line.replace('ProcessId=', ''), 10))
        .filter(pid => !isNaN(pid));
      
      // Recursively find all descendants
      const allPids = [...pids];
      for (const pid of pids) {
        const children = await findAllChildProcesses(pid);
        allPids.push(...children);
      }
      return allPids;
    } catch {
      return [];
    }
  } else {
    // On Unix, use pgrep to find all descendants more efficiently
    try {
      // pgrep -P finds all processes with the given parent PID
      // We use a recursive approach with pstree or pgrep
      const { stdout } = await execAsync(
        `pgrep -P ${parentPid} 2>/dev/null || true`
      );
      const directChildren = stdout
        .split('\n')
        .map(line => parseInt(line.trim(), 10))
        .filter(pid => !isNaN(pid));
      
      // Recursively find all descendants
      const allChildren = [...directChildren];
      for (const childPid of directChildren) {
        const grandchildren = await findAllChildProcesses(childPid);
        allChildren.push(...grandchildren);
      }
      
      return allChildren;
    } catch {
      // Fallback: try ps
      try {
        const { stdout } = await execAsync(
          `ps -o pid --no-headers --ppid ${parentPid} 2>/dev/null || true`
        );
        const directChildren = stdout
          .split('\n')
          .map(line => parseInt(line.trim(), 10))
          .filter(pid => !isNaN(pid));
        
        const allChildren = [...directChildren];
        for (const childPid of directChildren) {
          const grandchildren = await findAllChildProcesses(childPid);
          allChildren.push(...grandchildren);
        }
        return allChildren;
      } catch {
        return [];
      }
    }
  }
}

/**
 * Kill a process and all its children
 */
async function killProcessTree(pid) {
  if (isWindows) {
    // On Windows, use taskkill to kill process tree
    try {
      await execAsync(`taskkill /F /T /PID ${pid} 2>NUL`);
    } catch (error) {
      // Process might already be dead, ignore
    }
  } else {
    // On Unix, find all children and kill them
    const children = await findAllChildProcesses(pid);
    
    // Kill all children first
    for (const childPid of children) {
      try {
        process.kill(childPid, 'SIGKILL');
      } catch (error) {
        // Process might already be dead, ignore
      }
    }
    
    // Then kill the parent
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      // Process might already be dead, ignore
    }
  }
}

/**
 * Check if a process is still alive
 */
async function isProcessAlive(pid) {
  if (isWindows) {
    try {
      await execAsync(`tasklist /FI "PID eq ${pid}" 2>NUL | find /I /N "${pid}"`);
      return true;
    } catch {
      return false;
    }
  } else {
    try {
      // Using kill -0 to check if process exists (doesn't actually kill)
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Send SIGTERM to the process and its children
 */
async function sendTermSignal(pid) {
  if (isWindows) {
    try {
      sandboxProcess.kill('SIGTERM');
    } catch (error) {
      // Ignore errors
    }
  } else {
    // Send SIGTERM to all children first
    const children = await findAllChildProcesses(pid);
    for (const childPid of children) {
      try {
        process.kill(childPid, 'SIGTERM');
      } catch (error) {
        // Ignore errors
      }
    }
    
    // Then send SIGTERM to the parent
    try {
      sandboxProcess.kill('SIGTERM');
    } catch (error) {
      // Ignore errors
    }
  }
}

function shutdown() {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  if (!sandboxPid) {
    process.exit(0);
    return;
  }

  // Send SIGTERM to all children immediately
  sendTermSignal(sandboxPid).catch(() => {
    // Ignore errors
  });

  // Wait 1 second, then force kill everything
  shutdownTimeout = setTimeout(async () => {
    // After 1 second, just kill everything aggressively
    await killProcessTree(sandboxPid);
    process.exit(0);
  }, SHUTDOWN_WAIT_MS);
}

// Handle signals
process.on('SIGINT', () => {
  shutdown();
});

process.on('SIGTERM', () => {
  shutdown();
});

// Handle process exit
process.on('exit', async () => {
  if (shutdownTimeout) {
    clearTimeout(shutdownTimeout);
  }
  if (sandboxPid) {
    await killProcessTree(sandboxPid);
  }
});

// Forward sandbox process exit
sandboxProcess.on('exit', (code, signal) => {
  if (shutdownTimeout) {
    clearTimeout(shutdownTimeout);
    shutdownTimeout = null;
  }
  if (code !== null) {
    process.exit(code);
  } else if (signal) {
    process.exit(1);
  } else {
    process.exit(0);
  }
});

sandboxProcess.on('error', (error) => {
  console.error('Error starting sandbox:', error);
  process.exit(1);
});
