# Tweet on new PR – X API setup

The GitHub workflow that tweets when a PR is opened uses **X API v2** (`POST /2/tweets`) with **OAuth 1.0a user context**, so it works on the **Free tier**. (The v1.1 `statuses/update` endpoint returns error 453 on Free tier.) The X Developer Portal only shows:

- **Consumer Key** (API Key)
- **Consumer Secret** (Secret Key)
- **Bearer Token**

The **Bearer Token** is for app-only (read-only) access and **cannot post tweets**. To post as the Helpmaton account you also need:

- **Access Token**
- **Access Token Secret**

These are **not** shown in the portal. You obtain them once by completing the **3-legged OAuth 1.0a flow** (PIN-based) while logged in as the Helpmaton account.

## Steps

### 1. App settings in X Developer Portal

- In your project, open the app → **Settings** → **User authentication set up** → **Set up** (or **Edit**).
- Choose **Read and write** (or at least **Post and read**) so the app can post tweets.
- **Callback URI**: For the PIN-based flow you can use `https://localhost` (or any URL; the script uses out-of-band PIN, but the portal may require a callback to be set).
- Save.

### 2. Get Consumer Key and Secret

- In the app, go to **Keys and tokens**.
- Copy the **Consumer Key** and **Consumer Secret** (create them if needed). You will use these in the script and later as `X_API_KEY` and `X_API_SECRET` in GitHub Secrets.
- **Bearer Token** is not needed for this workflow; ignore it for posting.

### 3. Run the one-time OAuth script

From the repo root, with Node 18+:

```bash
node scripts/x-oauth-get-user-tokens.mjs
```

The script will:

1. Ask for your **Consumer Key** and **Consumer Secret** (or read them from `X_API_KEY` and `X_API_SECRET` env vars).
2. Open (or show you) the X authorization URL. Log in as the **Helpmaton** account and authorize the app.
3. X will show a **7-digit PIN**. Enter it when the script asks.
4. The script will then print the **Access Token** and **Access Token Secret**. Use these as `X_ACCESS_TOKEN` and `X_ACCESS_TOKEN_SECRET` in GitHub.

Do not commit these values or paste them in code; they are equivalent to the Helpmaton account password for posting.

### 4. Add GitHub repository secrets

In the repo: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Add:

| Secret name             | Value                    |
|-------------------------|--------------------------|
| `X_API_KEY`             | Consumer Key             |
| `X_API_SECRET`          | Consumer Secret          |
| `X_ACCESS_TOKEN`        | Access Token from script |
| `X_ACCESS_TOKEN_SECRET` | Access Token Secret      |

After that, the **Tweet on new PR** workflow will be able to post when a non-draft PR targeting `main` is opened or reopened (unless the PR has a `no-tweet` label). The same secrets are used by the **Release** workflow to post a tweet when a new release is created (with truncated commit summaries and a link to the release notes).

## Troubleshooting

### 401 Unauthorized

The X API is rejecting the credentials. Check:

1. **All four secrets from the same app**  
   `X_API_KEY` / `X_API_SECRET` and `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` must all belong to the **same** app (and the Helpmaton user). If you recreated the app or regenerated any key, update all four values in GitHub together.

2. **No extra whitespace or newlines**  
   When pasting into GitHub Secrets, avoid leading/trailing spaces or a newline at the end. Copy only the value.

3. **Regenerate and re-add**  
   In the X Developer Portal → **Keys and tokens**, regenerate **Access Token and Secret**. Update **X_ACCESS_TOKEN** and **X_ACCESS_TOKEN_SECRET** in GitHub with the new values. Or run `node scripts/x-oauth-get-user-tokens.mjs` again and update those two secrets.

4. **App permissions**  
   The app must be **Read and write**. Tokens issued when the app was Read only will keep returning 401/403 until you get new tokens after switching to Read and write.

### 403 Forbidden

Usually means the app is read-only or the tokens were issued when it was read-only:

1. In the portal, set the app to **Read and write** and save.
2. Regenerate **Access Token and Secret** (or run the OAuth script again), then update **X_ACCESS_TOKEN** and **X_ACCESS_TOKEN_SECRET** in GitHub.
3. Re-run the workflow or open a new PR to test.
