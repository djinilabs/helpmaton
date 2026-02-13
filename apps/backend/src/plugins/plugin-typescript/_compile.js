/**
 * TypeScript compilation for Architect Lambdas (esbuild).
 * Ported from @architect/plugin-typescript with parallel-compile safety:
 * we remove only the current handler's output dir, not the entire build dir.
 */

const { join, dirname } = require('path');
const { existsSync, cpSync } = require('fs');
const { rm } = require('fs/promises');
const { build: esbuild } = require('esbuild');

function getTsConfig(dir) {
  const path = join(dir, 'tsconfig.json');
  if (existsSync(path)) return path;
  return false;
}

async function compileProject({ inventory }) {
  const { inv } = inventory;
  const { cwd } = inv._project;

  const tsLambdas = Object.values(inv.lambdasBySrcDir).filter(
    (l) => l.config.runtime === 'typescript',
  );
  const count = tsLambdas.length;
  const start = Date.now();
  const globalTsConfig = getTsConfig(cwd);

  console.log(`[plugin-typescript] Compiling TypeScript (${count} handlers)...`);

  let ok = true;
  async function go(lambda) {
    if (lambda.config.runtime !== 'typescript') return;
    try {
      await compileHandler({ inventory, lambda, globalTsConfig });
    } catch (err) {
      ok = false;
      console.error(`[plugin-typescript] esbuild error for @${lambda.pragma} ${lambda.name}:`, err);
    }
  }
  const compiles = Object.values(inv.lambdasBySrcDir).map(go);
  await Promise.allSettled(compiles);

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  if (ok) {
    console.log(`[plugin-typescript] Compiled ${count} handlers in ${elapsed}s`);
  } else {
    console.error(`[plugin-typescript] Completed with errors in ${elapsed}s`);
  }
}

async function compileHandler(params) {
  const { inventory, lambda, globalTsConfig } = params;
  const { arc, cwd } = inventory.inv._project;
  const { src, handlerFile, name, pragma } = lambda;

  const handlerStart = Date.now();
  console.log(`[plugin-typescript] Building @${pragma} ${name}...`);

  // Remove only this handler's output directory to avoid races when compiling in parallel
  const handlerOutDir = dirname(handlerFile);
  await rm(handlerOutDir, { recursive: true, force: true });

  let configPath;
  const settings = {
    sourcemaps: [], // no sourcemaps for now
  };
  if (arc.typescript) {
    arc.typescript.forEach((s) => {
      if (Array.isArray(s)) {
        if (s[0] === 'sourcemaps') settings.sourcemaps = [...s.slice(1)];
        if (s[0] === 'esbuild-config') configPath = join(cwd, s.slice(1)[0]);
      }
    });
  }

  let options = {
    entryPoints: [join(src, 'index.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: handlerFile,
  };
  if (configPath) {
     
    const config = require(configPath);
    options = { ...config, ...options };
  }

  const localConfig = getTsConfig(src);
  if (localConfig) options.tsconfig = localConfig;
  else if (globalTsConfig) options.tsconfig = globalTsConfig;

  await esbuild(options);

  // Copy skills folder so agent skills are available at runtime (path.join(__dirname, 'skills'))
  const skillsSrc = join(cwd, 'src', 'skills');
  if (existsSync(skillsSrc)) {
    const skillsDest = join(handlerOutDir, 'skills');
    cpSync(skillsSrc, skillsDest, { recursive: true });
  }

  const handlerElapsed = ((Date.now() - handlerStart) / 1000).toFixed(2);
  console.log(`[plugin-typescript] Built @${pragma} ${name} in ${handlerElapsed}s`);
}

module.exports = {
  compileHandler,
  compileProject,
  getTsConfig,
};
