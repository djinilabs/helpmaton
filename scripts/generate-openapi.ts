#!/usr/bin/env tsx
/**
 * OpenAPI 3.1.1 specification generator
 *
 * Scans route files and handler files for JSDoc OpenAPI annotations
 * and generates a complete OpenAPI specification.
 */

import { readFileSync, writeFileSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { glob } from "glob";
import swaggerJsdoc from "swagger-jsdoc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");
const backendRoot = join(projectRoot, "apps/backend");
const frontendRoot = join(projectRoot, "apps/frontend");

/**
 * Parse app.arc to extract route-to-handler mappings
 */
function parseAppArc(): Map<string, { method: string; path: string }> {
  const arcPath = join(backendRoot, "app.arc");
  const arcContent = readFileSync(arcPath, "utf-8");
  const routeMap = new Map<string, { method: string; path: string }>();

  // Parse @http section
  const httpSection = arcContent.match(/@http\s+([\s\S]*?)(?=@|\n\n|$)/);
  if (!httpSection) {
    console.warn("No @http section found in app.arc");
    return routeMap;
  }

  const routes = httpSection[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  for (const route of routes) {
    const parts = route.trim().split(/\s+/);
    if (parts.length < 2) continue;

    const method = parts[0].toLowerCase();
    const path = parts[1];

    // Map handler directory pattern to route
    // e.g., "get /api/usage" -> "get-api-usage"
    // e.g., "post /api/webhook/:workspaceId/:agentId/:key" -> "post-api-webhook-000workspaceId-000agentId-000key"
    const processedPath = path
      .replace(/^\/api\//, "")
      .replace(/\//g, "-")
      .replace(/:/g, "000");
    const handlerName = `${method}-${processedPath}`;

    routeMap.set(handlerName, { method, path });
  }

  return routeMap;
}

/**
 * Find all files that might contain OpenAPI annotations
 */
async function findSourceFiles(): Promise<string[]> {
  const files: string[] = [];

  // Find Express app files
  const appFiles = await glob("**/*-app.ts", {
    cwd: join(backendRoot, "src/http"),
    absolute: true,
  });
  files.push(...appFiles);

  // Find route files
  const routeFiles = await glob("**/routes/*.ts", {
    cwd: join(backendRoot, "src/http"),
    absolute: true,
  });
  files.push(...routeFiles);

  // Find simple handler files (index.ts in handler directories)
  const handlerFiles = await glob("**/index.ts", {
    cwd: join(backendRoot, "src/http"),
    absolute: true,
    ignore: ["**/__tests__/**", "**/node_modules/**"],
  });
  files.push(...handlerFiles);

  return files;
}

/**
 * Generate OpenAPI specification
 */
async function generateOpenApi(): Promise<void> {
  console.log("🔍 Scanning for OpenAPI annotations...");

  const sourceFiles = await findSourceFiles();
  console.log(`📁 Found ${sourceFiles.length} source files to scan`);

  const routeMap = parseAppArc();
  console.log(`🗺️  Mapped ${routeMap.size} routes from app.arc`);

  // Load base config from JSON
  const configPath = join(backendRoot, "src/openapi/config.json");
  const openApiConfig = JSON.parse(readFileSync(configPath, "utf-8"));

  // Dynamically import schemas (tsx handles TypeScript imports)
  const schemasModule = await import(
    join(backendRoot, "src/openapi/schemas.ts")
  );
  const openApiSchemas = schemasModule.openApiSchemas;

  // Configure swagger-jsdoc
  const options: swaggerJsdoc.Options = {
    definition: {
      ...openApiConfig,
      components: {
        ...openApiConfig.components,
        schemas: openApiSchemas,
      },
    },
    apis: sourceFiles, // Path to the API files
  };

  try {
    const swaggerSpec = swaggerJsdoc(options);

    // Ensure OpenAPI version is 3.1.1
    if (swaggerSpec.openapi !== "3.1.1") {
      swaggerSpec.openapi = "3.1.1";
    }

    // Validate that we have paths
    if (!swaggerSpec.paths || Object.keys(swaggerSpec.paths).length === 0) {
      console.warn(
        "⚠️  No paths found in generated spec. Make sure routes have @openapi JSDoc annotations."
      );
    } else {
      console.log(
        `✅ Generated spec with ${Object.keys(swaggerSpec.paths).length} paths`
      );
    }

    // Write JSON output to backend (for reference)
    const backendOutputPath = join(backendRoot, "openapi.json");
    writeFileSync(
      backendOutputPath,
      JSON.stringify(swaggerSpec, null, 2),
      "utf-8"
    );
    console.log(`📄 OpenAPI spec written to: ${backendOutputPath}`);

    // Copy to frontend public directory so it's included in the build and publicly accessible
    const frontendPublicPath = join(frontendRoot, "public", "openapi.json");
    copyFileSync(backendOutputPath, frontendPublicPath);
    console.log(
      `📄 OpenAPI spec copied to: ${frontendPublicPath} (will be available at /openapi.json)`
    );

    // Optionally write YAML output (would need js-yaml dependency)
    // const yaml = require('js-yaml');
    // const yamlPath = join(backendRoot, 'openapi.yaml');
    // writeFileSync(yamlPath, yaml.dump(swaggerSpec), 'utf-8');
    // console.log(`📄 OpenAPI spec (YAML) written to: ${yamlPath}`);
  } catch (error) {
    console.error("❌ Error generating OpenAPI spec:", error);
    if (error instanceof Error) {
      console.error("Stack:", error.stack);
    }
    process.exit(1);
  }
}

// Run if executed directly
generateOpenApi().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
