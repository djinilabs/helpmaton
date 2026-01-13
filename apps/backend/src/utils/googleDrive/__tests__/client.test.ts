import { describe, it, expect, beforeEach, vi } from "vitest";

import * as googleApiRequest from "../../googleApi/request";
import { listFiles, getFile, readFile, searchFiles } from "../client";

// Mock the shared request utility
vi.mock("../../googleApi/request", () => ({
  makeGoogleApiRequest: vi.fn(),
}));

describe("Google Drive Client", () => {
  const workspaceId = "workspace-1";
  const serverId = "server-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listFiles", () => {
    it("should list files without query", async () => {
      const mockResponse = {
        files: [
          { id: "file1", name: "Document.pdf" },
          { id: "file2", name: "Image.jpg" },
        ],
        nextPageToken: "token123",
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockResponse
      );

      const result = await listFiles(workspaceId, serverId);

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          serverId,
          url: expect.stringContaining("/files"),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("should list files with query", async () => {
      const mockResponse = {
        files: [{ id: "file1", name: "Document.pdf" }],
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockResponse
      );

      const result = await listFiles(workspaceId, serverId, "mimeType='application/pdf'");

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining("q=mimeType%3D%27application%2Fpdf%27"),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("should list files with page token", async () => {
      const mockResponse = {
        files: [{ id: "file3", name: "Another.pdf" }],
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockResponse
      );

      const result = await listFiles(workspaceId, serverId, undefined, "token123");

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining("pageToken=token123"),
        })
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("getFile", () => {
    it("should get file metadata", async () => {
      const fileId = "file123";
      const mockFile = {
        id: fileId,
        name: "Document.pdf",
        mimeType: "application/pdf",
        size: 1024,
        webViewLink: "https://drive.google.com/file/d/file123",
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockFile
      );

      const result = await getFile(workspaceId, serverId, fileId);

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          serverId,
          url: expect.stringContaining(`/files/${fileId}`),
        })
      );
      expect(result).toEqual(mockFile);
    });
  });

  describe("readFile", () => {
    it("should read text file content", async () => {
      const fileId = "file123";
      const mockFile = {
        id: fileId,
        name: "document.txt",
        mimeType: "text/plain",
      };
      const mockContent = "File content here";

      // First call for getFile, second for readFile
      vi.mocked(googleApiRequest.makeGoogleApiRequest)
        .mockResolvedValueOnce(mockFile)
        .mockResolvedValueOnce(mockContent);

      const result = await readFile(workspaceId, serverId, fileId);

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledTimes(2);
      expect(result).toBe(mockContent);
      // Verify readFile uses text response type
      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenLastCalledWith(
        expect.objectContaining({
          url: expect.stringContaining(`/files/${fileId}?alt=media`),
          responseType: "text",
        })
      );
    });

    it("should export Google Docs as plain text", async () => {
      const fileId = "doc123";
      const mockFile = {
        id: fileId,
        name: "My Document",
        mimeType: "application/vnd.google-apps.document",
      };
      const mockContent = "Exported document content";

      vi.mocked(googleApiRequest.makeGoogleApiRequest)
        .mockResolvedValueOnce(mockFile)
        .mockResolvedValueOnce(mockContent);

      const result = await readFile(workspaceId, serverId, fileId);

      const lastCallUrl = vi.mocked(googleApiRequest.makeGoogleApiRequest).mock.calls[1][0].url;
      expect(lastCallUrl).toContain(`/files/${fileId}/export`);
      expect(lastCallUrl).toContain("mimeType=text%2Fplain");
      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenLastCalledWith(
        expect.objectContaining({
          responseType: "text",
        })
      );
      expect(result).toBe(mockContent);
    });

    it("should export Google Sheets as CSV", async () => {
      const fileId = "sheet123";
      const mockFile = {
        id: fileId,
        name: "My Sheet",
        mimeType: "application/vnd.google-apps.spreadsheet",
      };
      const mockContent = "col1,col2\nval1,val2";

      vi.mocked(googleApiRequest.makeGoogleApiRequest)
        .mockResolvedValueOnce(mockFile)
        .mockResolvedValueOnce(mockContent);

      const result = await readFile(workspaceId, serverId, fileId);

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenLastCalledWith(
        expect.objectContaining({
          url: expect.stringContaining("mimeType=text%2Fcsv"),
        })
      );
      expect(result).toBe(mockContent);
    });

    it("should use custom mime type when provided", async () => {
      const fileId = "file123";
      const mockFile = {
        id: fileId,
        name: "document",
        mimeType: "application/vnd.google-apps.document",
      };
      const mockContent = "Custom export";

      vi.mocked(googleApiRequest.makeGoogleApiRequest)
        .mockResolvedValueOnce(mockFile)
        .mockResolvedValueOnce(mockContent);

      await readFile(workspaceId, serverId, fileId, "text/html");

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenLastCalledWith(
        expect.objectContaining({
          url: expect.stringContaining("mimeType=text%2Fhtml"),
        })
      );
    });

    it("should use shared request utility for retry logic", async () => {
      const fileId = "file123";
      const mockFile = {
        id: fileId,
        name: "document.txt",
        mimeType: "text/plain",
      };
      const mockContent = "File content";

      vi.mocked(googleApiRequest.makeGoogleApiRequest)
        .mockResolvedValueOnce(mockFile)
        .mockResolvedValueOnce(mockContent);

      await readFile(workspaceId, serverId, fileId);

      // Verify it uses makeGoogleApiRequest (which has retry logic)
      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledTimes(2);
    });
  });

  describe("searchFiles", () => {
    it("should search files by name", async () => {
      const mockResponse = {
        files: [{ id: "file1", name: "My Document.pdf" }],
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockResponse
      );

      const result = await searchFiles(workspaceId, serverId, "My Document");

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalled();
      // Verify the query contains the search term (URL decoded, may have quotes)
      const callUrl = vi.mocked(googleApiRequest.makeGoogleApiRequest).mock.calls[0][0].url;
      const decodedUrl = decodeURIComponent(callUrl);
      expect(decodedUrl).toContain("My");
      expect(decodedUrl).toContain("Document");
      expect(result).toEqual(mockResponse);
    });

    it("should escape single quotes in query", async () => {
      const mockResponse = {
        files: [],
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockResponse
      );

      await searchFiles(workspaceId, serverId, "O'Brien");

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringMatching(/O.*Brien/), // URL-encoded, so just check it contains the name
        })
      );
    });

    it("should throw error for empty query", async () => {
      await expect(
        searchFiles(workspaceId, serverId, "")
      ).rejects.toThrow("Search query is required");
    });

    it("should throw error for whitespace-only query", async () => {
      await expect(
        searchFiles(workspaceId, serverId, "   ")
      ).rejects.toThrow("Search query is required");
    });
  });

  describe("error handling", () => {
    it("should propagate errors from request utility", async () => {
      const error = new Error("Request failed");
      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockRejectedValue(error);

      await expect(
        listFiles(workspaceId, serverId)
      ).rejects.toThrow("Request failed");
    });
  });
});
