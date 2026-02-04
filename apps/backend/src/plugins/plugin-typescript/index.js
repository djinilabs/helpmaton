/**
 * TypeScript runtime and build plugin for Architect.
 * Ejected from @architect/plugin-typescript; provides set.runtimes, create.handlers,
 * deploy.start, and sandbox start/watcher hooks.
 */

const {
  compileProject,
  compileHandler,
  getTsConfig,
} = require('./_compile');

const handlers = require('./handlers');

module.exports = {
  set: {
    runtimes: function ({ inventory }) {
      const { arc } = inventory.inv._project;
      let build = '.build';
      let baseRuntime = 'nodejs20.x';
      if (arc.typescript) {
        const settings = Object.fromEntries(arc.typescript);
        if (settings.build && typeof settings.build === 'string') {
          build = settings.build;
        }
        if (settings['base-runtime'] && typeof settings['base-runtime'] === 'string') {
          baseRuntime = settings['base-runtime'];
        }
      }
      return {
        name: 'typescript',
        type: 'transpiled',
        build,
        baseRuntime,
      };
    },
  },
  create: {
    handlers: ({ lambda: { pragma } }) => {
      const body = handlers[pragma] ?? handlers.custom;
      return { filename: 'index.ts', body };
    },
  },
  deploy: {
    start: compileProject,
  },
  sandbox: {
    start: compileProject,
    watcher: async function (params) {
      const { filename, inventory } = params;
      if (!filename.endsWith('.ts') && !filename.endsWith('.tsx')) return;
      const { lambdasBySrcDir, shared, views } = inventory.inv;

      if (shared?.src && filename.startsWith(shared.src)) {
        await compileProject(params);
        return;
      }
      if (views?.src && filename.startsWith(views.src)) {
        await compileProject(params);
        return;
      }

      const lambda = Object.values(lambdasBySrcDir).find(({ src }) => filename.startsWith(src));
      if (!lambda) return;

      const start = Date.now();
      const { name, pragma } = lambda;
      const { cwd } = inventory.inv._project;
      const globalTsConfig = getTsConfig(cwd);
      console.log(`[plugin-typescript] Recompiling @${pragma} ${name}...`);
      try {
        await compileHandler({ inventory, lambda, globalTsConfig });
        console.log(`[plugin-typescript] Recompiled in ${((Date.now() - start) / 1000).toFixed(2)}s\n`);
      } catch (err) {
        console.error('[plugin-typescript] esbuild error:', err);
      }
    },
  },
};
