#!/usr/bin/env node

/**
 * Wrapper script for Architect sandbox that handles signals gracefully
 * and ensures quick shutdown when Control-C is pressed.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const backendDir = join(projectRoot, 'apps', 'backend');

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
const SHUTDOWN_TIMEOUT_MS = 500; // 500ms before force kill
let forceKillTimeout = null;

function shutdown(force = false) {
  if (isShuttingDown && !force) {
    return;
  }
  
  if (isShuttingDown && force) {
    // Already shutting down, just force kill immediately
    if (sandboxProcess.pid && !sandboxProcess.killed) {
      try {
        sandboxProcess.kill('SIGKILL');
      } catch (error) {
        // Ignore errors
      }
    }
    process.exit(0);
    return;
  }

  isShuttingDown = true;

  if (forceKillTimeout) {
    clearTimeout(forceKillTimeout);
    forceKillTimeout = null;
  }

  if (sandboxProcess.pid && !sandboxProcess.killed) {
    if (force) {
      try {
        sandboxProcess.kill('SIGKILL');
      } catch (error) {
        // Ignore errors
      }
      process.exit(0);
    } else {
      // Send SIGTERM first
      try {
        sandboxProcess.kill('SIGTERM');
      } catch (error) {
        // Process might already be dead
        process.exit(0);
        return;
      }
      
      // Set a timeout to force kill if it doesn't exit quickly
      forceKillTimeout = setTimeout(() => {
        if (sandboxProcess.pid && !sandboxProcess.killed) {
          try {
            sandboxProcess.kill('SIGKILL');
          } catch (error) {
            // Ignore errors
          }
        }
        process.exit(0);
      }, SHUTDOWN_TIMEOUT_MS);
    }
  } else {
    process.exit(0);
  }
}

// Handle signals - forward immediately
process.on('SIGINT', () => {
  shutdown();
  // If we're still here after timeout, force kill
  setTimeout(() => {
    shutdown(true);
  }, SHUTDOWN_TIMEOUT_MS + 100);
});

process.on('SIGTERM', () => {
  shutdown();
});

// Handle process exit
process.on('exit', () => {
  if (sandboxProcess.pid && !sandboxProcess.killed) {
    try {
      sandboxProcess.kill('SIGKILL');
    } catch (error) {
      // Ignore errors on exit
    }
  }
});

// Forward sandbox process exit
sandboxProcess.on('exit', (code, signal) => {
  if (forceKillTimeout) {
    clearTimeout(forceKillTimeout);
    forceKillTimeout = null;
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
