/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { database } from "../../../tables";
import * as githubClient from "../../../utils/github/client";
import {
  createGithubListRepositoriesTool,
  createGithubGetRepositoryTool,
  createGithubListIssuesTool,
  createGithubGetIssueTool,
  createGithubListPullRequestsTool,
  createGithubGetPullRequestTool,
  createGithubReadFileTool,
  createGithubListCommitsTool,
  createGithubGetCommitTool,
} from "../githubTools";

// Mock database
vi.mock("../../../tables", () => ({
  database: vi.fn(),
}));

// Mock github client
vi.mock("../../../utils/github/client", () => ({
  listRepositories: vi.fn(),
  getRepository: vi.fn(),
  listIssues: vi.fn(),
  getIssue: vi.fn(),
  listPullRequests: vi.fn(),
  getPullRequest: vi.fn(),
  getFileContents: vi.fn(),
  listCommits: vi.fn(),
  getCommit: vi.fn(),
}));

describe("GitHub Tools", () => {
  const workspaceId = "workspace-1";
  const serverId = "server-1";
  const mockDb = {
    "mcp-server": {
      get: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(database).mockResolvedValue(mockDb as any);
  });

  describe("createGithubListRepositoriesTool", () => {
    it("should list repositories successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const mockRepos = [
        {
          id: 1,
          name: "repo-1",
          full_name: "owner/repo-1",
          description: "Test repo",
          private: false,
          html_url: "https://github.com/owner/repo-1",
          clone_url: "https://github.com/owner/repo-1.git",
          default_branch: "main",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          pushed_at: "2024-01-01T00:00:00Z",
          language: "TypeScript",
          stargazers_count: 10,
          forks_count: 5,
        },
      ];

      vi.mocked(githubClient.listRepositories).mockResolvedValue(mockRepos);

      const tool = createGithubListRepositoriesTool(workspaceId, serverId);
      const result = await (tool as any).execute({});

      expect(githubClient.listRepositories).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        { per_page: 30 }
      );
      expect(result).toContain("repo-1");
    });

    it("should return error if not connected", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {},
      });

      const tool = createGithubListRepositoriesTool(workspaceId, serverId);
      const result = await (tool as any).execute({});

      expect(result).toContain("GitHub is not connected");
      expect(githubClient.listRepositories).not.toHaveBeenCalled();
    });

    it("should handle API errors", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      vi.mocked(githubClient.listRepositories).mockRejectedValue(
        new Error("API error")
      );

      const tool = createGithubListRepositoriesTool(workspaceId, serverId);
      const result = await (tool as any).execute({});

      expect(result).toContain("Error listing GitHub repositories");
      expect(result).toContain("API error");
    });
  });

  describe("createGithubGetRepositoryTool", () => {
    it("should get repository successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const mockRepo = {
        id: 1,
        name: "repo-1",
        full_name: "owner/repo-1",
        description: "Test repo",
        private: false,
        html_url: "https://github.com/owner/repo-1",
        clone_url: "https://github.com/owner/repo-1.git",
        default_branch: "main",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        pushed_at: "2024-01-01T00:00:00Z",
        language: "TypeScript",
        stargazers_count: 10,
        forks_count: 5,
        open_issues_count: 3,
        topics: [],
      };

      vi.mocked(githubClient.getRepository).mockResolvedValue(mockRepo);

      const tool = createGithubGetRepositoryTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        owner: "owner",
        repo: "repo-1",
      });

      expect(githubClient.getRepository).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        "owner",
        "repo-1"
      );
      expect(result).toContain("repo-1");
    });

    it("should return error if not connected", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {},
      });

      const tool = createGithubGetRepositoryTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        owner: "owner",
        repo: "repo-1",
      });

      expect(result).toContain("GitHub is not connected");
      expect(githubClient.getRepository).not.toHaveBeenCalled();
    });

    it("should return validation error for unknown fields", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: { accessToken: "token-123" },
      });

      const tool = createGithubGetRepositoryTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        owner: "owner",
        repo: "repo-1",
        extra: "nope",
      });

      expect(result).toContain("Invalid tool arguments");
      expect(result).toContain("Unknown field");
      expect(githubClient.getRepository).not.toHaveBeenCalled();
    });
  });

  describe("createGithubListIssuesTool", () => {
    it("should list issues successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const mockIssues = [
        {
          id: 1,
          number: 1,
          title: "Test issue",
          state: "open",
          body: "Issue description",
          html_url: "https://github.com/owner/repo-1/issues/1",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          user: { login: "testuser" },
          labels: [],
        },
      ];

      vi.mocked(githubClient.listIssues).mockResolvedValue(mockIssues);

      const tool = createGithubListIssuesTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        owner: "owner",
        repo: "repo-1",
      });

      expect(githubClient.listIssues).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        "owner",
        "repo-1",
        expect.any(Object)
      );
      expect(result).toContain("Test issue");
    });

    it("should return error if not connected", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {},
      });

      const tool = createGithubListIssuesTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        owner: "owner",
        repo: "repo-1",
      });

      expect(result).toContain("GitHub is not connected");
      expect(githubClient.listIssues).not.toHaveBeenCalled();
    });
  });

  describe("createGithubGetIssueTool", () => {
    it("should get issue successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const mockIssue = {
        id: 1,
        number: 1,
        title: "Test issue",
        state: "open",
        body: "Issue description",
        html_url: "https://github.com/owner/repo-1/issues/1",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        user: { login: "testuser" },
        labels: [],
        comments: 0,
      };

      vi.mocked(githubClient.getIssue).mockResolvedValue(mockIssue);

      const tool = createGithubGetIssueTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        owner: "owner",
        repo: "repo-1",
        issueNumber: 1,
      });

      expect(githubClient.getIssue).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        "owner",
        "repo-1",
        1
      );
      expect(result).toContain("Test issue");
    });

    it("should return error if not connected", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {},
      });

      const tool = createGithubGetIssueTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        owner: "owner",
        repo: "repo-1",
        issueNumber: 1,
      });

      expect(result).toContain("GitHub is not connected");
      expect(githubClient.getIssue).not.toHaveBeenCalled();
    });
  });

  describe("createGithubListPullRequestsTool", () => {
    it("should list pull requests successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const mockPRs = [
        {
          id: 1,
          number: 1,
          title: "Test PR",
          state: "open",
          body: "PR description",
          html_url: "https://github.com/owner/repo-1/pull/1",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          user: { login: "testuser" },
          head: { ref: "feature", sha: "abc123" },
          base: { ref: "main", sha: "def456" },
          merged: false,
        },
      ];

      vi.mocked(githubClient.listPullRequests).mockResolvedValue(mockPRs);

      const tool = createGithubListPullRequestsTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        owner: "owner",
        repo: "repo-1",
      });

      expect(githubClient.listPullRequests).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        "owner",
        "repo-1",
        expect.any(Object)
      );
      expect(result).toContain("Test PR");
    });

    it("should return error if not connected", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {},
      });

      const tool = createGithubListPullRequestsTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        owner: "owner",
        repo: "repo-1",
      });

      expect(result).toContain("GitHub is not connected");
      expect(githubClient.listPullRequests).not.toHaveBeenCalled();
    });
  });

  describe("createGithubGetPullRequestTool", () => {
    it("should get pull request successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const mockPR = {
        id: 1,
        number: 1,
        title: "Test PR",
        state: "open",
        body: "PR description",
        html_url: "https://github.com/owner/repo-1/pull/1",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        user: { login: "testuser" },
        head: { ref: "feature", sha: "abc123" },
        base: { ref: "main", sha: "def456" },
        merged: false,
        changed_files: 5,
      };

      vi.mocked(githubClient.getPullRequest).mockResolvedValue(mockPR);

      const tool = createGithubGetPullRequestTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        owner: "owner",
        repo: "repo-1",
        prNumber: 1,
      });

      expect(githubClient.getPullRequest).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        "owner",
        "repo-1",
        1
      );
      expect(result).toContain("Test PR");
    });

    it("should return error if not connected", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {},
      });

      const tool = createGithubGetPullRequestTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        owner: "owner",
        repo: "repo-1",
        prNumber: 1,
      });

      expect(result).toContain("GitHub is not connected");
      expect(githubClient.getPullRequest).not.toHaveBeenCalled();
    });
  });

  describe("createGithubReadFileTool", () => {
    it("should read file successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const mockFile = {
        name: "README.md",
        path: "README.md",
        sha: "abc123",
        size: 100,
        type: "file",
        content: "SGVsbG8gV29ybGQ=", // Base64 encoded "Hello World"
        encoding: "base64",
        html_url: "https://github.com/owner/repo-1/blob/main/README.md",
      };

      vi.mocked(githubClient.getFileContents).mockResolvedValue(mockFile);

      const tool = createGithubReadFileTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        owner: "owner",
        repo: "repo-1",
        path: "README.md",
      });

      expect(githubClient.getFileContents).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        "owner",
        "repo-1",
        "README.md",
        undefined
      );
      expect(result).toContain("README.md");
    });

    it("should return error if not connected", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {},
      });

      const tool = createGithubReadFileTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        owner: "owner",
        repo: "repo-1",
        path: "README.md",
      });

      expect(result).toContain("GitHub is not connected");
      expect(githubClient.getFileContents).not.toHaveBeenCalled();
    });
  });

  describe("createGithubListCommitsTool", () => {
    it("should list commits successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const mockCommits = [
        {
          sha: "abc123",
          commit: {
            message: "Test commit",
            author: { name: "Test User", email: "test@example.com", date: "2024-01-01T00:00:00Z" },
            committer: { name: "Test User", email: "test@example.com", date: "2024-01-01T00:00:00Z" },
          },
          html_url: "https://github.com/owner/repo-1/commit/abc123",
        },
      ];

      vi.mocked(githubClient.listCommits).mockResolvedValue(mockCommits);

      const tool = createGithubListCommitsTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        owner: "owner",
        repo: "repo-1",
      });

      expect(githubClient.listCommits).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        "owner",
        "repo-1",
        expect.any(Object)
      );
      expect(result).toContain("Test commit");
    });

    it("should return error if not connected", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {},
      });

      const tool = createGithubListCommitsTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        owner: "owner",
        repo: "repo-1",
      });

      expect(result).toContain("GitHub is not connected");
      expect(githubClient.listCommits).not.toHaveBeenCalled();
    });
  });

  describe("createGithubGetCommitTool", () => {
    it("should get commit successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const mockCommit = {
        sha: "abc123",
        commit: {
          message: "Test commit",
          author: { name: "Test User", email: "test@example.com", date: "2024-01-01T00:00:00Z" },
          committer: { name: "Test User", email: "test@example.com", date: "2024-01-01T00:00:00Z" },
        },
        html_url: "https://github.com/owner/repo-1/commit/abc123",
      };

      vi.mocked(githubClient.getCommit).mockResolvedValue(mockCommit);

      const tool = createGithubGetCommitTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        owner: "owner",
        repo: "repo-1",
        sha: "abc123",
      });

      expect(githubClient.getCommit).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        "owner",
        "repo-1",
        "abc123"
      );
      expect(result).toContain("Test commit");
    });

    it("should return error if not connected", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {},
      });

      const tool = createGithubGetCommitTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        owner: "owner",
        repo: "repo-1",
        sha: "abc123",
      });

      expect(result).toContain("GitHub is not connected");
      expect(githubClient.getCommit).not.toHaveBeenCalled();
    });
  });
});
