# Authentication System

This document describes the authentication system in Helpmaton, including session-based authentication, JWT tokens, API keys, and OAuth providers.

## Overview

Helpmaton supports multiple authentication methods:

1. **Session-based** (Cookies): For web UI
2. **JWT Tokens**: For API access
3. **API Keys**: For programmatic access
4. **Magic Links**: Passwordless email authentication
5. **Passkeys (WebAuthn)**: Passwordless sign-in with device biometrics or security key
6. **OAuth**: Gmail and Outlook integration

## Session-Based Authentication

### How It Works

Session-based authentication uses HTTP cookies to maintain user sessions:

1. User logs in via magic link or OAuth
2. Backend creates a session cookie
3. Cookie is sent with subsequent requests
4. Backend validates cookie and extracts user info

### Session Storage

Sessions are stored in the `next-auth` table (DynamoDB):

- **Partition Key**: Session ID
- **TTL**: Automatic expiration
- **Encryption**: Encrypted at rest

### Session Lifecycle

1. **Creation**: Session created on login
2. **Validation**: Session validated on each request
3. **Refresh**: Session refreshed on activity
4. **Expiration**: Session expires after inactivity

### Usage

Sessions are automatically handled by NextAuth.js (Auth.js):

```typescript
// Backend automatically extracts session from cookies
const session = await requireSessionFromRequest(req);
const userId = session.user.id;
```

## JWT Token Authentication

### Access Tokens

Short-lived JWT tokens for API access:

- **Lifetime**: 1 hour (configurable)
- **Format**: JWT (JSON Web Token)
- **Signing**: HMAC SHA-256 with `AUTH_SECRET`

### Refresh Tokens

Long-lived tokens for refreshing access tokens:

- **Lifetime**: 30 days (configurable)
- **Storage**: `user-refresh-token` table (DynamoDB)
- **Encryption**: Hashed with scrypt

### Token Flow

```
User logs in
    │
    ▼
Backend generates:
  - Access token (JWT, 24 hours)
  - Refresh token (stored in DB, 30 days)
    │
    ▼
Client stores tokens
    │
    ▼
API requests include:
  Authorization: Bearer <access_token>
    │
    ▼
Backend validates JWT
    │
    ├─ Valid → Process request
    └─ Expired → Use refresh token
         │
         ▼
    Generate new access token
```

### Generating Tokens

**Endpoint**:

```
POST /api/user/tokens
```

**Request**: Requires session cookie or existing access token

**Response**:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "refresh_token_123",
  "expiresIn": 3600
}
```

### Refreshing Tokens

**Endpoint**:

```
POST /api/user/refresh
```

**Request Body**:

```json
{
  "refreshToken": "refresh_token_123"
}
```

**Response**:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": 3600
}
```

### Using Tokens

Include in `Authorization` header:

```bash
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \
  https://app.helpmaton.com/api/workspaces
```

### Token Validation

Backend validates tokens:

```typescript
// Verify JWT access token
const tokenPayload = await verifyAccessToken(bearerToken);
const userId = tokenPayload.userId;
```

## API Key Authentication

### User API Keys

User-level API keys for programmatic access:

- **Format**: `hmat_` prefix + random string
- **Storage**: `user-api-key` table (DynamoDB)
- **Security**: Hashed with scrypt, SHA256 for lookup

### Creating User API Keys

**Endpoint**:

```
POST /api/user/api-keys
```

**Request Body**:

```json
{
  "name": "My API Key"
}
```

**Response**:

```json
{
  "id": "key_123",
  "name": "My API Key",
  "keyPrefix": "hmat_abc...",
  "key": "hmat_abc123def456...", // Only shown once!
  "createdAt": "2024-01-01T00:00:00Z"
}
```

**Important**: The full key is only shown once. Store it securely.

### Using User API Keys

Include in `Authorization` header:

```bash
curl -H "Authorization: Bearer hmat_abc123def456..." \
  https://app.helpmaton.com/api/workspaces
```

### Key Validation

Backend validates keys:

1. Extract key from `Authorization` header
2. Compute SHA256 hash for lookup
3. Query `user-api-key` table via GSI
4. Verify key with scrypt
5. Update `lastUsedAt` timestamp

### Workspace API Keys

Workspace-level API keys for BYOK (Bring Your Own Key):

- **Purpose**: Use workspace's own LLM API key
- **Storage**: `workspace-api-key` table
- **Usage**: Automatically used when configured

## Magic Link Authentication

### How It Works

Passwordless authentication via email:

1. User enters email address
2. Backend generates secure token
3. Email sent with magic link
4. User clicks link
5. Backend validates token
6. Session created

### Requesting Magic Link

**Endpoint**:

```
POST /api/auth/signin/email
```

**Request Body**:

```json
{
  "email": "user@example.com"
}
```

**Response**:

```json
{
  "message": "Check your email for a magic link"
}
```

### Magic Link Format

```
https://app.helpmaton.com/api/auth/callback/email?token=secure_token_123
```

### Token Validation

- Tokens are single-use
- Tokens expire after 24 hours
- Tokens are cryptographically secure

## Passkey (WebAuthn) Authentication

### How It Works

Passwordless sign-in using WebAuthn:

1. **Registration (after login)**: User creates a passkey from Settings (Sign-in methods). Backend generates creation options, browser creates credential, backend verifies and stores it in the `next-auth` table (DynamoDB).
2. **Login**: User clicks "Sign in with passkey" on the login page. Backend returns authentication options (challenge stored in signed cookie). Browser prompts for authenticator; backend verifies assertion, looks up user by credential ID, issues a short-lived one-time JWT. Frontend calls Auth.js Credentials provider with that token to establish the same session as magic link.

### Registration Flow

**Endpoints** (require session):

- `POST /api/user/passkey/register/options` – Returns WebAuthn creation options and sets challenge cookie.
- `POST /api/user/passkey/register/verify` – Body: credential (RegistrationResponseJSON). Verifies and stores passkey; returns `{ verified: true }`.

### Login Flow

**Endpoints** (no auth):

- `GET /api/user/passkey/login/options` – Returns WebAuthn request options and sets challenge cookie.
- `POST /api/user/passkey/login/verify` – Body: assertion (AuthenticationResponseJSON). Verifies assertion, updates counter, returns `{ token }` (one-time JWT for Auth.js).

Frontend then calls `signIn("passkey", { token, callbackUrl, redirect: false })`; Auth.js Credentials provider verifies the token and creates the same session as email sign-in.

### Data and Security

- **Storage**: Passkeys stored in the `next-auth` table (pk=USER#userId, sk=PASSKEY#credentialId). GSI `byCredentialId` (gsi2pk/gsi2sk) for login lookup (no table scans).
- **Challenges**: Register challenge bound to session; login challenge in signed HTTP-only cookie. Verified once and discarded.
- **Origin/rpId**: Set from backend config (e.g. `FRONTEND_URL`); verification rejects wrong origin.

## OAuth Authentication

### Supported Providers

- **Gmail**: Google OAuth 2.0
- **Outlook**: Microsoft Azure AD OAuth 2.0

### Gmail OAuth

**Configuration**:

1. Create OAuth client in Google Cloud Console
2. Set redirect URI: `{BASE_URL}/api/auth/callback/google`
3. Configure `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`

**Flow**:

```
User clicks "Sign in with Google"
    │
    ▼
Redirect to Google OAuth
    │
    ▼
User authorizes
    │
    ▼
Google redirects to callback
    │
    ▼
Backend exchanges code for tokens
    │
    ▼
Create/update user account
    │
    ▼
Create session
    │
    ▼
Redirect to frontend
```

### Outlook OAuth

**Configuration**:

1. Create app registration in Azure Portal
2. Set redirect URI: `{BASE_URL}/api/auth/callback/outlook`
3. Configure `OUTLOOK_CLIENT_ID` and `OUTLOOK_CLIENT_SECRET`

**Flow**: Similar to Gmail OAuth

## Authentication Middleware

### Require Authentication

Middleware to require authentication:

```typescript
// Require Bearer token (JWT or API key)
export const requireAuth = async (req, res, next) => {
  const bearerToken = extractBearerToken(req);
  if (!bearerToken) {
    throw unauthorized("Bearer token required");
  }

  // Try JWT first, fall back to API key
  const tokenPayload = await verifyAccessToken(bearerToken);
  req.userRef = userRef(tokenPayload.userId);
  next();
};
```

### Require Session

Middleware to require session cookie:

```typescript
// Require session cookie
export const requireSession = async (req, res, next) => {
  const session = await requireSessionFromRequest(req);
  if (!session.user?.id) {
    throw unauthorized();
  }
  req.session = session;
  req.userRef = userRef(session.user.id);
  next();
};
```

### Require Auth or Session

Middleware that accepts either:

```typescript
// Accept Bearer token OR session cookie
export const requireAuthOrSession = async (req, res, next) => {
  // Try Bearer token first
  const bearerToken = extractBearerToken(req);
  if (bearerToken) {
    try {
      const tokenPayload = await verifyAccessToken(bearerToken);
      req.userRef = userRef(tokenPayload.userId);
      return next();
    } catch {
      // Fall through to session
    }
  }

  // Fall back to session
  const session = await requireSessionFromRequest(req);
  req.session = session;
  req.userRef = userRef(session.user.id);
  next();
};
```

## Security

### Token Security

- **JWT Signing**: HMAC SHA-256 with secret key
- **API Key Hashing**: scrypt with salt
- **Token Storage**: Never store tokens in localStorage (use httpOnly cookies or secure storage)
- **Token Rotation**: Refresh tokens can be rotated

### Key Security

- **Hashing**: API keys are hashed with scrypt
- **Lookup**: SHA256 hash for fast lookup (not for validation)
- **Storage**: Keys encrypted at rest in DynamoDB
- **Rotation**: Keys can be deleted and recreated

### Session Security

- **HttpOnly Cookies**: Prevents XSS attacks
- **Secure Cookies**: HTTPS only in production
- **SameSite**: CSRF protection
- **Expiration**: Automatic expiration

## Best Practices

### For Users

1. **Store tokens securely**: Use secure storage, never commit to version control
2. **Rotate keys regularly**: Delete and recreate API keys periodically
3. **Use different keys**: Use different keys for different applications
4. **Monitor usage**: Check `lastUsedAt` timestamps

### For Developers

1. **Validate tokens**: Always validate tokens on the backend
2. **Handle expiration**: Implement token refresh logic
3. **Error handling**: Return clear error messages
4. **Rate limiting**: Implement rate limiting for auth endpoints

## API Reference

### Authentication Endpoints

- `POST /api/auth/signin/email` - Request magic link
- `GET /api/auth/callback/email` - Magic link callback
- `GET /api/auth/callback/google` - Google OAuth callback
- `GET /api/auth/callback/outlook` - Outlook OAuth callback
- `POST /api/user/passkey/register/options` - Passkey registration options (session required)
- `POST /api/user/passkey/register/verify` - Passkey registration verify (session required)
- `GET /api/user/passkey/login/options` - Passkey login options (no auth)
- `POST /api/user/passkey/login/verify` - Passkey login verify, returns one-time token (no auth)
- `POST /api/user/tokens` - Generate access/refresh tokens
- `POST /api/user/refresh` - Refresh access token
- `POST /api/user/api-keys` - Create user API key
- `GET /api/user/api-keys` - List user API keys
- `DELETE /api/user/api-keys/:keyId` - Delete user API key

See [API Reference](./api-reference.md) for complete documentation.

## Troubleshooting

### Token Validation Fails

- Check `AUTH_SECRET` is set correctly
- Verify token hasn't expired
- Ensure token format is correct (Bearer token)

### Session Not Persisting

- Check cookies are enabled
- Verify `AUTH_SECRET` is set
- Check cookie domain/path settings
- Clear browser cookies and try again

### API Key Not Working

- Verify key format is correct
- Check key hasn't been deleted
- Ensure key is included in `Authorization` header
- Verify key belongs to correct user

### OAuth Not Working

- Check OAuth credentials are configured
- Verify redirect URIs match exactly
- Check OAuth consent screen is configured
- Review OAuth provider logs
