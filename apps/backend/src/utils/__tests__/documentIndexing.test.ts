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
      // Mock query results with snippet records
      const mockResults = [
        {
          id: `${documentId}:0`,
          content: "snippet 1",
          embedding: [0.1, 0.2],
          timestamp: new Date().toISOString(),
          metadata: { documentId, documentName, folderPath, workspaceId },
        },
        {
          id: `${documentId}:1`,
          content: "snippet 2",
          embedding: [0.2, 0.3],
          timestamp: new Date().toISOString(),
          metadata: { documentId, documentName, folderPath, workspaceId },
        },
      ];
      // First query returns results, second query (final check) returns empty
      mockQuery.mockResolvedValueOnce(mockResults).mockResolvedValueOnce([]);

      await deleteDocumentSnippets(workspaceId, documentId);

      // Verify query was called with correct filter (with escaped documentId) and MAX_QUERY_LIMIT
      expect(mockQuery).toHaveBeenCalledWith(workspaceId, "docs", {
        filter: `documentId = '${documentId}'`,
        limit: MAX_QUERY_LIMIT,
      });

      // Verify delete operation was sent with correct record IDs
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

    it("should escape single quotes in documentId to prevent SQL injection", async () => {
      const maliciousDocumentId = "doc' OR '1'='1";
      mockQuery.mockResolvedValue([]);

      await deleteDocumentSnippets(workspaceId, maliciousDocumentId);

      // Verify escaped documentId in filter
      expect(mockQuery).toHaveBeenCalledWith(workspaceId, "docs", {
        filter: "documentId = 'doc'' OR ''1''=''1'", // Single quotes doubled
        limit: MAX_QUERY_LIMIT,
      });
    });

    it("should handle empty results gracefully", async () => {
      mockQuery.mockResolvedValue([]);

      await deleteDocumentSnippets(workspaceId, documentId);

      // Should not send delete operation if no snippets found
      expect(mockSendWriteOperation).not.toHaveBeenCalled();
    });

    it("should not throw error if query fails", async () => {
      const queryError = new Error("Query failed");
      mockQuery.mockRejectedValue(queryError);

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
      const mockResults = [
        {
          id: "doc-1:0",
          content: "snippet 1",
          embedding: [0.1],
          timestamp: new Date().toISOString(),
          metadata: {},
        },
        {
          id: "doc-1:5",
          content: "snippet 2",
          embedding: [0.2],
          timestamp: new Date().toISOString(),
          metadata: {},
        },
        {
          id: "doc-1:10",
          content: "snippet 3",
          embedding: [0.3],
          timestamp: new Date().toISOString(),
          metadata: {},
        },
      ];
      // First query returns results, second query (final check) returns empty
      mockQuery.mockResolvedValueOnce(mockResults).mockResolvedValueOnce([]);

      await deleteDocumentSnippets(workspaceId, "doc-1");

      const callArgs = mockSendWriteOperation.mock.calls[0][0];
      expect(callArgs.data.recordIds).toEqual([
        "doc-1:0",
        "doc-1:5",
        "doc-1:10",
      ]);
    });

    it("should handle pagination for documents with more snippets than query limit", async () => {
      // Simulate a document with more snippets than MAX_QUERY_LIMIT (1000)
      // First batch: 1000 snippets
      const firstBatch = Array.from({ length: 1000 }, (_, i) => ({
        id: `${documentId}:${i}`,
        content: `snippet ${i}`,
        embedding: [0.1],
        timestamp: new Date().toISOString(),
        metadata: { documentId },
      }));
      // Second batch: 500 more snippets
      const secondBatch = Array.from({ length: 500 }, (_, i) => ({
        id: `${documentId}:${1000 + i}`,
        content: `snippet ${1000 + i}`,
        embedding: [0.1],
        timestamp: new Date().toISOString(),
        metadata: { documentId },
      }));

      // Mock query to return first batch, then second batch, then empty
      mockQuery
        .mockResolvedValueOnce(firstBatch)
        .mockResolvedValueOnce(secondBatch)
        .mockResolvedValueOnce([]);

      await deleteDocumentSnippets(workspaceId, documentId);

      // Should have queried multiple times
      expect(mockQuery).toHaveBeenCalledTimes(3); // 2 batches + 1 final check

      // Should send single delete operation with all IDs
      expect(mockSendWriteOperation).toHaveBeenCalledTimes(1);
      const callArgs = mockSendWriteOperation.mock.calls[0][0];
      expect(callArgs.data.recordIds).toHaveLength(1500);
      expect(callArgs.data.recordIds[0]).toBe(`${documentId}:0`);
      expect(callArgs.data.recordIds[999]).toBe(`${documentId}:999`);
      expect(callArgs.data.recordIds[1000]).toBe(`${documentId}:1000`);
      expect(callArgs.data.recordIds[1499]).toBe(`${documentId}:1499`);
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
      // Second query returns same IDs (deletion not complete yet)
      const batch2 = [
        {
          id: `${documentId}:0`, // Duplicate
          content: "snippet",
          embedding: [0.1],
          timestamp: new Date().toISOString(),
          metadata: { documentId },
        },
        {
          id: `${documentId}:2`, // New
          content: "snippet",
          embedding: [0.1],
          timestamp: new Date().toISOString(),
          metadata: { documentId },
        },
      ];

      mockQuery
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2)
        .mockResolvedValueOnce([]);

      await deleteDocumentSnippets(workspaceId, documentId);

      // Should only delete unique IDs
      const callArgs = mockSendWriteOperation.mock.calls[0][0];
      expect(callArgs.data.recordIds).toHaveLength(3); // 0, 1, 2 (no duplicates)
      expect(callArgs.data.recordIds).toEqual([
        `${documentId}:0`,
        `${documentId}:1`,
        `${documentId}:2`,
      ]);
    });

    it("should respect max batches limit to prevent infinite loops", async () => {
      // Simulate a scenario where queries keep returning results
      // This tests the safety mechanism that prevents infinite loops
      const maxBatches = Math.ceil(MAX_DOCUMENT_SNIPPETS / MAX_QUERY_LIMIT);
      let callCount = 0;

      // Create mock that always returns full batches with unique IDs
      // This simulates a worst-case scenario where deletions never complete
      // and queries keep returning the same results
      mockQuery.mockImplementation(async () => {
        callCount++;
        // Always return a full batch with unique IDs
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
      expect(mockQuery.mock.calls.length).toBeLessThanOrEqual(maxBatches + 1); // maxBatches + possible retry

      // Should still attempt to delete collected IDs
      if (mockSendWriteOperation.mock.calls.length > 0) {
        const callArgs = mockSendWriteOperation.mock.calls[0][0];
        expect(callArgs.operation).toBe("delete");
        // Should have collected at least some IDs before hitting the limit
        expect(callArgs.data.recordIds.length).toBeGreaterThan(0);
      }
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

      // Verify delete was called first (query uses MAX_QUERY_LIMIT for pagination)
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
      mockQuery.mockResolvedValue([]);

      await deleteDocumentSnippets(workspaceId, specialDocumentId);

      // Should escape special characters properly
      expect(mockQuery).toHaveBeenCalledWith(workspaceId, "docs", {
        filter: `documentId = '${specialDocumentId}'`,
        limit: MAX_QUERY_LIMIT,
      });
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
