import {
  getOAuthTokens,
  ensureValidToken,
  updateOAuthTokens,
} from "../googleApi/oauth";
import type { RefreshTokenFunction } from "../googleApi/oauth";
import { refreshLinearToken } from "../oauth/mcp/linear";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const DEFAULT_PAGE_SIZE = 50;

interface LinearGraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

async function makeLinearRequest<T>(
  workspaceId: string,
  serverId: string,
  query: string,
  variables?: Record<string, unknown>,
  attempt: number = 0
): Promise<T> {
  const tokens = await getOAuthTokens(workspaceId, serverId);
  const refreshTokenFn: RefreshTokenFunction = refreshLinearToken;
  const accessToken = await ensureValidToken(
    workspaceId,
    serverId,
    tokens,
    refreshTokenFn
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(LINEAR_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: variables || {},
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 401 && attempt === 0) {
      const refreshed = await refreshTokenFn(tokens.refreshToken);
      await updateOAuthTokens(workspaceId, serverId, {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
      });
      return makeLinearRequest<T>(
        workspaceId,
        serverId,
        query,
        variables,
        attempt + 1
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Linear API error: ${response.status} ${response.statusText} ${errorText}`
      );
    }

    const payload = (await response.json()) as LinearGraphQLResponse<T>;
    if (payload.errors?.length) {
      const message =
        payload.errors.map((error) => error.message).join("; ") ||
        "Unknown Linear API error";
      throw new Error(message);
    }

    if (!payload.data) {
      throw new Error("Linear API returned no data");
    }

    return payload.data;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Linear API request timeout");
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Unexpected error: ${String(error)}`);
  }
}

export async function listTeams(
  workspaceId: string,
  serverId: string
): Promise<
  Array<{
    id: string;
    name: string;
    key: string;
    description?: string | null;
  }>
> {
  const query = `
    query ListTeams {
      teams {
        nodes {
          id
          name
          key
          description
        }
      }
    }
  `;

  const data = await makeLinearRequest<{
    teams: { nodes: Array<{ id: string; name: string; key: string; description?: string | null }> };
  }>(workspaceId, serverId, query);

  return data.teams.nodes;
}

export async function listProjects(
  workspaceId: string,
  serverId: string,
  options?: {
    first?: number;
    after?: string;
  }
): Promise<{
  nodes: Array<{
    id: string;
    name: string;
    description?: string | null;
    startDate?: string | null;
    targetDate?: string | null;
    state?: string | null;
  }>;
  pageInfo: { hasNextPage: boolean; endCursor?: string | null };
}> {
  const query = `
    query ListProjects($first: Int, $after: String) {
      projects(first: $first, after: $after) {
        nodes {
          id
          name
          description
          startDate
          targetDate
          state
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const data = await makeLinearRequest<{
    projects: {
      nodes: Array<{
        id: string;
        name: string;
        description?: string | null;
        startDate?: string | null;
        targetDate?: string | null;
        state?: string | null;
      }>;
      pageInfo: { hasNextPage: boolean; endCursor?: string | null };
    };
  }>(workspaceId, serverId, query, {
    first: options?.first ?? DEFAULT_PAGE_SIZE,
    after: options?.after,
  });

  return data.projects;
}

function buildIssueFilter(options?: {
  teamId?: string;
  projectId?: string;
  assigneeId?: string;
  state?: string;
}) {
  const filter: Record<string, unknown> = {};

  if (options?.teamId) {
    filter.team = { id: { eq: options.teamId } };
  }

  if (options?.projectId) {
    filter.project = { id: { eq: options.projectId } };
  }

  if (options?.assigneeId) {
    filter.assignee = { id: { eq: options.assigneeId } };
  }

  if (options?.state) {
    filter.state = { name: { eq: options.state } };
  }

  return Object.keys(filter).length ? filter : undefined;
}

export async function listIssues(
  workspaceId: string,
  serverId: string,
  options?: {
    teamId?: string;
    projectId?: string;
    assigneeId?: string;
    state?: string;
    first?: number;
    after?: string;
  }
): Promise<{
  nodes: Array<{
    id: string;
    identifier: string;
    title: string;
    description?: string | null;
    url: string;
    priority?: number | null;
    state?: { name: string; type: string };
    team?: { id: string; name: string; key: string };
    assignee?: { id: string; name: string };
    project?: { id: string; name: string };
  }>;
  pageInfo: { hasNextPage: boolean; endCursor?: string | null };
}> {
  const query = `
    query ListIssues($first: Int, $after: String, $filter: IssueFilter) {
      issues(first: $first, after: $after, filter: $filter) {
        nodes {
          id
          identifier
          title
          description
          url
          priority
          state {
            name
            type
          }
          team {
            id
            name
            key
          }
          assignee {
            id
            name
          }
          project {
            id
            name
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const data = await makeLinearRequest<{
    issues: {
      nodes: Array<{
        id: string;
        identifier: string;
        title: string;
        description?: string | null;
        url: string;
        priority?: number | null;
        state?: { name: string; type: string };
        team?: { id: string; name: string; key: string };
        assignee?: { id: string; name: string };
        project?: { id: string; name: string };
      }>;
      pageInfo: { hasNextPage: boolean; endCursor?: string | null };
    };
  }>(workspaceId, serverId, query, {
    first: options?.first ?? DEFAULT_PAGE_SIZE,
    after: options?.after,
    filter: buildIssueFilter(options),
  });

  return data.issues;
}

export async function getIssue(
  workspaceId: string,
  serverId: string,
  issueId: string
): Promise<{
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  url: string;
  priority?: number | null;
  state?: { name: string; type: string };
  team?: { id: string; name: string; key: string };
  assignee?: { id: string; name: string };
  project?: { id: string; name: string };
}> {
  const query = `
    query GetIssue($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        description
        url
        priority
        state {
          name
          type
        }
        team {
          id
          name
          key
        }
        assignee {
          id
          name
        }
        project {
          id
          name
        }
      }
    }
  `;

  const data = await makeLinearRequest<{
    issue: {
      id: string;
      identifier: string;
      title: string;
      description?: string | null;
      url: string;
      priority?: number | null;
      state?: { name: string; type: string };
      team?: { id: string; name: string; key: string };
      assignee?: { id: string; name: string };
      project?: { id: string; name: string };
    };
  }>(workspaceId, serverId, query, { id: issueId });

  return data.issue;
}

export async function searchIssues(
  workspaceId: string,
  serverId: string,
  options: {
    query: string;
    teamId?: string;
    projectId?: string;
    assigneeId?: string;
    state?: string;
    first?: number;
    after?: string;
  }
): Promise<{
  nodes: Array<{
    id: string;
    identifier: string;
    title: string;
    description?: string | null;
    url: string;
    priority?: number | null;
    state?: { name: string; type: string };
    team?: { id: string; name: string; key: string };
    assignee?: { id: string; name: string };
    project?: { id: string; name: string };
  }>;
  pageInfo: { hasNextPage: boolean; endCursor?: string | null };
}> {
  const query = `
    query SearchIssues($term: String!, $first: Int, $after: String, $filter: IssueFilter) {
      searchIssues(term: $term, first: $first, after: $after, filter: $filter) {
        nodes {
          id
          identifier
          title
          description
          url
          priority
          state {
            name
            type
          }
          team {
            id
            name
            key
          }
          assignee {
            id
            name
          }
          project {
            id
            name
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const data = await makeLinearRequest<{
    searchIssues: {
      nodes: Array<{
        id: string;
        identifier: string;
        title: string;
        description?: string | null;
        url: string;
        priority?: number | null;
        state?: { name: string; type: string };
        team?: { id: string; name: string; key: string };
        assignee?: { id: string; name: string };
        project?: { id: string; name: string };
      }>;
      pageInfo: { hasNextPage: boolean; endCursor?: string | null };
    };
  }>(workspaceId, serverId, query, {
    term: options.query,
    first: options.first ?? DEFAULT_PAGE_SIZE,
    after: options.after,
    filter: buildIssueFilter(options),
  });

  return data.searchIssues;
}
