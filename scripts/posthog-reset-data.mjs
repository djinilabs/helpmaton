#!/usr/bin/env node
/**
 * PostHog reset: remove all people and events from a project via API.
 *
 * Requires a Personal API key with scopes: person:read, person:write.
 * Project ID: from PostHog project settings or the project URL.
 * POSTHOG_HOST: private API base (https://us.posthog.com or https://eu.posthog.com),
 * not the ingestion host (us.i.posthog.com).
 *
 * Env:
 *   POSTHOG_PERSONAL_API_KEY  (required) Personal API key with person:read and person:write
 *   POSTHOG_PROJECT_ID       (required) Project ID from PostHog project settings / URL
 *   POSTHOG_HOST             (optional) Default https://us.posthog.com (EU: https://eu.posthog.com)
 *
 * Usage:
 *   node scripts/posthog-reset-data.mjs           # List persons and print count (no delete)
 *   node scripts/posthog-reset-data.mjs --confirm   # List then bulk-delete all (with events/recordings)
 */

const DEFAULT_HOST = "https://us.posthog.com";
const LIST_PAGE_SIZE = 100;
const BULK_DELETE_MAX_IDS = 1000;
const DELAY_BETWEEN_BULK_MS = 300;

const COLORS = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
};

const printInfo = (msg) => console.log(`${COLORS.blue}[INFO]${COLORS.reset} ${msg}`);
const printSuccess = (msg) => console.log(`${COLORS.green}[SUCCESS]${COLORS.reset} ${msg}`);
const printWarning = (msg) => console.log(`${COLORS.yellow}[WARNING]${COLORS.reset} ${msg}`);
const printError = (msg) => console.error(`${COLORS.red}[ERROR]${COLORS.reset} ${msg}`);

function showUsage() {
  console.log("Usage: node scripts/posthog-reset-data.mjs [options]");
  console.log("");
  console.log("Removes all persons and their events/recordings from a PostHog project.");
  console.log("Without --confirm, only lists persons and prints the count.");
  console.log("");
  console.log("Options:");
  console.log("  --confirm    Actually perform bulk delete (default: list only)");
  console.log("  -h, --help  Show this help");
  console.log("");
  console.log("Env (required unless --help):");
  console.log("  POSTHOG_PERSONAL_API_KEY   Personal API key (person:read, person:write)");
  console.log("  POSTHOG_PROJECT_ID         Project ID from PostHog");
  console.log("  POSTHOG_HOST               Optional; default " + DEFAULT_HOST);
}

function parseArgs(argv) {
  let confirm = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--confirm") confirm = true;
    else if (arg === "-h" || arg === "--help") {
      showUsage();
      process.exit(0);
    }
  }
  return { confirm };
}

/**
 * Try list endpoint; return { basePath } for list/bulk_delete, or null if 404.
 * basePath is either "/api/environments/:id" or "/api/projects/:id".
 */
async function detectApiPath(baseUrl, projectId, apiKey) {
  const envPath = `/api/environments/${projectId}/persons/?limit=1`;
  const url = new URL(envPath, baseUrl);
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (res.ok) {
    return `/api/environments/${projectId}`;
  }
  if (res.status === 404) {
    const projPath = `/api/projects/${projectId}/persons/?limit=1`;
    const projUrl = new URL(projPath, baseUrl);
    const projRes = await fetch(projUrl.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });
    if (projRes.ok) return `/api/projects/${projectId}`;
  }
  return null;
}

/**
 * Fetch all person IDs via paginated list.
 */
async function listAllPersonIds(baseUrl, basePath, apiKey) {
  const ids = [];
  let offset = 0;
  for (;;) {
    const path = `${basePath}/persons/?limit=${LIST_PAGE_SIZE}&offset=${offset}`;
    const url = new URL(path, baseUrl);
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`List persons failed: ${res.status} ${res.statusText} - ${text}`);
    }
    const data = await res.json();
    const results = data.results || [];
    for (const person of results) {
      if (person.id != null) ids.push(person.id);
    }
    if (results.length === 0) break;
    offset += results.length;
    if (results.length < LIST_PAGE_SIZE) break;
  }
  return ids;
}

/**
 * Bulk delete up to BULK_DELETE_MAX_IDS persons; delete_events and delete_recordings true.
 */
async function bulkDeletePersons(baseUrl, basePath, apiKey, personIds) {
  const path = `${basePath}/persons/bulk_delete/?delete_events=true&delete_recordings=true`;
  const url = new URL(path, baseUrl);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ids: personIds }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bulk delete failed: ${res.status} ${res.statusText} - ${text}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const baseUrl = (process.env.POSTHOG_HOST || DEFAULT_HOST).replace(/\/+$/, "");

  if (!apiKey || !projectId) {
    printError("POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID must be set.");
    showUsage();
    process.exit(1);
  }

  printInfo(`Using host: ${baseUrl}, project: ${projectId}`);

  const basePath = await detectApiPath(baseUrl, projectId, apiKey);
  if (!basePath) {
    printError("Could not list persons (tried environments and projects API). Check project ID and API key scopes (person:read).");
    process.exit(1);
  }
  printInfo(`Using API path: ${basePath}`);

  printInfo("Listing all persons...");
  const personIds = await listAllPersonIds(baseUrl, basePath, apiKey);
  const total = personIds.length;
  printInfo(`Total persons: ${total}`);

  if (total === 0) {
    printSuccess("No persons to delete.");
    return;
  }

  if (!args.confirm) {
    printWarning("Run with --confirm to delete all persons and their events/recordings.");
    return;
  }

  printInfo(`Deleting ${total} persons in batches of ${BULK_DELETE_MAX_IDS}...`);
  let deleted = 0;
  for (let i = 0; i < personIds.length; i += BULK_DELETE_MAX_IDS) {
    const chunk = personIds.slice(i, i + BULK_DELETE_MAX_IDS);
    await bulkDeletePersons(baseUrl, basePath, apiKey, chunk);
    deleted += chunk.length;
    printInfo(`Deleted ${deleted}/${total} persons.`);
    if (i + BULK_DELETE_MAX_IDS < personIds.length) {
      await sleep(DELAY_BETWEEN_BULK_MS);
    }
  }
  printSuccess(`Done. Deleted ${deleted} persons (and their events/recordings).`);
}

main().catch((err) => {
  printError(err.message || String(err));
  process.exit(1);
});
