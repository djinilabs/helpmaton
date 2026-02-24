# AGENTS.md

## Cursor Cloud specific instructions

### Architecture overview

Helpmaton is a monorepo (`apps/backend`, `apps/frontend`, `apps/widget`) using Node.js 20, pnpm 10, TypeScript, and the Architect Framework (AWS serverless). See `docs/development-setup.md` for full development guide.

### Running services

| Service | Command | Port | Notes |
|---|---|---|---|
| Backend (Architect Sandbox + local DynamoDB + s3rver) | `MAILGUN_KEY= pnpm dev:backend` | 3333 (HTTP), 6000 (DynamoDB), 4568 (S3) | s3rver is started automatically by the sandbox plugin |
| Frontend (Vite) | `pnpm dev:frontend` | 5173 | Proxies `/api` requests to backend on port 3333 |
| Both together | `pnpm dev` | 3333 + 5173 | Uses `scripts/dev-wrapper.mjs` |
| DynamoDB Admin (optional) | `pnpm dev:dbadmin` | 8000 | GUI for browsing local DynamoDB |

### Backend `.env` setup (critical gotchas)

The `.env` file at `apps/backend/.env` is read by Architect Sandbox. **Important caveats:**

- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` must be set (even to dummy values) or the DynamoDB adapter will throw "Region is missing" errors at auth time.
- `E2E_AUTH_GATE_BYPASS=true` must be set to allow new user registration in local dev without a gate token.
- If `MAILGUN_KEY` is set, magic link emails are sent via Mailgun. Unset it (or start the backend with `MAILGUN_KEY=`) to have magic link URLs logged to the console instead.
- `FRONTEND_URL` must be a valid URL pointing to the Vite dev server (port 5173). If it's missing or invalid, the auth redirect callback will throw "Invalid URL".
- The Architect sandbox inherits environment variables from the parent process. If secrets are injected as env vars (e.g. `MAILGUN_KEY`), they will override `.env` file values. To suppress a secret for local dev, explicitly unset it: `MAILGUN_KEY= pnpm dev:backend`.

### Local authentication flow

Authentication uses email-based magic links (NextAuth/Auth.js). In local dev:
1. Navigate to the frontend dev server (port 5173) and enter an email address.
2. If `MAILGUN_KEY` is unset, the magic link URL is printed to the backend console (look for `[sendEmail] Email contents:`).
3. Open the logged URL in the browser to complete authentication.
4. The token is single-use; request a new one if it fails.

### Lint, typecheck, test

Standard commands from `package.json`:
- `pnpm lint` — ESLint
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — Vitest unit tests (runs in `apps/backend`)
- `pnpm test:e2e` — Playwright E2E tests (requires `pnpm test:e2e:install` first)

### Known pre-existing test failures

12 unit tests in `src/utils/oauth/mcp/__tests__/{intercom,todoist,zendesk}.test.ts` fail due to hardcoded redirect URI expectations vs the local `FRONTEND_URL` value. These are not caused by environment setup.

### Build

- `pnpm build:frontend` — builds the frontend SPA
- `pnpm build:backend` — builds backend Lambda handlers for deployment

### Widget

`apps/widget` is an embeddable chat widget. Build with `pnpm build:widget`.
