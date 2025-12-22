import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockSplitDocumentIntoSnippets,
  mockGetDocument,
  mockSendWriteOperation,
  mockQuery,
} = vi.hoisted(() => {
  return {
    mockSplitDocumentIntoSnippets: vi.fn(),
    mockGetDocument: vi.fn(),
    mockSendWriteOperation: vi.fn(),
    mockQuery: vi.fn(),
  };
});

// Mock documentSearch
vi.mock("../documentSearch", () => ({
  splitDocumentIntoSnippets: mockSplitDocumentIntoSnippets,
}));

// Mock s3 utilities
vi.mock("../s3", () => ({
  getDocument: mockGetDocument,
}));

// Mock queueClient
vi.mock("../vectordb/queueClient", () => ({
  sendWriteOperation: mockSendWriteOperation,
}));

// Mock readClient
vi.mock("../vectordb/readClient", () => ({
  query: mockQuery,
}));

// Mock config to get MAX_QUERY_LIMIT
vi.mock("../vectordb/config", async () => {
  const actual = await vi.importActual("../vectordb/config");
  return actual;
});

// Import after mocks are set up
import {
  indexDocument,
  deleteDocumentSnippets,
  updateDocument,
  indexDocumentFromS3,
  MAX_DOCUMENT_SNIPPETS,
} from "../documentIndexing";
import { MAX_QUERY_LIMIT } from "../vectordb/config";

describe("documentIndexing", () => {
  const workspaceId = "workspace-123";
  const documentId = "doc-456";
  const documentName = "Test Document";
  const folderPath = "/test/folder";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    // Setup default mocks
    mockSplitDocumentIntoSnippets.mockReturnValue(["snippet 1", "snippet 2"]);
    mockGetDocument.mockResolvedValue(Buffer.from("test content"));
    mockSendWriteOperation.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue([]);
  });

  describe("indexDocument", () => {
    it("should split document into snippets and queue them for indexing", async () => {
      const content = "This is test content that will be split into snippets.";
      const metadata = { documentName, folderPath };

      await indexDocument(workspaceId, documentId, content, metadata);

      // Verify document was split
      expect(mockSplitDocumentIntoSnippets).toHaveBeenCalledWith(content);

      // Verify queue operation was sent with correct structure
      expect(mockSendWriteOperation).toHaveBeenCalledTimes(1);
      const callArgs = mockSendWriteOperation.mock.calls[0][0];
      expect(callArgs).toMatchObject({
        operation: "insert",
        agentId: workspaceId,
        temporalGrain: "docs",
        workspaceId,
        data: {
          rawFacts: expect.arrayContaining([
            expect.objectContaining({
              id: `${documentId}:0`,
              content: "snippet 1",
              metadata: {
                documentId,
                documentName,
                folderPath,
                workspaceId,
              },
            }),
            expect.objectContaining({
              id: `${documentId}:1`,
              content: "snippet 2",
              metadata: {
                documentId,
                documentName,
                folderPath,
                workspaceId,
              },
            }),
          ]),
        },
      });

      // Verify all rawFacts have timestamps
      const rawFacts = callArgs.data.rawFacts;
      expect(rawFacts).toHaveLength(2);
      rawFacts.forEach((fact: { timestamp: string }) => {
        expect(fact.timestamp).toBeDefined();
        expect(typeof fact.timestamp).toBe("string");
        expect(() => new Date(fact.timestamp)).not.toThrow();
      });
    });

    it("should handle empty content gracefully", async () => {
      mockSplitDocumentIntoSnippets.mockReturnValue([]);
      const metadata = { documentName, folderPath };

      await indexDocument(workspaceId, documentId, "", metadata);

      // Should not send to queue if no snippets
      expect(mockSendWriteOperation).not.toHaveBeenCalled();
    });

    it("should generate correct snippet IDs with sequential indices", async () => {
      mockSplitDocumentIntoSnippets.mockReturnValue([
        "snippet 1",
        "snippet 2",
        "snippet 3",
      ]);
      const metadata = { documentName, folderPath };

      await indexDocument(workspaceId, documentId, "content", metadata);

      const callArgs = mockSendWriteOperation.mock.calls[0][0];
      const rawFacts = callArgs.data.rawFacts;
      expect(rawFacts).toHaveLength(3);
      expect(rawFacts[0].id).toBe(`${documentId}:0`);
      expect(rawFacts[1].id).toBe(`${documentId}:1`);
      expect(rawFacts[2].id).toBe(`${documentId}:2`);
    });

    it("should include all required metadata in rawFacts", async () => {
      const metadata = { documentName: "My Doc", folderPath: "/path/to/doc" };
      await indexDocument(workspaceId, documentId, "content", metadata);

      const callArgs = mockSendWriteOperation.mock.calls[0][0];
      const rawFacts = callArgs.data.rawFacts;
      expect(rawFacts[0].metadata).toEqual({
        documentId,
        documentName: "My Doc",
        folderPath: "/path/to/doc",
        workspaceId,
      });
    });

    it("should throw error if queue operation fails", async () => {
      const queueError = new Error("Queue operation failed");
      mockSendWriteOperation.mockRejectedValue(queueError);
      const metadata = { documentName, folderPath };

      await expect(
        indexDocument(workspaceId, documentId, "content", metadata)
      ).rejects.toThrow("Queue operation failed");
    });

    it("should reject documents that exceed MAX_DOCUMENT_SNIPPETS", async () => {
      // Create a document that would generate more than MAX_DOCUMENT_SNIPPETS snippets
      const manySnippets = Array.from(
        { length: MAX_DOCUMENT_SNIPPETS + 1 },
        (_, i) => `snippet ${i}`
      );
      mockSplitDocumentIntoSnippets.mockReturnValue(manySnippets);
      const metadata = { documentName, folderPath };

      await expect(
        indexDocument(workspaceId, documentId, "large content", metadata)
      ).rejects.toThrow("exceeds maximum size limit");

      // Should not send to queue
      expect(mockSendWriteOperation).not.toHaveBeenCalled();
    });

    it("should accept documents at exactly MAX_DOCUMENT_SNIPPETS", async () => {
      const maxSnippets = Array.from(
        { length: MAX_DOCUMENT_SNIPPETS },
        (_, i) => `snippet ${i}`
      );
      mockSplitDocumentIntoSnippets.mockReturnValue(maxSnippets);
      const metadata = { documentName, folderPath };

      await indexDocument(workspaceId, documentId, "content", metadata);

      // Should send to queue
      expect(mockSendWriteOperation).toHaveBeenCalledTimes(1);
      const callArgs = mockSendWriteOperation.mock.calls[0][0];
      expect(callArgs.data.rawFacts).toHaveLength(MAX_DOCUMENT_SNIPPETS);
    });
  });

  describe("deleteDocumentSnippets", () => {
    it("should query LanceDB and delete all snippets for a document", async () => {
      // Mock query results with snippet records (includes snippets from other documents)
      const mockResults = [
        {
          id: `${documentId}:0`,
          content: "snippet 1",
          embedding: [0.1, 0.2],
          timestamp: new Date().toISOString(),
          metadata: { documentId, documentName, folderPath, workspaceId },
        },
        {
          id: "other-doc:0",
          content: "other snippet",
          embedding: [0.2, 0.3],
          timestamp: new Date().toISOString(),
          metadata: {
            documentId: "other-doc",
            documentName,
            folderPath,
            workspaceId,
          },
        },
        {
          id: `${documentId}:1`,
          content: "snippet 2",
          embedding: [0.3, 0.4],
          timestamp: new Date().toISOString(),
          metadata: { documentId, documentName, folderPath, workspaceId },
        },
      ];
      // First query returns results, second query (final check) returns empty
      // The function tries filter first, then falls back if it fails
      mockQuery.mockResolvedValueOnce(mockResults).mockResolvedValueOnce([]);

      await deleteDocumentSnippets(workspaceId, documentId);

      // Verify query was called with filter (no vector - uses filter-based query)
      expect(mockQuery).toHaveBeenCalledWith(workspaceId, "docs", {
        filter: `documentId = '${documentId}'`,
        limit: MAX_QUERY_LIMIT,
      });

      // Verify delete operation was sent with correct record IDs (only matching documentId)
      expect(mockSendWriteOperation).toHaveBeenCalledTimes(1);
      const callArgs = mockSendWriteOperation.mock.calls[0][0];
      expect(callArgs).toMatchObject({
        operation: "delete",
        agentId: workspaceId,
        temporalGrain: "docs",
        workspaceId,
        data: {
          recordIds: [`${documentId}:0`, `${documentId}:1`],
        },
      });
    });

    it("should filter snippets by documentId in memory", async () => {
      // Mock query results with snippets from multiple documents
      const mockResults = [
        {
          id: `${documentId}:0`,
          content: "snippet 1",
          embedding: [0.1],
          timestamp: new Date().toISOString(),
          metadata: { documentId },
        },
        {
          id: "other-doc-1:0",
          content: "other snippet 1",
          embedding: [0.2],
          timestamp: new Date().toISOString(),
          metadata: { documentId: "other-doc-1" },
        },
        {
          id: `${documentId}:1`,
          content: "snippet 2",
          embedding: [0.3],
          timestamp: new Date().toISOString(),
          metadata: { documentId },
        },
        {
          id: "other-doc-2:0",
          content: "other snippet 2",
          embedding: [0.4],
          timestamp: new Date().toISOString(),
          metadata: { documentId: "other-doc-2" },
        },
      ];
      // The function tries filter first, which should work and return only matching results
      // But we test the fallback case where filter doesn't work and we scan all records
      mockQuery
        .mockRejectedValueOnce(new Error("Filter not supported"))
        .mockResolvedValueOnce(mockResults)
        .mockResolvedValueOnce([]);

      await deleteDocumentSnippets(workspaceId, documentId);

      // Should only delete snippets matching the documentId
      const callArgs = mockSendWriteOperation.mock.calls[0][0];
      expect(callArgs.data.recordIds).toEqual([
        `${documentId}:0`,
        `${documentId}:1`,
      ]);
      expect(callArgs.data.recordIds).not.toContain("other-doc-1:0");
      expect(callArgs.data.recordIds).not.toContain("other-doc-2:0");
    });

    it("should handle empty results gracefully", async () => {
      // Filter-based query returns empty results
      mockQuery.mockResolvedValue([]);

      await deleteDocumentSnippets(workspaceId, documentId);

      // Should not send delete operation if no snippets found
      expect(mockSendWriteOperation).not.toHaveBeenCalled();
    });

    it("should not throw error if query fails", async () => {
      const queryError = new Error("Query failed");
      // Both filter query and fallback query fail
      mockQuery
        .mockRejectedValueOnce(queryError) // Filter query fails
        .mockRejectedValueOnce(queryError); // Fallback query also fails

      // Should not throw - errors are logged but function completes
      await expect(
        deleteDocumentSnippets(workspaceId, documentId)
      ).resolves.toBeUndefined();

      // Should not send delete operation if query fails
      expect(mockSendWriteOperation).not.toHaveBeenCalled();
    });

    it("should not throw error if delete operation fails", async () => {
      const mockResults = [
        {
          id: `${documentId}:0`,
          content: "snippet",
          embedding: [0.1],
          timestamp: new Date().toISOString(),
          metadata: { documentId },
        },
      ];
      mockQuery.mockResolvedValue(mockResults);
      const deleteError = new Error("Delete operation failed");
      mockSendWriteOperation.mockRejectedValue(deleteError);

      // Should not throw - errors are logged but function completes
      await expect(
        deleteDocumentSnippets(workspaceId, documentId)
      ).resolves.toBeUndefined();
    });

    it("should extract record IDs correctly from query results", async () => {
      const targetDocId = "doc-1";
      const mockResults = [
        {
          id: "doc-1:0",
          content: "snippet 1",
          embedding: [0.1],
          timestamp: new Date().toISOString(),
          metadata: { documentId: targetDocId },
        },
        {
          id: "doc-1:5",
          content: "snippet 2",
          embedding: [0.2],
          timestamp: new Date().toISOString(),
          metadata: { documentId: targetDocId },
        },
        {
          id: "doc-1:10",
          content: "snippet 3",
          embedding: [0.3],
          timestamp: new Date().toISOString(),
          metadata: { documentId: targetDocId },
        },
      ];
      // First query returns results, second query (final check) returns empty
      mockQuery.mockResolvedValueOnce(mockResults).mockResolvedValueOnce([]);

      await deleteDocumentSnippets(workspaceId, targetDocId);

      const callArgs = mockSendWriteOperation.mock.calls[0][0];
      expect(callArgs.data.recordIds).toEqual([
        "doc-1:0",
        "doc-1:5",
        "doc-1:10",
      ]);
    });

    it("should handle pagination for documents with more snippets than query limit", async () => {
      // Simulate a document with more snippets than MAX_QUERY_LIMIT (1000)
      // With filter-based query, we should get all matching results in first query (up to limit)
      // But if filter doesn't work and we fall back, we need to handle pagination

      // First batch: filter returns MAX_QUERY_LIMIT matching snippets
      const firstBatch = Array.from({ length: MAX_QUERY_LIMIT }, (_, i) => ({
        id: `${documentId}:${i}`,
        content: `snippet ${i}`,
        embedding: [0.1],
        timestamp: new Date().toISOString(),
        metadata: { documentId },
      }));
      // Second batch: filter returns more matching snippets (if filter supports pagination)
      // Or if filter doesn't work, fallback scan returns more
      const secondBatch = Array.from({ length: 500 }, (_, i) => ({
        id: `${documentId}:${MAX_QUERY_LIMIT + i}`,
        content: `snippet ${MAX_QUERY_LIMIT + i}`,
        embedding: [0.1],
        timestamp: new Date().toISOString(),
        metadata: { documentId },
      }));
      // Final check returns empty (no more snippets)
      const finalCheck: typeof firstBatch = [];

      // Mock query: filter works and returns results in batches
      // First query returns MAX_QUERY_LIMIT results, second returns more, final check is empty
      mockQuery
        .mockResolvedValueOnce(firstBatch)
        .mockResolvedValueOnce(secondBatch)
        .mockResolvedValueOnce(finalCheck);

      await deleteDocumentSnippets(workspaceId, documentId);

      // Should have queried multiple times to get all snippets
      // First batch: MAX_QUERY_LIMIT matching snippets -> continues
      // Second batch: 500 more matching snippets -> continues
      // Final check: empty -> stops
      expect(mockQuery).toHaveBeenCalledTimes(3);

      // Should send delete operations for each batch immediately
      // First batch: MAX_QUERY_LIMIT IDs, second batch: 500 IDs
      expect(mockSendWriteOperation).toHaveBeenCalledTimes(2);

      // First delete operation: MAX_QUERY_LIMIT IDs from first batch
      const firstCallArgs = mockSendWriteOperation.mock.calls[0][0];
      expect(firstCallArgs.data.recordIds).toHaveLength(MAX_QUERY_LIMIT);
      expect(firstCallArgs.data.recordIds[0]).toBe(`${documentId}:0`);
      expect(firstCallArgs.data.recordIds[MAX_QUERY_LIMIT - 1]).toBe(
        `${documentId}:${MAX_QUERY_LIMIT - 1}`
      );

      // Second delete operation: 500 IDs from second batch
      const secondCallArgs = mockSendWriteOperation.mock.calls[1][0];
      expect(secondCallArgs.data.recordIds).toHaveLength(500);
      expect(secondCallArgs.data.recordIds[0]).toBe(
        `${documentId}:${MAX_QUERY_LIMIT}`
      );
      expect(secondCallArgs.data.recordIds[499]).toBe(
        `${documentId}:${MAX_QUERY_LIMIT + 499}`
      );
    });

    it("should handle duplicate IDs across query batches", async () => {
      // Simulate a case where the same IDs appear in multiple queries
      // (could happen if deletion hasn't completed yet)
      const batch1 = [
        {
          id: `${documentId}:0`,
          content: "snippet",
          embedding: [0.1],
          timestamp: new Date().toISOString(),
          metadata: { documentId },
        },
        {
          id: `${documentId}:1`,
          content: "snippet",
          embedding: [0.1],
          timestamp: new Date().toISOString(),
          metadata: { documentId },
        },
      ];
      // Second query returns one duplicate and one new ID
      // After filtering by documentId, we get 2 IDs
      // One is duplicate (already in seenIds), one is new
      // newIds.length = 1 (> 0), so it continues
      // Since snippetIds.length (2) < MAX_QUERY_LIMIT, it does final check
      const batch2 = [
        {
          id: `${documentId}:0`, // Duplicate (already in seenIds)
          content: "snippet",
          embedding: [0.1],
          timestamp: new Date().toISOString(),
          metadata: { documentId },
        },
        {
          id: `${documentId}:2`, // New (not in seenIds)
          content: "snippet",
          embedding: [0.1],
          timestamp: new Date().toISOString(),
          metadata: { documentId },
        },
      ];
      // Final check returns empty (no more snippets)
      const finalCheck: typeof batch2 = [];

      mockQuery
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2)
        .mockResolvedValueOnce(finalCheck);

      await deleteDocumentSnippets(workspaceId, documentId);

      // Should delete each batch immediately
      // Batch1: 2 new IDs (0, 1), Batch2: 1 new ID (2, since 0 is duplicate)
      expect(mockSendWriteOperation).toHaveBeenCalledTimes(2);

      // First delete operation: 2 IDs from batch1
      const firstCallArgs = mockSendWriteOperation.mock.calls[0][0];
      expect(firstCallArgs.data.recordIds).toHaveLength(2);
      expect(firstCallArgs.data.recordIds).toEqual([
        `${documentId}:0`,
        `${documentId}:1`,
      ]);

      // Second delete operation: 1 new ID from batch2 (duplicate filtered out)
      const secondCallArgs = mockSendWriteOperation.mock.calls[1][0];
      expect(secondCallArgs.data.recordIds).toHaveLength(1);
      expect(secondCallArgs.data.recordIds).toEqual([`${documentId}:2`]);
    });

    it("should respect max batches limit to prevent infinite loops", async () => {
      // Simulate a scenario where queries keep returning new unique IDs
      // This tests the safety mechanism that prevents infinite loops
      const maxBatches = Math.ceil(MAX_DOCUMENT_SNIPPETS / MAX_QUERY_LIMIT);
      let callCount = 0;

      // Create mock that always returns full batches with unique IDs
      // This simulates a worst-case scenario where queries keep returning new results
      mockQuery.mockImplementation(async () => {
        callCount++;
        // Always return a full batch with unique IDs matching documentId
        return Array.from({ length: MAX_QUERY_LIMIT }, (_, j) => ({
          id: `${documentId}:call${callCount}:${j}`, // Unique IDs per call
          content: "snippet",
          embedding: [0.1],
          timestamp: new Date().toISOString(),
          metadata: { documentId },
        }));
      });

      await deleteDocumentSnippets(workspaceId, documentId);

      // Should have stopped after maxBatches queries (safety limit)
      // The function should not loop infinitely
      expect(mockQuery).toHaveBeenCalled();
      expect(mockQuery.mock.calls.length).toBeLessThanOrEqual(maxBatches + 1); // maxBatches + possible final check

      // Should delete each batch immediately (one delete per batch with new IDs)
      // Since each batch has unique IDs, we should have multiple delete operations
      expect(mockSendWriteOperation.mock.calls.length).toBeGreaterThan(0);
      mockSendWriteOperation.mock.calls.forEach((call) => {
        const callArgs = call[0];
        expect(callArgs.operation).toBe("delete");
        expect(callArgs.data.recordIds.length).toBeGreaterThan(0);
        expect(callArgs.data.recordIds.length).toBeLessThanOrEqual(
          MAX_QUERY_LIMIT
        );
      });
    });

    it("should use filter for queries (no vector similarity)", async () => {
      mockQuery.mockResolvedValue([]);

      await deleteDocumentSnippets(workspaceId, documentId);

      // Verify query was called with a filter (no vector - uses filter-based query)
      expect(mockQuery).toHaveBeenCalledWith(
        workspaceId,
        "docs",
        expect.objectContaining({
          filter: `documentId = '${documentId}'`,
          limit: MAX_QUERY_LIMIT,
        })
      );

      // Verify no vector was used
      const queryOptions = mockQuery.mock.calls[0][2];
      expect(queryOptions).not.toHaveProperty("vector");
    });

    it("should handle results with missing metadata gracefully", async () => {
      // Mock query results with some missing metadata
      const mockResults = [
        {
          id: `${documentId}:0`,
          content: "snippet 1",
          embedding: [0.1],
          timestamp: new Date().toISOString(),
          metadata: { documentId }, // Has documentId
        },
        {
          id: `${documentId}:1`,
          content: "snippet 2",
          embedding: [0.1],
          timestamp: new Date().toISOString(),
          metadata: {}, // Missing documentId - will be filtered out
        },
        {
          id: `${documentId}:2`,
          content: "snippet 3",
          embedding: [0.1],
          timestamp: new Date().toISOString(),
          metadata: null, // Null metadata - will be filtered out
        },
        {
          id: "other-doc:0",
          content: "other snippet",
          embedding: [0.1],
          timestamp: new Date().toISOString(),
          metadata: { documentId: "other-doc" }, // Different documentId
        },
      ];
      // First query returns results, second query (final check) returns empty
      mockQuery.mockResolvedValueOnce(mockResults).mockResolvedValueOnce([]);

      await deleteDocumentSnippets(workspaceId, documentId);

      // Should only delete snippets with matching documentId in metadata
      expect(mockSendWriteOperation).toHaveBeenCalledTimes(1);
      const callArgs = mockSendWriteOperation.mock.calls[0][0];
      expect(callArgs.data.recordIds).toEqual([`${documentId}:0`]);
      expect(callArgs.data.recordIds).not.toContain(`${documentId}:1`);
      expect(callArgs.data.recordIds).not.toContain(`${documentId}:2`);
      expect(callArgs.data.recordIds).not.toContain("other-doc:0");
    });

    it("should break early when no new IDs are found", async () => {
      // First query returns some results
      const batch1 = [
        {
          id: `${documentId}:0`,
          content: "snippet",
          embedding: [0.1],
          timestamp: new Date().toISOString(),
          metadata: { documentId },
        },
      ];
      // Second query returns same IDs (no new IDs)
      const batch2 = [
        {
          id: `${documentId}:0`, // Same ID - no new IDs
          content: "snippet",
          embedding: [0.1],
          timestamp: new Date().toISOString(),
          metadata: { documentId },
        },
      ];

      mockQuery.mockResolvedValueOnce(batch1).mockResolvedValueOnce(batch2);

      await deleteDocumentSnippets(workspaceId, documentId);

      // Should stop after second query (no new IDs found)
      expect(mockQuery).toHaveBeenCalledTimes(2);
      // Should still send delete operation with IDs from first batch
      expect(mockSendWriteOperation).toHaveBeenCalledTimes(1);
      const callArgs = mockSendWriteOperation.mock.calls[0][0];
      expect(callArgs.data.recordIds).toEqual([`${documentId}:0`]);
    });
  });

  describe("updateDocument", () => {
    it("should delete old snippets and then index new content", async () => {
      const newContent = "Updated document content";
      const metadata = { documentName, folderPath };

      // Mock query to return some existing snippets
      const mockResults = [
        {
          id: `${documentId}:0`,
          content: "old snippet",
          embedding: [0.1],
          timestamp: new Date().toISOString(),
          metadata: { documentId },
        },
      ];
      mockQuery.mockResolvedValue(mockResults);

      await updateDocument(workspaceId, documentId, newContent, metadata);

      // Verify delete was called first (query uses filter, no vector)
      expect(mockQuery).toHaveBeenCalledWith(workspaceId, "docs", {
        filter: `documentId = '${documentId}'`,
        limit: MAX_QUERY_LIMIT,
      });

      // Verify delete operation was sent
      expect(mockSendWriteOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "delete",
          agentId: workspaceId,
          temporalGrain: "docs",
        })
      );

      // Verify index was called after delete
      expect(mockSplitDocumentIntoSnippets).toHaveBeenCalledWith(newContent);

      // Verify insert operation was sent
      expect(mockSendWriteOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "insert",
          agentId: workspaceId,
          temporalGrain: "docs",
        })
      );

      // Verify both operations were called
      expect(mockSendWriteOperation).toHaveBeenCalledTimes(2);
    });

    it("should handle empty content by deleting old snippets", async () => {
      mockSplitDocumentIntoSnippets.mockReturnValue([]);
      const metadata = { documentName, folderPath };
      const mockResults = [
        {
          id: `${documentId}:0`,
          content: "old snippet",
          embedding: [0.1],
          timestamp: new Date().toISOString(),
          metadata: { documentId },
        },
      ];
      // First query returns results, second query (final check) returns empty
      mockQuery.mockResolvedValueOnce(mockResults).mockResolvedValueOnce([]);

      await updateDocument(workspaceId, documentId, "", metadata);

      // Should still delete old snippets
      expect(mockQuery).toHaveBeenCalled();
      expect(mockSendWriteOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "delete",
        })
      );

      // But no insert since content is empty
      expect(mockSendWriteOperation).toHaveBeenCalledTimes(1);
    });

    it("should propagate errors from deleteDocumentSnippets", async () => {
      // Setup: deleteDocumentSnippets fails during query (both filter and fallback fail)
      const deleteError = new Error("Delete failed");
      // Filter query fails, then fallback query also fails
      mockQuery
        .mockRejectedValueOnce(deleteError) // Filter query fails
        .mockRejectedValueOnce(deleteError); // Fallback query also fails

      await expect(
        updateDocument(workspaceId, documentId, "content", {
          documentName,
          folderPath,
        })
      ).rejects.toThrow("Delete failed");

      // Verify indexDocument was not called
      expect(mockSplitDocumentIntoSnippets).not.toHaveBeenCalled();
    });

    it("should propagate errors from indexDocument", async () => {
      // Setup: deleteDocumentSnippets finds no snippets, so no delete operation
      mockQuery.mockResolvedValue([]);
      const indexError = new Error("Index failed");
      mockSendWriteOperation.mockRejectedValueOnce(indexError); // Insert fails

      await expect(
        updateDocument(workspaceId, documentId, "content", {
          documentName,
          folderPath,
        })
      ).rejects.toThrow("Index failed");
    });
  });

  describe("indexDocumentFromS3", () => {
    it("should fetch document from S3 and index it", async () => {
      const s3Key = "workspace-123/test-doc.txt";
      const s3Content = "Document content from S3";
      const metadata = { documentName, folderPath };

      mockGetDocument.mockResolvedValue(Buffer.from(s3Content, "utf-8"));
      mockSplitDocumentIntoSnippets.mockReturnValue(["snippet 1"]);

      await indexDocumentFromS3(workspaceId, documentId, s3Key, metadata);

      // Verify S3 fetch was called
      expect(mockGetDocument).toHaveBeenCalledWith(
        workspaceId,
        documentId,
        s3Key
      );

      // Verify indexing was called with fetched content
      expect(mockSplitDocumentIntoSnippets).toHaveBeenCalledWith(s3Content);

      // Verify queue operation was sent
      expect(mockSendWriteOperation).toHaveBeenCalledTimes(1);
      expect(mockSendWriteOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "insert",
          agentId: workspaceId,
          temporalGrain: "docs",
        })
      );
    });

    it("should handle S3 fetch errors gracefully", async () => {
      const s3Error = new Error("S3 fetch failed");
      mockGetDocument.mockRejectedValue(s3Error);
      const metadata = { documentName, folderPath };

      // Should not throw - errors are logged but function completes
      await expect(
        indexDocumentFromS3(workspaceId, documentId, "s3-key", metadata)
      ).resolves.toBeUndefined();

      // Should not attempt to index if S3 fetch fails
      expect(mockSplitDocumentIntoSnippets).not.toHaveBeenCalled();
      expect(mockSendWriteOperation).not.toHaveBeenCalled();
    });

    it("should handle indexing errors gracefully", async () => {
      const s3Content = "Document content";
      mockGetDocument.mockResolvedValue(Buffer.from(s3Content, "utf-8"));
      const indexError = new Error("Indexing failed");
      mockSendWriteOperation.mockRejectedValue(indexError);
      const metadata = { documentName, folderPath };

      // Should not throw - errors are logged but function completes
      await expect(
        indexDocumentFromS3(workspaceId, documentId, "s3-key", metadata)
      ).resolves.toBeUndefined();
    });

    it("should convert Buffer content to UTF-8 string correctly", async () => {
      const s3Content = "Test content with special chars: àáâãäå";
      const buffer = Buffer.from(s3Content, "utf-8");
      mockGetDocument.mockResolvedValue(buffer);
      mockSplitDocumentIntoSnippets.mockReturnValue(["snippet"]);
      const metadata = { documentName, folderPath };

      await indexDocumentFromS3(workspaceId, documentId, "s3-key", metadata);

      // Verify content was converted correctly
      expect(mockSplitDocumentIntoSnippets).toHaveBeenCalledWith(s3Content);
    });

    it("should handle empty document content", async () => {
      mockGetDocument.mockResolvedValue(Buffer.from("", "utf-8"));
      mockSplitDocumentIntoSnippets.mockReturnValue([]);
      const metadata = { documentName, folderPath };

      await indexDocumentFromS3(workspaceId, documentId, "s3-key", metadata);

      // Should not send to queue if no snippets
      expect(mockSendWriteOperation).not.toHaveBeenCalled();
    });
  });

  describe("edge cases and error handling", () => {
    it("should handle very large documents with many snippets", async () => {
      // Create a large number of snippets
      const manySnippets = Array.from(
        { length: 100 },
        (_, i) => `snippet ${i}`
      );
      mockSplitDocumentIntoSnippets.mockReturnValue(manySnippets);
      const metadata = { documentName, folderPath };

      await indexDocument(workspaceId, documentId, "content", metadata);

      const callArgs = mockSendWriteOperation.mock.calls[0][0];
      expect(callArgs.data.rawFacts).toHaveLength(100);
      // Verify IDs are sequential
      expect(callArgs.data.rawFacts[0].id).toBe(`${documentId}:0`);
      expect(callArgs.data.rawFacts[99].id).toBe(`${documentId}:99`);
    });

    it("should handle documentId with special characters", async () => {
      const specialDocumentId = "doc-123:test@example.com";
      const mockResults = [
        {
          id: `${specialDocumentId}:0`,
          content: "snippet",
          embedding: [0.1],
          timestamp: new Date().toISOString(),
          metadata: { documentId: specialDocumentId },
        },
      ];
      mockQuery.mockResolvedValueOnce(mockResults).mockResolvedValueOnce([]);

      await deleteDocumentSnippets(workspaceId, specialDocumentId);

      // Should query with filter (special characters are escaped in the filter)
      expect(mockQuery).toHaveBeenCalledWith(workspaceId, "docs", {
        filter: `documentId = '${specialDocumentId.replace(/'/g, "''")}'`,
        limit: MAX_QUERY_LIMIT,
      });

      // Should correctly filter by documentId in memory
      expect(mockSendWriteOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            recordIds: [`${specialDocumentId}:0`],
          },
        })
      );
    });

    it("should handle workspaceId with special characters in filter", async () => {
      const specialWorkspaceId = "workspace'123";
      mockQuery.mockResolvedValue([]);

      await deleteDocumentSnippets(specialWorkspaceId, documentId);

      // WorkspaceId is used as agentId, not in filter for deleteDocumentSnippets
      // But it should still work
      expect(mockQuery).toHaveBeenCalled();
    });

    it("should preserve metadata correctly across all snippets", async () => {
      const metadata = {
        documentName: "Complex Document Name",
        folderPath: "/nested/path/to/document",
      };
      mockSplitDocumentIntoSnippets.mockReturnValue([
        "snippet 1",
        "snippet 2",
        "snippet 3",
      ]);

      await indexDocument(workspaceId, documentId, "content", metadata);

      const callArgs = mockSendWriteOperation.mock.calls[0][0];
      const rawFacts = callArgs.data.rawFacts;
      rawFacts.forEach((fact: { metadata: Record<string, unknown> }) => {
        expect(fact.metadata).toEqual({
          documentId,
          documentName: "Complex Document Name",
          folderPath: "/nested/path/to/document",
          workspaceId,
        });
      });
    });
  });
});
