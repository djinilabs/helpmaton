import { execSync } from "child_process";
import { spawn, type ChildProcess } from "child_process";
import { join } from "path";

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";

import {
  deleteDocumentSnippets,
  indexDocument,
  updateDocument,
} from "../documentIndexing";
import { searchDocuments } from "../documentSearch";
import { query } from "../vectordb/readClient";

// Track sandbox process
let sandboxProcess: ChildProcess | null = null;
let sandboxPid: number | undefined = undefined;

// Track test documents for cleanup
const testDocuments: Array<{ workspaceId: string; documentId: string }> = [];

/**
 * Escape a string value for use in LanceDB SQL filter expressions
 * Escapes single quotes by doubling them (SQL standard)
 */
function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Wait for document snippets to be indexed in the vector database
 * Polls the database until snippets are found or timeout is reached
 */
async function waitForDocumentIndexing(
  workspaceId: string,
  documentId: string,
  timeout = 60000
): Promise<void> {
  const startTime = Date.now();
  const initialDelay = 3000; // 3 seconds initial delay for SQS + S3 writes
  const pollInterval = 1000; // Start with 1s
  const maxInterval = 3000; // Max 3s intervals
  let currentInterval = pollInterval;

  // Wait a bit initially for SQS to process and S3 to write
  await new Promise((resolve) => setTimeout(resolve, initialDelay));

  const escapedDocumentId = escapeSqlString(documentId);
  const filter = `"documentId" = '${escapedDocumentId}'`;

  while (Date.now() - startTime < timeout) {
    const elapsed = Date.now() - startTime;
    try {
      // Query with filter directly - simpler and faster
      const results = await query(workspaceId, "docs", {
        filter,
        limit: 1,
      });

      if (results.length > 0) {
        // Snippets found, indexing is complete
        console.log(
          `[waitForDocumentIndexing] Document ${documentId} indexed after ${elapsed}ms`
        );
        return;
      }

      // Wait before next poll with exponential backoff
      await new Promise((resolve) => setTimeout(resolve, currentInterval));
      currentInterval = Math.min(currentInterval * 1.5, maxInterval);
    } catch (error) {
      // If query fails (e.g., table doesn't exist yet), continue polling
      const errorMsg = error instanceof Error ? error.message : String(error);
      // Only log every 5 seconds to avoid spam
      if (elapsed % 5000 < currentInterval) {
        console.warn(
          `[waitForDocumentIndexing] Query failed (${elapsed}ms elapsed):`,
          errorMsg.substring(0, 100)
        );
      }
      await new Promise((resolve) => setTimeout(resolve, currentInterval));
      currentInterval = Math.min(currentInterval * 1.5, maxInterval);
    }
  }

  throw new Error(
    `Timeout waiting for document ${documentId} to be indexed (${timeout}ms)`
  );
}

/**
 * Wait for document snippets to be deleted from the vector database
 * Polls the database until no snippets are found or timeout is reached
 */
async function waitForDocumentDeletion(
  workspaceId: string,
  documentId: string,
  timeout = 30000
): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 500;
  const maxInterval = 2000;
  let currentInterval = pollInterval;

  const escapedDocumentId = escapeSqlString(documentId);
  const filter = `"documentId" = '${escapedDocumentId}'`;

  while (Date.now() - startTime < timeout) {
    try {
      const results = await query(workspaceId, "docs", {
        filter,
        limit: 1,
      });

      if (results.length === 0) {
        // No snippets found, deletion is complete
        return;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, currentInterval));
      currentInterval = Math.min(currentInterval * 1.5, maxInterval);
    } catch (error) {
      // If query fails (e.g., table doesn't exist), assume deletion is complete
      console.warn(
        `[waitForDocumentDeletion] Query failed, assuming deletion complete:`,
        error instanceof Error ? error.message : String(error)
      );
      return;
    }
  }

  throw new Error(
    `Timeout waiting for document ${documentId} to be deleted (${timeout}ms)`
  );
}

/**
 * Clean up test documents from vector database
 */
async function cleanupTestDocuments(
  workspaceId: string,
  documentIds: string[]
): Promise<void> {
  for (const documentId of documentIds) {
    try {
      await deleteDocumentSnippets(workspaceId, documentId);
      // Wait a bit for deletion to complete
      await waitForDocumentDeletion(workspaceId, documentId, 10000);
    } catch (error) {
      console.warn(
        `[cleanupTestDocuments] Failed to delete document ${documentId}:`,
        error instanceof Error ? error.message : String(error)
      );
      // Continue with other documents even if one fails
    }
  }
}

describe("Document Search Integration Tests", () => {
  beforeAll(async () => {
    // Start backend sandbox
    console.log("Starting backend sandbox for integration tests...");

    // Check if port 3333 is already in use and kill any existing sandbox
    try {
      const existingPid = execSync("lsof -ti:3333", {
        encoding: "utf-8",
      }).trim();
      if (existingPid) {
        console.log(
          `Found existing process on port 3333 (PID: ${existingPid}), killing it...`
        );
        try {
          process.kill(Number.parseInt(existingPid, 10), "SIGTERM");
          // Wait a moment for process to exit
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch {
          // Process may already be dead, continue
        }
      }
    } catch {
      // Port is free, continue
    }

    // Resolve backend directory - if we're in apps/backend, go up one level first
    const currentDir = process.cwd();
    const backendDir = currentDir.endsWith("apps/backend")
      ? currentDir
      : join(currentDir, "apps", "backend");

    // Prepare environment variables
    const backendEnv = {
      ...process.env,
      NODE_ENV: "test",
      ARC_ENV: "testing",
      ARC_DB_PATH: "./db",
      // Ensure required env vars are set
      GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
      HELPMATON_S3_BUCKET: process.env.HELPMATON_S3_BUCKET || "",
      HELPMATON_S3_ENDPOINT:
        process.env.HELPMATON_S3_ENDPOINT || "http://localhost:4568",
      HELPMATON_S3_ACCESS_KEY_ID:
        process.env.HELPMATON_S3_ACCESS_KEY_ID || "S3RVER",
      HELPMATON_S3_SECRET_ACCESS_KEY:
        process.env.HELPMATON_S3_SECRET_ACCESS_KEY || "S3RVER",
    };

    // Start sandbox process
    // Use shell option with proper shell path for macOS/Linux
    const shellPath = process.env.SHELL || "/bin/sh";
    sandboxProcess = spawn("pnpm", ["arc", "sandbox"], {
      cwd: backendDir,
      stdio: "pipe",
      detached: false,
      env: backendEnv,
      shell: shellPath, // Use system shell to resolve pnpm from PATH
    });

    // Wait for sandbox to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Sandbox startup timeout (90 seconds)"));
      }, 90000); // 90 second timeout

      if (!sandboxProcess) {
        clearTimeout(timeout);
        reject(new Error("Failed to spawn sandbox process"));
        return;
      }

      let sandboxStarted = false;
      let compilationComplete = false;
      let sawCompiling = false;

      if (sandboxProcess.stdout) {
        sandboxProcess.stdout.on("data", (data: Buffer) => {
          const output = data.toString();
          console.log(`[Sandbox] ${output.trim()}`);

          // Check if sandbox has started
          if (
            output.includes("Sandbox Started") ||
            output.includes("Local environment ready") ||
            output.includes("Server ready")
          ) {
            sandboxStarted = true;
          }

          // Check if TypeScript compilation started
          if (output.includes("Compiling TypeScript")) {
            sawCompiling = true;
          }

          // Check if compilation is complete
          if (
            output.includes("Compiled project") ||
            output.includes("Sandbox Ran Sandbox startup plugins") ||
            output.includes("File watcher now looking")
          ) {
            compilationComplete = true;
          }

          // Sandbox is ready when started AND (no compilation OR compilation complete)
          if (sandboxStarted && (!sawCompiling || compilationComplete)) {
            clearTimeout(timeout);
            resolve();
          }
        });
      }

      if (sandboxProcess.stderr) {
        sandboxProcess.stderr.on("data", (data: Buffer) => {
          const output = data.toString();
          console.log(`[Sandbox stderr] ${output.trim()}`);
        });
      }

      sandboxProcess.on("error", (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });

      sandboxProcess.on("exit", (code: number) => {
        if (code !== 0 && code !== null) {
          clearTimeout(timeout);
          reject(new Error(`Sandbox process exited with code ${code}`));
        }
      });
    });

    // Store PID for cleanup
    if (sandboxProcess.pid) {
      sandboxPid = sandboxProcess.pid;
      console.log(`✅ Sandbox started with PID: ${sandboxPid}`);
    } else {
      throw new Error("Sandbox process has no PID");
    }

    // Give sandbox a moment to fully initialize
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }, 100000); // 100 second timeout for beforeAll

  afterAll(async () => {
    // Clean up all test documents
    console.log("Cleaning up test documents...");
    for (const { workspaceId, documentId } of testDocuments) {
      try {
        await cleanupTestDocuments(workspaceId, [documentId]);
      } catch (error) {
        console.warn(
          `Failed to cleanup document ${documentId}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    testDocuments.length = 0;

    // Stop sandbox process
    if (sandboxPid) {
      console.log(`Stopping sandbox process (PID: ${sandboxPid})...`);
      try {
        process.kill(sandboxPid, "SIGTERM");
        // Wait for process to exit
        await new Promise<void>((resolve) => {
          if (sandboxProcess) {
            sandboxProcess.on("exit", () => {
              resolve();
            });
            // Force kill after 5 seconds if it doesn't exit gracefully
            setTimeout(() => {
              if (sandboxPid) {
                try {
                  process.kill(sandboxPid, "SIGKILL");
                } catch {
                  // Process may already be dead
                }
              }
              resolve();
            }, 5000);
          } else {
            resolve();
          }
        });
        console.log("✅ Sandbox stopped");
      } catch (error) {
        console.warn(
          `Failed to stop sandbox:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }, 30000); // 30 second timeout for afterAll

  beforeEach(() => {
    // Generate unique test workspace and document IDs for each test
    // This is handled per-test, but we can set up common test data here if needed
  });

  afterEach(async () => {
    // Clean up test documents created in this test
    // This is handled by tracking testDocuments and cleaning in afterAll
    // Individual tests should clean up their own documents immediately after use
  });

  it("should index a document and find it via search", async () => {
    const workspaceId = `test-workspace-${Date.now()}`;
    const documentId = `test-doc-basic-${Date.now()}`;
    const uniqueKeyword = `unique-keyword-${Date.now()}`;
    const documentContent = `This is a test document about ${uniqueKeyword} for integration testing. It contains specific content that should be searchable.`;

    testDocuments.push({ workspaceId, documentId });

    // Index the document
    await indexDocument(workspaceId, documentId, documentContent, {
      documentName: "Test Document",
      folderPath: "",
    });

     // Wait for indexing to complete
     await waitForDocumentIndexing(workspaceId, documentId, 60000);

    // Search for the document
    const results = await searchDocuments(workspaceId, uniqueKeyword, 5);

    // Verify results
    expect(results.length).toBeGreaterThan(0);
    const foundDocument = results.find((r) => r.documentId === documentId);
    expect(foundDocument).toBeDefined();
    expect(foundDocument?.documentName).toBe("Test Document");
    expect(foundDocument?.snippet).toContain(uniqueKeyword);

    // Clean up
    await cleanupTestDocuments(workspaceId, [documentId]);
  }, 60000); // 60 second timeout

  it("should index multiple documents and find them all via search", async () => {
    const workspaceId = `test-workspace-${Date.now()}`;
    const documentIds: string[] = [];
    const uniqueKeywords: string[] = [];

    // Create multiple documents
    for (let i = 0; i < 3; i++) {
      const documentId = `test-doc-multiple-${i}-${Date.now()}`;
      const uniqueKeyword = `unique-multi-${i}-${Date.now()}`;
      const documentContent = `Document ${i} about ${uniqueKeyword} for testing multiple documents.`;

      documentIds.push(documentId);
      uniqueKeywords.push(uniqueKeyword);
      testDocuments.push({ workspaceId, documentId });

      await indexDocument(workspaceId, documentId, documentContent, {
        documentName: `Test Document ${i}`,
        folderPath: "",
      });
    }

    // Wait for all documents to be indexed
    for (const documentId of documentIds) {
       await waitForDocumentIndexing(workspaceId, documentId, 90000);
    }

    // Search for each document
    for (let i = 0; i < documentIds.length; i++) {
      const results = await searchDocuments(workspaceId, uniqueKeywords[i], 5);
      expect(results.length).toBeGreaterThan(0);
      const foundDocument = results.find(
        (r) => r.documentId === documentIds[i]
      );
      expect(foundDocument).toBeDefined();
      expect(foundDocument?.snippet).toContain(uniqueKeywords[i]);
    }

    // Verify workspace isolation - create another workspace and verify its documents aren't returned
    const otherWorkspaceId = `test-workspace-other-${Date.now()}`;
    const otherDocumentId = `test-doc-other-${Date.now()}`;
    const otherKeyword = `unique-other-${Date.now()}`;

    await indexDocument(
      otherWorkspaceId,
      otherDocumentId,
      `Document in other workspace about ${otherKeyword}`,
      {
        documentName: "Other Workspace Document",
        folderPath: "",
      }
    );

    await waitForDocumentIndexing(otherWorkspaceId, otherDocumentId, 60000);

    // Search in original workspace should not return documents from other workspace
    const results = await searchDocuments(workspaceId, otherKeyword, 10);
    const foundOtherDocument = results.find(
      (r) => r.documentId === otherDocumentId
    );
    expect(foundOtherDocument).toBeUndefined();

    // Clean up
    await cleanupTestDocuments(workspaceId, documentIds);
    await cleanupTestDocuments(otherWorkspaceId, [otherDocumentId]);
  }, 120000); // 120 second timeout for multiple documents

  it("should update a document and replace old content with new content", async () => {
    const workspaceId = `test-workspace-${Date.now()}`;
    const documentId = `test-doc-update-${Date.now()}`;
    const oldKeyword = `old-keyword-${Date.now()}`;
    const newKeyword = `new-keyword-${Date.now()}`;

    const initialContent = `This is the initial document content about ${oldKeyword}.`;
    const updatedContent = `This is the updated document content about ${newKeyword}.`;

    testDocuments.push({ workspaceId, documentId });

    // Index initial document
    await indexDocument(workspaceId, documentId, initialContent, {
      documentName: "Test Document",
      folderPath: "",
    });

    // Wait for indexing
       await waitForDocumentIndexing(workspaceId, documentId, 90000);

    // Verify initial content is searchable
    let results = await searchDocuments(workspaceId, oldKeyword, 5);
    expect(results.length).toBeGreaterThan(0);
    const foundOld = results.find((r) => r.documentId === documentId);
    expect(foundOld).toBeDefined();
    expect(foundOld?.snippet).toContain(oldKeyword);

    // Update document
    await updateDocument(workspaceId, documentId, updatedContent, {
      documentName: "Test Document",
      folderPath: "",
    });

    // Wait for old snippets to be deleted and new ones indexed
    // First wait for deletion (old snippets should be gone)
    await waitForDocumentDeletion(workspaceId, documentId, 30000);
    // Then wait for new indexing
       await waitForDocumentIndexing(workspaceId, documentId, 90000);

    // Verify old content is NOT found
    results = await searchDocuments(workspaceId, oldKeyword, 5);
    const foundOldAfterUpdate = results.find(
      (r) => r.documentId === documentId
    );
    expect(foundOldAfterUpdate).toBeUndefined();

    // Verify new content IS found
    results = await searchDocuments(workspaceId, newKeyword, 5);
    expect(results.length).toBeGreaterThan(0);
    const foundNew = results.find((r) => r.documentId === documentId);
    expect(foundNew).toBeDefined();
    expect(foundNew?.snippet).toContain(newKeyword);
    expect(foundNew?.snippet).not.toContain(oldKeyword);

    // Clean up
    await cleanupTestDocuments(workspaceId, [documentId]);
  }, 120000); // 120 second timeout for update test

  it("should delete a document and remove it from search results", async () => {
    const workspaceId = `test-workspace-${Date.now()}`;
    const documentId = `test-doc-delete-${Date.now()}`;
    const uniqueKeyword = `unique-delete-${Date.now()}`;
    const documentContent = `This document about ${uniqueKeyword} will be deleted.`;

    testDocuments.push({ workspaceId, documentId });

    // Index document
    await indexDocument(workspaceId, documentId, documentContent, {
      documentName: "Test Document",
      folderPath: "",
    });

    // Wait for indexing
       await waitForDocumentIndexing(workspaceId, documentId, 90000);

    // Verify document is searchable
    let results = await searchDocuments(workspaceId, uniqueKeyword, 5);
    expect(results.length).toBeGreaterThan(0);
    const foundDocument = results.find((r) => r.documentId === documentId);
    expect(foundDocument).toBeDefined();

    // Delete document
    await deleteDocumentSnippets(workspaceId, documentId);

    // Wait for deletion to complete
    await waitForDocumentDeletion(workspaceId, documentId, 30000);

    // Verify document is NOT found in search
    results = await searchDocuments(workspaceId, uniqueKeyword, 5);
    const foundAfterDelete = results.find((r) => r.documentId === documentId);
    expect(foundAfterDelete).toBeUndefined();

    // Verify document is completely removed from vector database
    const queryResults = await query(workspaceId, "docs", {
      filter: `"documentId" = '${escapeSqlString(documentId)}'`,
      limit: 10,
    });
    expect(queryResults.length).toBe(0);
  }, 90000); // 90 second timeout for deletion test

  it("should handle updating a document with empty content", async () => {
    const workspaceId = `test-workspace-${Date.now()}`;
    const documentId = `test-doc-empty-${Date.now()}`;
    const uniqueKeyword = `unique-empty-${Date.now()}`;
    const initialContent = `This document about ${uniqueKeyword} will be emptied.`;

    testDocuments.push({ workspaceId, documentId });

    // Index document
    await indexDocument(workspaceId, documentId, initialContent, {
      documentName: "Test Document",
      folderPath: "",
    });

    // Wait for indexing
       await waitForDocumentIndexing(workspaceId, documentId, 90000);

    // Verify document is searchable
    let results = await searchDocuments(workspaceId, uniqueKeyword, 5);
    expect(results.length).toBeGreaterThan(0);
    const foundDocument = results.find((r) => r.documentId === documentId);
    expect(foundDocument).toBeDefined();

    // Update with empty content
    await updateDocument(workspaceId, documentId, "", {
      documentName: "Test Document",
      folderPath: "",
    });

    // Wait for old snippets to be deleted
    await waitForDocumentDeletion(workspaceId, documentId, 30000);

    // Verify old snippets are deleted
    const queryResults = await query(workspaceId, "docs", {
      filter: `"documentId" = '${escapeSqlString(documentId)}'`,
      limit: 10,
    });
    expect(queryResults.length).toBe(0);

    // Verify document is not searchable
    results = await searchDocuments(workspaceId, uniqueKeyword, 5);
    const foundAfterEmpty = results.find((r) => r.documentId === documentId);
    expect(foundAfterEmpty).toBeUndefined();
  }, 90000); // 90 second timeout for empty update test
});
