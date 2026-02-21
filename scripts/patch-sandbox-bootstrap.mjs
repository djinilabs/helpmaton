#!/usr/bin/env node
/**
 * Postinstall: apply Lambda bootstrap + spawn fixes to all @architect/sandbox copies
 * that use our spawn patch (stdio inherit).
 * 1) Bootstrap: await handler promise so the Lambda POSTs the response before run() returns.
 * 2) Spawn temp-file: run -e "<huge string>" bootstrap from a temp file to avoid quoting/length issues.
 * 3) Spawn: wrap tree-kill in try/catch and fall back to process.kill on EBADF.
 * Run after pnpm install so the fix persists across installs.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pnpmDir = join(projectRoot, 'node_modules', '.pnpm');

const OLD = `        const response = handler(event, context, callback);
        if (isPromise(response)) {
          response.then(result => callback(null, result)).catch(callback);
        }`;

const NEW = `        const response = handler(event, context, callback);
        if (isPromise(response)) {
          try {
            const result = await response;
            await callback(null, result);
          } catch (err) {
            await callback(err);
          }
        }`;

const SPAWN_KILL_OLD = `    if (!isInLambda) {
      kill(pid, 'SIGINT', err => {
        if (err) {
          update.debug.status(\`[\${requestID}] tree-kill process termination error (pid \${pid})\`)
          update.debug.raw(err)
        }
        else update.debug.status(\`[\${requestID}] Successfully terminated process (pid \${pid})\`)
        // If we're in CI, it's best to wait for processes to terminate, even if slightly slower
        if (isTesting) done()
      })
    }`;

const SPAWN_KILL_NEW = `    if (!isInLambda) {
      try {
        kill(pid, 'SIGINT', err => {
          if (err) {
            update.debug.status(\`[\${requestID}] tree-kill process termination error (pid \${pid})\`)
            update.debug.raw(err)
          }
          else update.debug.status(\`[\${requestID}] Successfully terminated process (pid \${pid})\`)
          // If we're in CI, it's best to wait for processes to terminate, even if slightly slower
          if (isTesting) done()
        })
      } catch (e) {
        if (e.code === 'EBADF' || e.errno === -9) {
          update.debug.status(\`[\${requestID}] tree-kill EBADF, using process.kill(pid \${pid})\`)
          try { process.kill(pid, 'SIGINT') } catch (_) {}
          if (isTesting) done()
        } else throw e
      }
    }`;

const SPAWN_TEMP_FILE_OLD = `  function start () {
    child = spawn(command, args, spawnOpts)
    pid = child.pid`;

const SPAWN_TEMP_FILE_NEW = `  function start () {
    let finalArgs = args
    if (args[0] === '-e' && typeof args[1] === 'string' && args[1].length > 100) {
      const { writeFileSync, unlinkSync } = require('fs')
      const { join } = require('path')
      const { tmpdir } = require('os')
      const tmpFile = join(tmpdir(), \`arc-bootstrap-\${requestID}.js\`)
      const code = args[1].startsWith('"') && args[1].endsWith('"') ? args[1].slice(1, -1) : args[1]
      writeFileSync(tmpFile, code)
      finalArgs = [tmpFile]
      const cleanup = () => { try { unlinkSync(tmpFile) } catch (_) {} }
      process.once('exit', cleanup)
      setTimeout(cleanup, 60000)
    }
    child = spawn(command, finalArgs, spawnOpts)
    pid = child.pid`;

function main() {
  if (!existsSync(pnpmDir)) return;
  let bootstrapPatched = 0;
  let spawnPatched = 0;
  for (const name of readdirSync(pnpmDir, { withFileTypes: true })) {
    if (!name.isDirectory() || !name.name.startsWith('@architect+sandbox@')) continue;
    const sandboxRoot = join(pnpmDir, name.name, 'node_modules', '@architect', 'sandbox');
    const spawnPath = join(sandboxRoot, 'src', 'invoke-lambda', 'exec', 'spawn.js');
    const runtimePath = join(sandboxRoot, 'src', 'invoke-lambda', 'exec', 'runtimes', 'node.js');
    if (!existsSync(spawnPath) || !existsSync(runtimePath)) continue;
    let spawnContent = readFileSync(spawnPath, 'utf8');
    if (!spawnContent.includes("'ignore', 'inherit', 'inherit'")) continue;
    let spawnModified = false;
    if (!spawnContent.includes('finalArgs') && spawnContent.includes(SPAWN_TEMP_FILE_OLD)) {
      spawnContent = spawnContent.replace(SPAWN_TEMP_FILE_OLD, SPAWN_TEMP_FILE_NEW);
      spawnModified = true;
    }
    if (spawnContent.includes(SPAWN_KILL_OLD) && !spawnContent.includes('tree-kill EBADF')) {
      spawnContent = spawnContent.replace(SPAWN_KILL_OLD, SPAWN_KILL_NEW);
      spawnModified = true;
    }
    if (spawnModified) {
      writeFileSync(spawnPath, spawnContent);
      spawnPatched++;
    }
    let runtimeContent = readFileSync(runtimePath, 'utf8');
    if (runtimeContent.includes('await callback(null, result)')) continue;
    if (!runtimeContent.includes(OLD)) {
      console.warn('[patch-sandbox-bootstrap] runtimes/node.js format changed, skip:', runtimePath);
      continue;
    }
    runtimeContent = runtimeContent.replace(OLD, NEW);
    writeFileSync(runtimePath, runtimeContent);
    bootstrapPatched++;
  }
  if (bootstrapPatched > 0 || spawnPatched > 0) {
    console.log('[patch-sandbox-bootstrap] Applied bootstrap fix:', bootstrapPatched, '| spawn tree-kill fix:', spawnPatched);
  }
}

main();
