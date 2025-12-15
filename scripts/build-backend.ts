#!/usr/bin/env tsx
/**
 * Build script for backend Lambda functions using esbuild
 * This compiles TypeScript files to the dist/ directory, similar to what
 * Architect's TypeScript plugin does during arc package/deploy
 */

import { build } from "esbuild";
import { readdir, stat, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const esbuildConfig = require("../esbuild-config.cjs");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendSrc = join(__dirname, "../apps/backend/src");
const backendDist = join(__dirname, "../apps/backend/dist");

/**
 * Recursively find all TypeScript entry points (index.ts files)
 */
async function findEntryPoints(
  dir: string,
  baseDir: string = dir
): Promise<string[]> {
  const entries: string[] = [];
  const items = await readdir(dir);

  for (const item of items) {
    const fullPath = join(dir, item);
    const itemStat = await stat(fullPath);

    if (itemStat.isDirectory()) {
      // Skip test directories and node_modules
      if (item === "__tests__" || item === "node_modules" || item === "dist") {
        continue;
      }
      entries.push(...(await findEntryPoints(fullPath, baseDir)));
    } else if (item === "index.ts") {
      entries.push(fullPath);
    }
  }

  return entries;
}

/**
 * Convert source path to dist path
 * e.g., src/http/any-api-streams/index.ts -> dist/http/any-api-streams/index.js
 */
function getOutputPath(sourcePath: string): string {
  const relativePath = sourcePath.replace(backendSrc, "").replace(/^\//, "");
  const distPath = join(backendDist, relativePath.replace(/\.ts$/, ".js"));
  return distPath;
}

async function buildBackend() {
  console.log("🔨 Building backend Lambda functions with esbuild...\n");

  // Ensure dist directory exists
  await mkdir(backendDist, { recursive: true });

  // Find all entry points
  const entryPoints = await findEntryPoints(backendSrc);
  console.log(`Found ${entryPoints.length} entry points\n`);

  // Build each entry point
  const builds = entryPoints.map(async (entryPoint) => {
    const outputPath = getOutputPath(entryPoint);
    const outputDir = dirname(outputPath);

    // Ensure output directory exists
    await mkdir(outputDir, { recursive: true });

    try {
      await build({
        entryPoints: [entryPoint],
        bundle: true,
        platform: "node",
        target: "node20",
        format: "esm",
        outfile: outputPath,
        external: [
          // AWS SDK v3
          "@aws-sdk/*",
          // AWS SDK v2
          "aws-sdk",
          // Lambda runtime
          "awslambda",
        ],
        ...esbuildConfig,
      });

      console.log(
        `✅ Built: ${entryPoint.replace(
          backendSrc + "/",
          ""
        )} -> ${outputPath.replace(backendDist + "/", "")}`
      );
      return { entryPoint, success: true };
    } catch (error) {
      console.error(`❌ Failed to build ${entryPoint}:`, error);
      return { entryPoint, success: false, error };
    }
  });

  const results = await Promise.all(builds);
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success);

  console.log(
    `\n📊 Build complete: ${successful}/${results.length} successful`
  );

  if (failed.length > 0) {
    console.error(`\n❌ ${failed.length} build(s) failed:`);
    failed.forEach(({ entryPoint, error }) => {
      console.error(`  - ${entryPoint}: ${error}`);
    });
    process.exit(1);
  }
}

buildBackend().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

