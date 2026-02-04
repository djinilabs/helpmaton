/**
 * TypeScript compilation for Architect Lambdas (esbuild).
 * Ported from @architect/plugin-typescript with parallel-compile safety:
 * we remove only the current handler's output dir, not the entire build dir.
 */

const { join, dirname } = require('path');
const { existsSync } = require('fs');
const { rm } = require('fs/promises');
const { build: esbuild } = require('esbuild');

const sourceMapStatement = `require('source-map-support/register');\n//# sourceMappingURL=index.js.map`;

function getTsConfig(dir) {
  const path = join(dir, 'tsconfig.json');
  if (existsSync(path)) return path;
  return false;
}

async function compileProject({ inventory }) {
  const { inv } = inventory;
  const { cwd } = inv._project;

  const start = Date.now();
  const globalTsConfig = getTsConfig(cwd);
  let ok = true;
  console.log('Compiling TypeScript');

  async function go(lambda) {
    if (lambda.config.runtime !== 'typescript') return;
    try {
      await compileHandler({ inventory, lambda, globalTsConfig });
    } catch (err) {
      ok = false;
      console.log('esbuild error:', err);
    }
  }
  const compiles = Object.values(inv.lambdasBySrcDir).map(go);
  await Promise.allSettled(compiles);
  if (ok) console.log(`Compiled project in ${(Date.now() - start) / 1000}s`);
}

async function compileHandler(params) {
  const { inventory, lambda, globalTsConfig } = params;
  const { deployStage: stage } = inventory.inv._arc;
  const { arc, cwd } = inventory.inv._project;
  const { build, src, handlerFile } = lambda;
  const deployStage = stage || 'testing';

  // Remove only this handler's output directory to avoid races when compiling in parallel
  const handlerOutDir = dirname(handlerFile);
  await rm(handlerOutDir, { recursive: true, force: true });

  let configPath;
  const settings = {
    sourcemaps: ['testing', 'staging'],
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

  if (settings.sourcemaps.includes(deployStage)) {
    options.sourcemap = 'external';
    if (options.banner?.js) {
      options.banner.js = options.banner.js + '\n' + sourceMapStatement;
    } else {
      options.banner = { js: sourceMapStatement };
    }
    if (deployStage !== 'testing') {
      await esbuild({
        entryPoints: [join(cwd, 'node_modules', 'source-map-support', 'register')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outdir: join(build, 'node_modules', 'source-map-support'),
      });
    }
  }

  const localConfig = getTsConfig(src);
  if (localConfig) options.tsconfig = localConfig;
  else if (globalTsConfig) options.tsconfig = globalTsConfig;

  await esbuild(options);
}

module.exports = {
  compileHandler,
  compileProject,
  getTsConfig,
};
