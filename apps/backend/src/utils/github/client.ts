import {
  getOAuthTokens,
  ensureValidToken,
  updateOAuthTokens,
} from "../googleApi/oauth";
import type { RefreshTokenFunction } from "../googleApi/oauth";
import { refreshGithubToken } from "../oauth/mcp/github";

const GITHUB_API_BASE = "https://api.github.com";

/**
 * Make a request to GitHub API with error handling and retry logic
 */
async function makeGithubApiRequest<T>(
  workspaceId: string,
  serverId: string,
  url: string,
  options: RequestInit = {},
  responseType: "json" | "text" = "json"
): Promise<T> {
  // Get OAuth tokens
  let tokens = await getOAuthTokens(workspaceId, serverId);

  // Ensure token is valid (refresh if needed)
  const refreshTokenFn: RefreshTokenFunction = refreshGithubToken;
  const accessToken = await ensureValidToken(
    workspaceId,
    serverId,
    tokens,
    refreshTokenFn
  );

  // Create abort signal for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Helpmaton/1.0",
        ...options.headers,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Handle authentication errors (401)
    if (response.status === 401) {
      // Try to refresh token and retry once
      // refreshGithubToken will handle the case where we have a refresh token or not
      const refreshed = await refreshTokenFn(tokens.refreshToken);
      await updateOAuthTokens(workspaceId, serverId, {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
      });

      // Retry with new token
      tokens = await getOAuthTokens(workspaceId, serverId);
      const retryResponse = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Helpmaton/1.0",
          ...options.headers,
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!retryResponse.ok) {
        throw new Error(
          `GitHub API authentication failed: ${retryResponse.status} ${retryResponse.statusText}`
        );
      }

      if (responseType === "text") {
        return (await retryResponse.text()) as T;
      }
      return (await retryResponse.json()) as T;
    }

    // Handle rate limiting (429)
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000; // Default to 60 seconds
      await new Promise((resolve) => setTimeout(resolve, delay));
      // Retry once after rate limit delay
      return makeGithubApiRequest<T>(
        workspaceId,
        serverId,
        url,
        options,
        responseType
      );
    }

    // Handle other errors
    if (!response.ok) {
      let errorMessage = `${response.status} ${response.statusText}`;
      try {
        const errorData = (await response.json()) as {
          message?: string;
        };
        errorMessage = errorData.message || errorMessage;
      } catch {
        // Ignore JSON parse errors
      }

      if (response.status === 403) {
        throw new Error(
          `GitHub API access forbidden: ${errorMessage}. Please check your repository permissions.`
        );
      }

      if (response.status === 404) {
        throw new Error(`GitHub resource not found: ${errorMessage}`);
      }

      throw new Error(`GitHub API error: ${errorMessage}`);
    }

    // Handle response based on type
    if (responseType === "text") {
      return (await response.text()) as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    clearTimeout(timeoutId);

    // Handle abort (timeout)
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("GitHub API request timeout");
    }

    // Re-throw if it's already an Error
    if (error instanceof Error) {
      throw error;
    }

    throw new Error(`Unexpected error: ${String(error)}`);
  }
}

/**
 * Get authenticated user info
 */
export async function getAuthenticatedUser(
  workspaceId: string,
  serverId: string
): Promise<{
  login: string;
  id: number;
  name?: string;
  email?: string;
  avatar_url?: string;
}> {
  const url = `${GITHUB_API_BASE}/user`;
  return makeGithubApiRequest(workspaceId, serverId, url);
}

/**
 * List user's repositories
 */
export async function listRepositories(
  workspaceId: string,
  serverId: string,
  options?: {
    type?: "all" | "owner" | "member";
    sort?: "created" | "updated" | "pushed" | "full_name";
    direction?: "asc" | "desc";
    per_page?: number;
    page?: number;
  }
): Promise<
  Array<{
    id: number;
    name: string;
    full_name: string;
    description?: string;
    private: boolean;
    html_url: string;
    clone_url: string;
    default_branch: string;
    created_at: string;
    updated_at: string;
    pushed_at: string;
    language?: string;
    stargazers_count: number;
    forks_count: number;
  }>
> {
  const params = new URLSearchParams();
  if (options?.type) params.append("type", options.type);
  if (options?.sort) params.append("sort", options.sort);
  if (options?.direction) params.append("direction", options.direction);
  if (options?.per_page) params.append("per_page", options.per_page.toString());
  if (options?.page) params.append("page", options.page.toString());

  const url = `${GITHUB_API_BASE}/user/repos?${params.toString()}`;
  return makeGithubApiRequest(workspaceId, serverId, url);
}

/**
 * Get repository details
 */
export async function getRepository(
  workspaceId: string,
  serverId: string,
  owner: string,
  repo: string
): Promise<{
  id: number;
  name: string;
  full_name: string;
  description?: string;
  private: boolean;
  html_url: string;
  clone_url: string;
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  language?: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  topics?: string[];
}> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}`;
  return makeGithubApiRequest(workspaceId, serverId, url);
}

/**
 * List repository issues
 */
export async function listIssues(
  workspaceId: string,
  serverId: string,
  owner: string,
  repo: string,
  options?: {
    state?: "open" | "closed" | "all";
    sort?: "created" | "updated" | "comments";
    direction?: "asc" | "desc";
    per_page?: number;
    page?: number;
  }
): Promise<
  Array<{
    id: number;
    number: number;
    title: string;
    body?: string;
    state: string;
    html_url: string;
    created_at: string;
    updated_at: string;
    user: {
      login: string;
      avatar_url?: string;
    };
    labels: Array<{
      name: string;
      color?: string;
    }>;
  }>
> {
  const params = new URLSearchParams();
  if (options?.state) params.append("state", options.state);
  if (options?.sort) params.append("sort", options.sort);
  if (options?.direction) params.append("direction", options.direction);
  if (options?.per_page) params.append("per_page", options.per_page.toString());
  if (options?.page) params.append("page", options.page.toString());

  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues?${params.toString()}`;
  return makeGithubApiRequest(workspaceId, serverId, url);
}

/**
 * Get issue details
 */
export async function getIssue(
  workspaceId: string,
  serverId: string,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<{
  id: number;
  number: number;
  title: string;
  body?: string;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  user: {
    login: string;
    avatar_url?: string;
  };
  labels: Array<{
    name: string;
    color?: string;
  }>;
  comments: number;
}> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}`;
  return makeGithubApiRequest(workspaceId, serverId, url);
}

/**
 * List pull requests
 */
export async function listPullRequests(
  workspaceId: string,
  serverId: string,
  owner: string,
  repo: string,
  options?: {
    state?: "open" | "closed" | "all";
    sort?: "created" | "updated" | "popularity";
    direction?: "asc" | "desc";
    per_page?: number;
    page?: number;
  }
): Promise<
  Array<{
    id: number;
    number: number;
    title: string;
    body?: string;
    state: string;
    html_url: string;
    created_at: string;
    updated_at: string;
    merged_at?: string;
    user: {
      login: string;
      avatar_url?: string;
    };
    head: {
      ref: string;
      sha: string;
    };
    base: {
      ref: string;
      sha: string;
    };
    mergeable?: boolean;
    merged: boolean;
  }>
> {
  const params = new URLSearchParams();
  if (options?.state) params.append("state", options.state);
  if (options?.sort) params.append("sort", options.sort);
  if (options?.direction) params.append("direction", options.direction);
  if (options?.per_page) params.append("per_page", options.per_page.toString());
  if (options?.page) params.append("page", options.page.toString());

  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls?${params.toString()}`;
  return makeGithubApiRequest(workspaceId, serverId, url);
}

/**
 * Get pull request details
 */
export async function getPullRequest(
  workspaceId: string,
  serverId: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<{
  id: number;
  number: number;
  title: string;
  body?: string;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  merged_at?: string;
  user: {
    login: string;
    avatar_url?: string;
  };
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
  mergeable?: boolean;
  merged: boolean;
  additions?: number;
  deletions?: number;
  changed_files?: number;
}> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}`;
  return makeGithubApiRequest(workspaceId, serverId, url);
}

/**
 * Get file contents
 */
export async function getFileContents(
  workspaceId: string,
  serverId: string,
  owner: string,
  repo: string,
  path: string,
  ref?: string
): Promise<{
  name: string;
  path: string;
  sha: string;
  size: number;
  type: string;
  content: string;
  encoding: string;
  html_url: string;
}> {
  const params = new URLSearchParams();
  if (ref) params.append("ref", ref);

  // Encode each path segment separately to preserve directory structure
  // e.g., "src/index.ts" -> "src/index.ts" (not "src%2Findex.ts")
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodedPath}?${params.toString()}`;
  const file = await makeGithubApiRequest<{
    name: string;
    path: string;
    sha: string;
    size: number;
    type: string;
    content: string;
    encoding: string;
    html_url: string;
  }>(workspaceId, serverId, url);

  // Decode base64 content
  if (file.encoding === "base64" && file.content) {
    file.content = Buffer.from(file.content, "base64").toString("utf-8");
  }

  return file;
}

/**
 * List repository commits
 */
export async function listCommits(
  workspaceId: string,
  serverId: string,
  owner: string,
  repo: string,
  options?: {
    sha?: string;
    path?: string;
    author?: string;
    since?: string;
    until?: string;
    per_page?: number;
    page?: number;
  }
): Promise<
  Array<{
    sha: string;
    commit: {
      message: string;
      author: {
        name: string;
        email: string;
        date: string;
      };
      committer: {
        name: string;
        email: string;
        date: string;
      };
    };
    author?: {
      login: string;
      avatar_url?: string;
    };
    html_url: string;
    stats?: {
      additions: number;
      deletions: number;
      total: number;
    };
  }>
> {
  const params = new URLSearchParams();
  if (options?.sha) params.append("sha", options.sha);
  if (options?.path) params.append("path", options.path);
  if (options?.author) params.append("author", options.author);
  if (options?.since) params.append("since", options.since);
  if (options?.until) params.append("until", options.until);
  if (options?.per_page) params.append("per_page", options.per_page.toString());
  if (options?.page) params.append("page", options.page.toString());

  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits?${params.toString()}`;
  return makeGithubApiRequest(workspaceId, serverId, url);
}

/**
 * Get commit details
 */
export async function getCommit(
  workspaceId: string,
  serverId: string,
  owner: string,
  repo: string,
  sha: string
): Promise<{
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      date: string;
    };
    committer: {
      name: string;
      email: string;
      date: string;
    };
  };
  author?: {
    login: string;
    avatar_url?: string;
  };
  html_url: string;
  stats?: {
    additions: number;
    deletions: number;
    total: number;
  };
  files?: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
  }>;
}> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits/${sha}`;
  return makeGithubApiRequest(workspaceId, serverId, url);
}
