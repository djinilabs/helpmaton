import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import * as githubClient from "../../utils/github/client";

/**
 * Check if MCP server has OAuth connection
 */
async function hasOAuthConnection(
  workspaceId: string,
  serverId: string
): Promise<boolean> {
  const db = await database();
  const pk = `mcp-servers/${workspaceId}/${serverId}`;
  const server = await db["mcp-server"].get(pk, "server");

  if (!server || server.authType !== "oauth") {
    return false;
  }

  const config = server.config as {
    accessToken?: string;
  };

  return !!config.accessToken;
}

/**
 * Create GitHub list repositories tool
 */
export function createGithubListRepositoriesTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "List repositories accessible to the authenticated user. Returns a list of repositories with their metadata (name, description, language, stars, etc.). Supports filtering and pagination.",
    parameters: z.object({
      type: z
        .enum(["all", "owner", "member"])
        .optional()
        .describe("Filter by repository type: 'all' (default), 'owner', or 'member'"),
      sort: z
        .enum(["created", "updated", "pushed", "full_name"])
        .optional()
        .describe("Sort repositories by: 'created', 'updated', 'pushed', or 'full_name'"),
      direction: z
        .enum(["asc", "desc"])
        .optional()
        .describe("Sort direction: 'asc' or 'desc'"),
      per_page: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of results per page (1-100, default: 30)"),
      page: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Page number (default: 1)"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: GitHub is not connected. Please connect your GitHub account first.";
        }

        const result = await githubClient.listRepositories(
          workspaceId,
          serverId,
          args
        );

        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in GitHub list repositories tool:", error);
        return `Error listing GitHub repositories: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create GitHub get repository tool
 */
export function createGithubGetRepositoryTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "Get detailed information about a specific repository. Returns repository metadata including description, language, stars, forks, and more.",
    parameters: z.object({
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: GitHub is not connected. Please connect your GitHub account first.";
        }

        const result = await githubClient.getRepository(
          workspaceId,
          serverId,
          args.owner,
          args.repo
        );

        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in GitHub get repository tool:", error);
        return `Error getting GitHub repository: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create GitHub list issues tool
 */
export function createGithubListIssuesTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "List issues in a repository. Returns a list of issues with their metadata (title, state, labels, etc.). Supports filtering by state and pagination.",
    parameters: z.object({
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      state: z
        .enum(["open", "closed", "all"])
        .optional()
        .describe("Filter by issue state: 'open', 'closed', or 'all' (default: 'open')"),
      sort: z
        .enum(["created", "updated", "comments"])
        .optional()
        .describe("Sort issues by: 'created', 'updated', or 'comments'"),
      direction: z
        .enum(["asc", "desc"])
        .optional()
        .describe("Sort direction: 'asc' or 'desc'"),
      per_page: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of results per page (1-100, default: 30)"),
      page: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Page number (default: 1)"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: GitHub is not connected. Please connect your GitHub account first.";
        }

        const result = await githubClient.listIssues(
          workspaceId,
          serverId,
          args.owner,
          args.repo,
          args
        );

        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in GitHub list issues tool:", error);
        return `Error listing GitHub issues: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create GitHub get issue tool
 */
export function createGithubGetIssueTool(workspaceId: string, serverId: string) {
  return tool({
    description:
      "Get detailed information about a specific issue. Returns issue metadata including title, body, state, labels, comments count, and more.",
    parameters: z.object({
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      issueNumber: z
        .number()
        .int()
        .min(1)
        .describe("Issue number"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: GitHub is not connected. Please connect your GitHub account first.";
        }

        const result = await githubClient.getIssue(
          workspaceId,
          serverId,
          args.owner,
          args.repo,
          args.issueNumber
        );

        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in GitHub get issue tool:", error);
        return `Error getting GitHub issue: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create GitHub list pull requests tool
 */
export function createGithubListPullRequestsTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "List pull requests in a repository. Returns a list of pull requests with their metadata (title, state, merge status, etc.). Supports filtering by state and pagination.",
    parameters: z.object({
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      state: z
        .enum(["open", "closed", "all"])
        .optional()
        .describe("Filter by PR state: 'open', 'closed', or 'all' (default: 'open')"),
      sort: z
        .enum(["created", "updated", "popularity"])
        .optional()
        .describe("Sort PRs by: 'created', 'updated', or 'popularity'"),
      direction: z
        .enum(["asc", "desc"])
        .optional()
        .describe("Sort direction: 'asc' or 'desc'"),
      per_page: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of results per page (1-100, default: 30)"),
      page: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Page number (default: 1)"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: GitHub is not connected. Please connect your GitHub account first.";
        }

        const result = await githubClient.listPullRequests(
          workspaceId,
          serverId,
          args.owner,
          args.repo,
          args
        );

        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in GitHub list pull requests tool:", error);
        return `Error listing GitHub pull requests: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create GitHub get pull request tool
 */
export function createGithubGetPullRequestTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "Get detailed information about a specific pull request. Returns PR metadata including title, body, state, merge status, additions, deletions, and more.",
    parameters: z.object({
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      prNumber: z
        .number()
        .int()
        .min(1)
        .describe("Pull request number"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: GitHub is not connected. Please connect your GitHub account first.";
        }

        const result = await githubClient.getPullRequest(
          workspaceId,
          serverId,
          args.owner,
          args.repo,
          args.prNumber
        );

        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in GitHub get pull request tool:", error);
        return `Error getting GitHub pull request: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create GitHub read file tool
 */
export function createGithubReadFileTool(workspaceId: string, serverId: string) {
  return tool({
    description:
      "Read the contents of a file from a repository. Returns the file content, metadata, and URL. Supports reading from specific branches or commits.",
    parameters: z.object({
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      path: z.string().describe("File path in the repository (e.g., 'src/index.ts' or 'README.md')"),
      ref: z
        .string()
        .optional()
        .describe("Branch, tag, or commit SHA (default: repository's default branch)"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: GitHub is not connected. Please connect your GitHub account first.";
        }

        const result = await githubClient.getFileContents(
          workspaceId,
          serverId,
          args.owner,
          args.repo,
          args.path,
          args.ref
        );

        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in GitHub read file tool:", error);
        return `Error reading GitHub file: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create GitHub list commits tool
 */
export function createGithubListCommitsTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "List commits in a repository. Returns a list of commits with their metadata (message, author, date, etc.). Supports filtering by author, path, date range, and pagination.",
    parameters: z.object({
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      sha: z
        .string()
        .optional()
        .describe("SHA or branch to start listing commits from"),
      path: z
        .string()
        .optional()
        .describe("Only commits containing this file path will be returned"),
      author: z
        .string()
        .optional()
        .describe("GitHub login or email address by which to filter by commit author"),
      since: z
        .string()
        .optional()
        .describe("Only show commits after this date (ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ)"),
      until: z
        .string()
        .optional()
        .describe("Only show commits before this date (ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ)"),
      per_page: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of results per page (1-100, default: 30)"),
      page: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Page number (default: 1)"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: GitHub is not connected. Please connect your GitHub account first.";
        }

        const { owner, repo, ...options } = args;
        const result = await githubClient.listCommits(
          workspaceId,
          serverId,
          owner,
          repo,
          options
        );

        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in GitHub list commits tool:", error);
        return `Error listing GitHub commits: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create GitHub get commit tool
 */
export function createGithubGetCommitTool(workspaceId: string, serverId: string) {
  return tool({
    description:
      "Get detailed information about a specific commit. Returns commit metadata including message, author, date, stats (additions, deletions), and changed files.",
    parameters: z.object({
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      sha: z.string().describe("Commit SHA"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: GitHub is not connected. Please connect your GitHub account first.";
        }

        const result = await githubClient.getCommit(
          workspaceId,
          serverId,
          args.owner,
          args.repo,
          args.sha
        );

        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in GitHub get commit tool:", error);
        return `Error getting GitHub commit: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}
