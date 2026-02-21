#!/usr/bin/env node

/**
 * Wrapper script for pnpm dev that handles signals gracefully
 * and ensures quick shutdown when Control-C is pressed.
 * Kills all child processes including backend, frontend, and watchers.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, appendFileSync } from 'fs';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = process.cwd();
const logFile = join(__dirname, '..', '.dev-wrapper.log');

const isWindows = process.platform === 'win32';
const SHUTDOWN_WAIT_MS = 1000; // Wait 1 second before force killing

// Logging function that writes to both stderr and file
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  try {
    process.stderr.write(logMessage);
    appendFileSync(logFile, logMessage);
  } catch (error) {
    // If we can't write, at least try stderr
    try {
      process.stderr.write(logMessage);
    } catch {
      // Ignore
    }
  }
}

// Spawn backend and frontend as direct children with stdio: 'inherit' so the
// Architect sandbox gets real FDs and does not hit spawn EBADF when invoking Lambdas.
const backendProcess = spawn('node', [join(__dirname, 'sandbox-wrapper.mjs')], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: false,
  env: process.env,
});
const frontendProcess = spawn('pnpm', ['dev'], {
  cwd: join(projectRoot, 'apps', 'frontend'),
  stdio: 'inherit',
  shell: false,
  env: process.env,
});

let isShuttingDown = false;
let shutdownTimeout = null;
const backendPid = backendProcess.pid;
const frontendPid = frontendProcess.pid;

// Clear log file on start
try {
  writeFileSync(logFile, '');
} catch {
  // Ignore if we can't write
}

log(`[dev-wrapper] Backend PID: ${backendPid}, Frontend PID: ${frontendPid}`);
log(`[dev-wrapper] Parent process PID: ${process.pid}`);

/**
 * Find all processes on specific ports (backend and frontend)
 */
async function findProcessesOnPorts(ports) {
  if (isWindows) {
    const pids = [];
    for (const port of ports) {
      try {
        const { stdout } = await execAsync(
          `netstat -ano | findstr :${port}`
        );
        const lines = stdout.split('\n');
        for (const line of lines) {
          const match = line.match(/\s+(\d+)\s*$/);
          if (match) {
            const pid = parseInt(match[1], 10);
            if (!isNaN(pid) && !pids.includes(pid)) {
              pids.push(pid);
            }
          }
        }
      } catch {
        // Port might not be in use
      }
    }
    return pids;
  } else {
    const pids = [];
    for (const port of ports) {
      try {
        const { stdout } = await execAsync(
          `lsof -ti :${port} 2>/dev/null || true`
        );
        const portPids = stdout
          .split('\n')
          .map(line => parseInt(line.trim(), 10))
          .filter(pid => !isNaN(pid));
        pids.push(...portPids);
      } catch {
        // Port might not be in use
      }
    }
    return [...new Set(pids)]; // Remove duplicates
  }
}

/**
 * Find all child processes of a given PID (recursively)
 */
async function findAllChildProcesses(parentPid) {
  log(`[dev-wrapper] Finding children of PID: ${parentPid}`);
  if (isWindows) {
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
      
      const allPids = [...pids];
      for (const pid of pids) {
        const children = await findAllChildProcesses(pid);
        allPids.push(...children);
      }
      log(`[dev-wrapper] Found ${allPids.length} child processes on Windows`);
      return allPids;
    } catch (error) {
      log(`[dev-wrapper] Error finding children on Windows: ${error.message}`);
      return [];
    }
  } else {
    try {
      const { stdout } = await execAsync(
        `pgrep -P ${parentPid} 2>/dev/null || true`
      );
      const directChildren = stdout
        .split('\n')
        .map(line => parseInt(line.trim(), 10))
        .filter(pid => !isNaN(pid));
      
      log(`[dev-wrapper] Found ${directChildren.length} direct children: ${directChildren.join(', ')}`);
      const allChildren = [...directChildren];
      for (const childPid of directChildren) {
        const grandchildren = await findAllChildProcesses(childPid);
        allChildren.push(...grandchildren);
      }
      log(`[dev-wrapper] Total children (including descendants): ${allChildren.length}`);
      return allChildren;
    } catch {
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
  log(`[dev-wrapper] killProcessTree called for PID: ${pid}`);
  if (isWindows) {
    try {
      log(`[dev-wrapper] Killing process tree on Windows: ${pid}`);
      await execAsync(`taskkill /F /T /PID ${pid} 2>NUL`);
      log(`[dev-wrapper] Successfully killed process tree on Windows`);
    } catch (error) {
      log(`[dev-wrapper] Error killing process tree on Windows: ${error.message}`);
      // Process might already be dead, ignore
    }
  } else {
    const children = await findAllChildProcesses(pid);
    log(`[dev-wrapper] Killing ${children.length} children of PID ${pid}`);
    
    // Kill all children first
    for (const childPid of children) {
      try {
        log(`[dev-wrapper] Sending SIGKILL to child PID: ${childPid}`);
        process.kill(childPid, 'SIGKILL');
      } catch (error) {
        log(`[dev-wrapper] Error killing child ${childPid}: ${error.message}`);
        // Process might already be dead, ignore
      }
    }
    
    // Then kill the parent
    try {
      log(`[dev-wrapper] Sending SIGKILL to parent PID: ${pid}`);
      process.kill(pid, 'SIGKILL');
      log(`[dev-wrapper] Successfully sent SIGKILL to parent`);
    } catch (error) {
      log(`[dev-wrapper] Error killing parent ${pid}: ${error.message}`);
      // Process might already be dead, ignore
    }
  }
}

/**
 * Kill all processes on specific ports
 */
async function killProcessesOnPorts(ports) {
  log(`[dev-wrapper] Finding processes on ports: ${ports.join(', ')}`);
  const pids = await findProcessesOnPorts(ports);
  log(`[dev-wrapper] Found ${pids.length} processes on ports: ${pids.join(', ')}`);
  for (const pid of pids) {
    try {
      log(`[dev-wrapper] Killing process ${pid} on port`);
      if (isWindows) {
        await execAsync(`taskkill /F /PID ${pid} 2>NUL`);
      } else {
        process.kill(pid, 'SIGKILL');
      }
      log(`[dev-wrapper] Successfully killed process ${pid}`);
    } catch (error) {
      log(`[dev-wrapper] Error killing process ${pid} on port: ${error.message}`);
      // Process might already be dead, ignore
    }
  }
}

/**
 * Send SIGTERM to a process and its children
 */
async function sendTermSignal(pid) {
  log(`[dev-wrapper] sendTermSignal called for PID: ${pid}`);
  if (isWindows) {
    try {
      const proc = pid === backendPid ? backendProcess : frontendProcess;
      if (proc) proc.kill('SIGTERM');
      log(`[dev-wrapper] Successfully sent SIGTERM on Windows`);
    } catch (error) {
      log(`[dev-wrapper] Error sending SIGTERM on Windows: ${error.message}`);
      // Ignore errors
    }
  } else {
    const children = await findAllChildProcesses(pid);
    log(`[dev-wrapper] Sending SIGTERM to ${children.length} children`);
    for (const childPid of children) {
      try {
        process.kill(childPid, 'SIGTERM');
      } catch (error) {
        log(`[dev-wrapper] Error sending SIGTERM to child ${childPid}: ${error.message}`);
      }
    }
    try {
      log(`[dev-wrapper] Sending SIGTERM to parent PID: ${pid}`);
      process.kill(pid, 'SIGTERM');
      log(`[dev-wrapper] Successfully sent SIGTERM to parent`);
    } catch (error) {
      log(`[dev-wrapper] Error sending SIGTERM to parent: ${error.message}`);
    }
  }
}

function shutdown() {
  const startTime = Date.now();
  log(`[dev-wrapper] shutdown() called at ${new Date().toISOString()}`);
  
  if (isShuttingDown) {
    log(`[dev-wrapper] Already shutting down, ignoring`);
    return;
  }
  isShuttingDown = true;

  const pids = [backendPid, frontendPid].filter(Boolean);
  if (pids.length === 0) {
    log(`[dev-wrapper] No PIDs, exiting immediately`);
    process.exit(0);
    return;
  }

  log(`[dev-wrapper] Sending SIGTERM to PIDs ${pids.join(', ')} and all children...`);
  Promise.all(pids.map((pid) => sendTermSignal(pid))).catch((error) => {
    log(`[dev-wrapper] Error in sendTermSignal: ${error.message}`);
  });

  log(`[dev-wrapper] Setting timeout to force kill after ${SHUTDOWN_WAIT_MS}ms`);
  shutdownTimeout = setTimeout(async () => {
    const timeoutStartTime = Date.now();
    log(`[dev-wrapper] Timeout callback triggered at ${new Date().toISOString()} (${timeoutStartTime - startTime}ms after shutdown started)`);
    try {
      log(`[dev-wrapper] Force killing process trees...`);
      for (const pid of pids) {
        await killProcessTree(pid);
      }
      log(`[dev-wrapper] Killing processes on ports 3333 and 5173...`);
      await killProcessesOnPorts([3333, 5173]);
      log(`[dev-wrapper] Force kill completed in ${Date.now() - timeoutStartTime}ms`);
    } catch (error) {
      log(`[dev-wrapper] Error in force kill: ${error.message}`);
    }
    log(`[dev-wrapper] Exiting process`);
    process.exit(0);
  }, SHUTDOWN_WAIT_MS);
}

// Handle signals - set up handlers immediately
// CRITICAL: We must prevent default behavior so signals come to us, not the child
log(`[dev-wrapper] Setting up signal handlers...`);
process.on('SIGINT', (signal) => {
  log(`[dev-wrapper] SIGINT received at ${new Date().toISOString()}`);
  // Don't let the signal propagate to child processes
  shutdown();
});

process.on('SIGTERM', (signal) => {
  log(`[dev-wrapper] SIGTERM received at ${new Date().toISOString()}`);
  shutdown();
});

// Also handle SIGHUP in case terminal closes
process.on('SIGHUP', () => {
  log(`[dev-wrapper] SIGHUP received at ${new Date().toISOString()}`);
  shutdown();
});

// Also handle uncaught exceptions to see if something is wrong
process.on('uncaughtException', (error) => {
  log(`[dev-wrapper] Uncaught exception: ${error.message}`);
  log(`[dev-wrapper] Stack: ${error.stack}`);
});

process.on('unhandledRejection', (reason) => {
  log(`[dev-wrapper] Unhandled rejection: ${reason}`);
});

// Handle process exit
process.on('exit', async () => {
  if (shutdownTimeout) {
    clearTimeout(shutdownTimeout);
  }
  for (const pid of [backendPid, frontendPid].filter(Boolean)) {
    await killProcessTree(pid);
  }
  await killProcessesOnPorts([3333, 5173]);
});

function onChildExit(name, code, signal) {
  if (shutdownTimeout) {
    clearTimeout(shutdownTimeout);
    shutdownTimeout = null;
  }
  const exitCode = code !== null ? code : signal ? 1 : 0;
  log(`[dev-wrapper] ${name} exited (code=${code}, signal=${signal}), killing sibling and exiting with ${exitCode}`);
  const otherPid = name === 'Backend' ? frontendPid : backendPid;
  if (otherPid) {
    killProcessTree(otherPid).then(() => process.exit(exitCode)).catch(() => process.exit(exitCode));
  } else {
    process.exit(exitCode);
  }
}

backendProcess.on('exit', (code, signal) => onChildExit('Backend', code, signal));
frontendProcess.on('exit', (code, signal) => onChildExit('Frontend', code, signal));
backendProcess.on('error', (error) => {
  log(`[dev-wrapper] Error starting backend: ${error.message}`);
  process.exit(1);
});
frontendProcess.on('error', (error) => {
  log(`[dev-wrapper] Error starting frontend: ${error.message}`);
  process.exit(1);
});

log(`[dev-wrapper] Wrapper initialized, waiting for signals...`);
