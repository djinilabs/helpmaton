# Subscription Management

This document describes the subscription system in Helpmaton, including plans, limits, and management rules.

## Overview

Helpmaton supports subscription-based access control with three plans: **free**, **starter**, and **pro**. Each subscription belongs to a user and can have multiple managers. Workspaces are associated with subscriptions, and all limits are enforced at the subscription level.

## Subscription Plans

### Free Plan

- **Maximum workspaces**: 1
- **Maximum documents**: 10
- **Maximum total document size**: 1 MB
- **Maximum agents**: 1 (total across all workspaces)
- **Maximum managers**: 1
- **Maximum daily requests**: 25 LLM requests per 24 hours (rolling window)
- **Maximum users**: 1 team member
- **Maximum webhooks**: 5
- **Maximum channels**: 2 output channels
- **Maximum MCP servers**: 2
- **Expiration**: None (free plans never expire)

### Starter Plan

- **Maximum workspaces**: 1
- **Maximum documents**: 100
- **Maximum total document size**: 10 MB
- **Maximum agents**: 5 (total across all workspaces)
- **Maximum managers**: 1
- **Maximum daily requests**: 3,000 LLM requests per 24 hours (rolling window)
- **Maximum users**: 1 team member
- **Maximum webhooks**: 25
- **Maximum channels**: 10 output channels
- **Maximum MCP servers**: 10
- **Expiration**: None (active until cancelled or upgraded)

### Pro Plan

- **Maximum workspaces**: 5
- **Maximum documents**: 1000
- **Maximum total document size**: 100 MB
- **Maximum agents**: 50 (total across all workspaces)
- **Maximum managers**: Unlimited
- **Maximum daily requests**: 10,000 LLM requests per 24 hours (rolling window)
- **Maximum users**: 5 team members
- **Maximum webhooks**: 250
- **Maximum channels**: 50 output channels
- **Maximum MCP servers**: 50
- **Expiration**: None (active until cancelled or upgraded)

## User Subscription Limit

- **Each user can only have one subscription**
- When a user first creates a workspace, a free subscription is automatically created for them
- The user who creates the subscription becomes the subscription owner
- The subscription owner has full manager permissions
- Users cannot have multiple subscriptions

## Subscription Ownership

### Initial Ownership

- When a user first creates a workspace, a free subscription is automatically created for them
- The user who creates the subscription becomes the subscription owner
- The subscription owner has full manager permissions

### Subscription Association

- Each workspace belongs to exactly one subscription
- When a workspace is created, it is automatically associated with the creator's subscription
- If a user has no subscription, a free subscription is created automatically (auto-migration)

## Manager Management

### Manager Roles

- **Managers** are users who have permission to manage a subscription
- All managers have equal permissions (OWNER level on the subscription resource)
- Managers can:
  - Add other users as managers
  - Remove other managers (with restrictions)
  - Access all workspaces in the subscription (based on workspace permissions)

### Adding Managers

**Rules for adding a manager:**

1. The user adding the manager must be a manager of the subscription
2. The subscription must not have reached its manager limit:
   - Free and starter plans can only have 1 manager max
   - Pro plans have unlimited managers
3. The user being added must meet one of these conditions:
   - Have no subscription, OR
   - Be in a free subscription (they can be added as a manager, but their old free subscription is not automatically removed or transferred)

**API Endpoints:**

```
POST /api/subscription/managers/:userId
POST /api/subscriptions/:subscriptionId/managers/:userId
```

**Authorization:** Requires manager permission on the subscription

**Validation:**

- Checks that the current user is a manager
- Validates that the subscription has not reached its manager limit (for free/starter plans)
- Validates that the target user can be added (no subscription or free subscription only)
- Creates manager permission for the target user

### Removing Managers

**Rules for removing a manager:**

1. The user removing the manager must be a manager of the subscription
2. The subscription must have more than one manager (prevents orphaned subscriptions)
3. A manager cannot remove themselves if they are the last manager

**API Endpoints:**

```
DELETE /api/subscription/managers/:userId
DELETE /api/subscriptions/:subscriptionId/managers/:userId
```

**Authorization:** Requires manager permission on the subscription

**Validation:**

- Checks that the current user is a manager
- Validates that there is more than one manager (prevents orphan)
- Removes manager permission for the target user

## Limit Enforcement

### Workspace Limits

- Enforced when creating a new workspace
- Counts all workspaces associated with the subscription
- Returns error if limit would be exceeded

### Document Limits

- Enforced when uploading documents
- Checks both document count and total size
- Counts all documents across all workspaces in the subscription
- Returns error if either limit would be exceeded

### Agent Limits

- Enforced when creating a new agent
- Counts all agents across all workspaces in the subscription
- Returns error if limit would be exceeded

### Webhook Limits

- Enforced when creating a new webhook
- Counts all webhooks across all agents in the subscription
- Returns error if limit would be exceeded

### Channel Limits

- Enforced when creating a new output channel
- Counts all channels across all workspaces in the subscription
- Returns error if limit would be exceeded

### MCP Server Limits

- Enforced when creating a new MCP server
- Counts all MCP servers across all workspaces in the subscription
- Returns error if limit would be exceeded

### User Limits

- Enforced when adding a user to a workspace
- Counts all unique users across all workspaces in the subscription
- Returns error if limit would be exceeded

### Daily Request Limits

- Enforced when executing agents (test endpoint and webhook endpoint)
- Tracks LLM requests per subscription using a rolling 24-hour window
- If daily request limit is exceeded, agent execution is blocked
- Returns error message indicating request limit exceeded
- Limits reset automatically as requests age out of the 24-hour window

## Auto-Migration

### Existing Users

- When a user without a subscription accesses the system (e.g., creates a workspace), a free subscription is automatically created
- This handles migration of existing users who were created before subscriptions were introduced

### Existing Workspaces

- When a workspace without a `subscriptionId` is accessed, it is automatically associated with the user's subscription
- This handles migration of existing workspaces created before subscriptions were introduced

## Subscription Lifecycle

1. **Creation**: Free subscription created automatically when user first creates a workspace
2. **Association**: Workspaces are associated with subscriptions at creation time
3. **Management**: Managers can be added/removed (with restrictions)
4. **Expiration**: Free plans never expire (active indefinitely)
5. **Upgrade/Downgrade**: (Future feature - not yet implemented)

## API Endpoints

### Get Current User's Subscription

**GET `/api/subscription`**

Returns the current user's subscription details including plan, expiration, and list of managers with their emails.

**Response:**

```json
{
  "subscriptionId": "uuid",
  "plan": "free" | "starter" | "pro",
  "expiresAt": "2024-01-01T00:00:00Z" | null,
  "createdAt": "2024-01-01T00:00:00Z",
  "managers": [
    {
      "userId": "user-id",
      "email": "user@example.com" | null
    }
  ]
}
```

### Find User by Email

**GET `/api/users/by-email/:email`**

Finds a user by their email address. Used to validate that a user exists before adding them as a manager.

**Response:**

```json
{
  "userId": "user-id",
  "email": "user@example.com"
}
```

**Errors:**

- 404: User not found

## Error Messages

Common error messages users may encounter:

- **Workspace limit exceeded**: "Workspace limit exceeded. Maximum {N} workspace(s) allowed for {plan} plan."
- **Document count limit exceeded**: "Document count limit exceeded. Maximum {N} document(s) allowed for {plan} plan."
- **Document size limit exceeded**: "Document size limit exceeded. Maximum {N} MB total size allowed for {plan} plan."
- **Agent limit exceeded**: "Agent limit exceeded. Maximum {N} agent(s) allowed for {plan} plan."
- **Daily request limit exceeded**: "Daily request limit exceeded. Maximum {N} request(s) per 24 hours allowed for {plan} plan."
- **User limit exceeded**: "User limit exceeded. Maximum {N} user(s) allowed for {plan} plan."
- **Webhook limit exceeded**: "Webhook limit exceeded. Maximum {N} webhook(s) allowed for {plan} plan."
- **Channel limit exceeded**: "Channel limit exceeded. Maximum {N} channel(s) allowed for {plan} plan."
- **MCP server limit exceeded**: "MCP server limit exceeded. Maximum {N} MCP server(s) allowed for {plan} plan."
- **Cannot add manager**: "User already has a non-free subscription and cannot be added as a manager."
- **Manager limit reached**: "Free and starter plans can only have one manager. This subscription already has the maximum number of managers."
- **Cannot remove last manager**: "Cannot remove the last manager. A subscription must have at least one manager."

## Best Practices

1. **Plan Selection**: Choose a plan that matches your expected usage
2. **Manager Management**: Only add trusted users as managers
3. **Workspace Organization**: Organize workspaces within subscription limits
4. **Document Management**: Monitor document count and size to avoid hitting limits
5. **Daily Request Limits**: Monitor your daily request usage to avoid hitting limits, especially on free and starter plans
6. **Free Plan**: Free plans never expire and remain active indefinitely

## Technical Details

### Centralized Limits

All subscription limits (workspaces, documents, agents, managers, daily requests, users, webhooks, channels, and MCP servers) are defined in a single file: `apps/backend/src/utils/subscriptionPlans.ts`. This ensures consistency and makes it easy to update limits by modifying a single source of truth.

### Database Schema

- **Subscription table**: Stores subscription records with plan, expiration, and user ID
- **Workspace table**: Includes `subscriptionId` field to associate workspaces with subscriptions
- **Permission table**: Used to manage manager permissions (resourceType: "subscriptions")

### Indexes

- **byUserId GSI**: Allows querying subscriptions by user ID for efficient lookups

### Permission Model

- Subscriptions use the same permission system as workspaces
- Manager permissions are stored as OWNER level permissions on the subscription resource
- Resource type is "subscriptions" for subscription permissions
