#!/usr/bin/env node

/**
 * Wrapper script for Architect sandbox that handles signals gracefully
 * and ensures quick shutdown when Control-C is pressed.
 */

import { spawn, execSync } from 'child_process';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

/** Find @architect/sandbox CLI in pnpm store. Prefer the copy that has our spawn patch (patchedDependencies). */
function findSandboxCliInPnpm() {
  const pnpmDir = join(projectRoot, 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) return null;
  try {
    const entries = readdirSync(pnpmDir, { withFileTypes: true });
    const candidates = [];
    for (const e of entries) {
      if (e.isDirectory() && e.name.startsWith('@architect+sandbox@')) {
        const cliPath = join(pnpmDir, e.name, 'node_modules', '@architect', 'sandbox', 'src', 'cli', 'cli.js');
        const spawnPath = join(pnpmDir, e.name, 'node_modules', '@architect', 'sandbox', 'src', 'invoke-lambda', 'exec', 'spawn.js');
        if (existsSync(cliPath)) candidates.push({ cliPath, spawnPath });
      }
    }
    // Prefer the copy with our patch (minimal spawnOpts + env sanitization)
    for (const { cliPath, spawnPath } of candidates) {
      if (existsSync(spawnPath)) {
        const content = readFileSync(spawnPath, 'utf8');
        if (content.includes('spawnOpts') && content.includes("'ignore', 'inherit', 'inherit'")) return cliPath;
      }
    }
    return candidates[0]?.cliPath ?? null;
  } catch {
    return null;
  }
}

/** First sandbox CLI path in .pnpm (any copy) – used when we need Node 20 launcher but no patched copy matched. */
function findAnySandboxCliInPnpm() {
  const pnpmDir = join(projectRoot, 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) return null;
  try {
    const entries = readdirSync(pnpmDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && e.name.startsWith('@architect+sandbox@')) {
        const cliPath = join(pnpmDir, e.name, 'node_modules', '@architect', 'sandbox', 'src', 'cli', 'cli.js');
        if (existsSync(cliPath)) return cliPath;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const backendDir = join(projectRoot, 'apps', 'backend');

const isWindows = process.platform === 'win32';
const SHUTDOWN_WAIT_MS = 1000; // Wait 1 second before force killing

/** Resolve Node 20 binary path (nvm) so we can run sandbox under Node 20 and avoid spawn EBADF on Node 24+. */
function resolveNode20Path() {
  const nvmDir = process.env.NVM_DIR || (process.env.HOME && join(process.env.HOME, '.nvm'));
  if (!nvmDir || !existsSync(join(nvmDir, 'versions', 'node'))) return null;
  try {
    const versions = readdirSync(join(nvmDir, 'versions', 'node'), { withFileTypes: true });
    const v20 = versions.filter((e) => e.isDirectory() && e.name.startsWith('v20.')).map((e) => e.name).sort((a, b) => b.localeCompare(a))[0];
    if (!v20) return null;
    const nodePath = join(nvmDir, 'versions', 'node', v20, 'bin', 'node');
    return existsSync(nodePath) ? nodePath : null;
  } catch {
    return null;
  }
}

/** Run sandbox via node directly (direct child, real stdio). On Node 24+ run with Node 20 binary so Lambda spawn doesn't hit EBADF. */
function getSandboxCommandAndArgs() {
  const debugFlag = process.env.ARC_SANDBOX_DEBUG ? ['--debug'] : [];
  const major = parseInt(process.version.slice(1).split('.')[0], 10);
  if (major >= 24 && !isWindows) {
    const node20 = resolveNode20Path();
    const cliPath = findSandboxCliInPnpm() ?? findAnySandboxCliInPnpm();
    if (node20 && cliPath) return { command: node20, args: [cliPath, ...debugFlag] };
  }
  const cliPath = join(backendDir, 'node_modules', '@architect', 'sandbox', 'src', 'cli', 'cli.js');
  const rootCliPath = join(projectRoot, 'node_modules', '@architect', 'sandbox', 'src', 'cli', 'cli.js');
  const pnpmCli = findSandboxCliInPnpm() ?? findAnySandboxCliInPnpm();
  if (existsSync(cliPath)) return { command: 'node', args: [cliPath, ...debugFlag] };
  if (existsSync(rootCliPath)) return { command: 'node', args: [rootCliPath, ...debugFlag] };
  if (pnpmCli) return { command: 'node', args: [pnpmCli, ...debugFlag] };
  return { command: 'pnpm', args: ['arc', 'sandbox', ...debugFlag] };
}

// Ensure internal docs are generated so workspace/meta-agent have up-to-date index.
// Skip generation when output is already newer than the script and all docs (fast startup).
function shouldGenerateInternalDocs() {
  const outputPath = join(projectRoot, 'apps', 'backend', 'src', 'utils', 'internalDocs.ts');
  const scriptPath = join(projectRoot, 'scripts', 'generate-internal-docs.mjs');
  const docsDir = join(projectRoot, 'docs');
  try {
    const outStat = statSync(outputPath, { throwIfNoEntry: false });
    if (!outStat) return true;
    const outMtime = outStat.mtimeMs;
    const scriptStat = statSync(scriptPath, { throwIfNoEntry: false });
    if (scriptStat && scriptStat.mtimeMs > outMtime) return true;
    const entries = readdirSync(docsDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.md')) {
        const st = statSync(join(docsDir, e.name), { throwIfNoEntry: false });
        if (st && st.mtimeMs > outMtime) return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

if (shouldGenerateInternalDocs()) {
  try {
    execSync('node scripts/generate-internal-docs.mjs', { cwd: projectRoot, stdio: 'inherit' });
  } catch (err) {
    console.error('Internal docs generator failed; sandbox may have stale or missing docs.');
    process.exit(1);
  }
}

// Spawn the sandbox process. Use Node 20 when current Node is 24+ so the sandbox runs on
// Node 20 (avoids spawn EBADF in @architect/sandbox on Node 24).
// Use stdin as pipe so we can intercept Ctrl-C (\x03); stdout/stderr stay inherit so the
// sandbox's Lambda spawn() doesn't hit EBADF and output is visible.
const { command: sandboxCommand, args: sandboxArgs } = getSandboxCommandAndArgs();
const sandboxEnv = {
  ...process.env,
  ARC_DB_PATH: process.env.ARC_DB_PATH || './db',
};
const sandboxProcess = spawn(sandboxCommand, sandboxArgs, {
  cwd: backendDir,
  stdio: ['pipe', 'inherit', 'inherit'],
  env: sandboxEnv,
  shell: false,
});

let isShuttingDown = false;
let shutdownTimeout = null;
const sandboxPid = sandboxProcess.pid;

// Intercept Ctrl-C from stdin so we always see it (SIGINT may go to sandbox's process group only).
if (process.stdin.isTTY && sandboxPid) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    if (chunk.includes('\u0003')) {
      shutdown();
      return;
    }
    if (sandboxProcess.stdin && !sandboxProcess.killed) {
      sandboxProcess.stdin.write(chunk);
    }
  });
}

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

function shutdown() {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  if (!sandboxPid) {
    process.exit(0);
    return;
  }

  // Kill sandbox and its tree, then exit. SIGINT may never reach us (e.g. when run under pnpm),
  // so we rely on stdin Ctrl-C (\x03) when isTTY; this path is also used for SIGINT when we get it.
  killProcessTree(sandboxPid)
    .then(() => process.exit(0))
    .catch(() => process.exit(0));
}

// Backup: if we do receive SIGINT (e.g. run as `node scripts/sandbox-wrapper.mjs`), handle it
process.on('SIGINT', () => {
  shutdown();
});

process.on('SIGTERM', () => {
  shutdown();
});

// Best-effort sync kill on exit (Node does not wait for async in 'exit' handlers)
process.on('exit', () => {
  if (shutdownTimeout) {
    clearTimeout(shutdownTimeout);
  }
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // ignore
    }
  }
  if (sandboxPid) {
    try {
      process.kill(sandboxPid, 'SIGKILL');
    } catch {
      // already dead
    }
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
