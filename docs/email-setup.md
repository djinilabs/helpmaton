# Email Connection Setup Guide

This guide explains how to set up email connections for sending emails from your LLM agents.

## Overview

Helpmaton supports three types of email connections:

- **Gmail (OAuth2)** - Recommended for Gmail users (90% of market)
- **Outlook (OAuth2)** - Recommended for Outlook/Office 365 users
- **SMTP** - For other email providers (Yahoo, Zoho, custom domains, etc.)

**Important**: Each workspace can have only one email connection configured.

## Gmail OAuth Setup

Gmail OAuth2 is the recommended method for Gmail users as it's more secure and doesn't require app passwords.

### Step 1: Create Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com)
2. Click **"Select a project"** → **"New Project"**
3. Enter a project name (e.g., "Helpmaton Email")
4. Click **"Create"**
5. Wait for the project to be created and select it

### Step 2: Enable Gmail API

1. In your Google Cloud project, go to **"APIs & Services"** → **"Library"**
2. Search for **"Gmail API"**
3. Click on **"Gmail API"**
4. Click **"Enable"**

### Step 3: Configure OAuth Consent Screen

1. Go to **"APIs & Services"** → **"OAuth consent screen"**
2. Select **"External"** (unless you have a Google Workspace account)
3. Click **"Create"**
4. Fill in the required information:
   - **App name**: Helpmaton (or your preferred name)
   - **User support email**: Your email address
   - **Developer contact information**: Your email address
5. Click **"Save and Continue"**
6. On the **"Scopes"** page, click **"Add or Remove Scopes"**
7. Search for and add: `https://www.googleapis.com/auth/gmail.send`
8. Click **"Update"** → **"Save and Continue"**
9. Add test users if your app is in testing mode (add your own email)
10. Click **"Save and Continue"** → **"Back to Dashboard"**

### Step 4: Create OAuth 2.0 Credentials

1. Go to **"APIs & Services"** → **"Credentials"**
2. Click **"Create Credentials"** → **"OAuth client ID"**
3. Select **"Web application"** as the application type
4. Enter a name (e.g., "Helpmaton Gmail OAuth")
5. Under **"Authorized redirect URIs"**, add:
   ```
   https://your-domain.com/api/email/oauth/gmail/callback
   ```
   Replace `your-domain.com` with your actual domain. For local development:
   - If your frontend proxies the backend (common setup), use your frontend URL:
     ```
     http://localhost:5173/api/email/oauth/gmail/callback
     ```
   - If accessing the backend directly, use your backend URL:
     ```
     http://localhost:3333/api/email/oauth/gmail/callback
     ```
     **Important**:
   - This is a fixed redirect URI. The workspace ID is encoded in the OAuth state parameter, not in the URL path.
   - The redirect URI must match **exactly** what you configure here, including the protocol (http/https) and port.
   - The `OAUTH_REDIRECT_BASE_URL` environment variable must be set to the same base URL (e.g., `http://localhost:5173` for frontend proxy, or `http://localhost:3333` for direct backend access).
6. Click **"Create"**
7. Copy the **Client ID** and **Client secret**
8. Add these to your environment variables:
   - `GMAIL_CLIENT_ID` = Your Client ID
   - `GMAIL_CLIENT_SECRET` = Your Client secret
   - `OAUTH_REDIRECT_BASE_URL` = Your base URL where OAuth will redirect to:
     - For production: `https://your-domain.com`
     - For local development with frontend proxy: `http://localhost:5173` (or your frontend port)
     - For local development with direct backend: `http://localhost:3333` (or your backend port)
     - **Important**: This must match the base URL of the redirect URI you registered in Google Cloud Console

### Step 5: Configure Gmail Connection in Helpmaton

1. Go to your workspace in Helpmaton
2. Navigate to the **Email Connection** section
3. Click **"CREATE"** or **"EDIT"**
4. Select **"Gmail (OAuth2)"** as the provider
5. Enter a name for the connection (e.g., "My Gmail Account")
6. Click **"CONNECT GMAIL"**
7. You will be redirected to Google to authorize the connection
8. Select your Google account and click **"Allow"**
9. You will be redirected back to Helpmaton with the connection configured

## Outlook OAuth Setup

Outlook OAuth2 is the recommended method for Outlook/Office 365 users.

### Step 1: Create Azure AD App Registration

1. Go to the [Azure Portal](https://portal.azure.com)
2. Navigate to **"Azure Active Directory"** → **"App registrations"**
3. Click **"New registration"**
4. Fill in the form:
   - **Name**: Helpmaton (or your preferred name)
   - **Supported account types**: Select based on your needs (usually "Accounts in any organizational directory and personal Microsoft accounts")
   - **Redirect URI**:
     - Platform: **Web**
     - URI: `https://your-domain.com/api/email/oauth/outlook/callback`
       Replace `your-domain.com` with your actual domain. For local development:
     - If your frontend proxies the backend (common setup), use your frontend URL:
       ```
       http://localhost:5173/api/email/oauth/outlook/callback
       ```
     - If accessing the backend directly, use your backend URL:
       `   http://localhost:3333/api/email/oauth/outlook/callback`
       **Important**:
   - This is a fixed redirect URI. The workspace ID is encoded in the OAuth state parameter, not in the URL path.
   - The redirect URI must match **exactly** what you configure here, including the protocol (http/https) and port.
   - The `OAUTH_REDIRECT_BASE_URL` environment variable must be set to the same base URL (e.g., `http://localhost:5173` for frontend proxy, or `http://localhost:3333` for direct backend access).
5. Click **"Register"**

### Step 2: Configure API Permissions

1. In your app registration, go to **"API permissions"**
2. Click **"Add a permission"**
3. Select **"Microsoft Graph"**
4. Select **"Delegated permissions"**
5. Search for and add: `Mail.Send`
6. Search for and add: `offline_access` (required for refresh tokens)
7. Click **"Add permissions"**
8. Click **"Grant admin consent"** if you're an admin (or request admin consent)

### Step 3: Create Client Secret

1. In your app registration, go to **"Certificates & secrets"**
2. Click **"New client secret"**
3. Enter a description (e.g., "Helpmaton Outlook OAuth")
4. Select an expiration period
5. Click **"Add"**
6. **Important**: Copy the secret value immediately (it's only shown once)
7. Save it securely

### Step 4: Get Application (Client) ID

1. In your app registration, go to **"Overview"**
2. Copy the **Application (client) ID**

### Step 5: Configure Environment Variables

Add these to your environment variables:

- `OUTLOOK_CLIENT_ID` = Your Application (client) ID
- `OUTLOOK_CLIENT_SECRET` = Your client secret value
- `OAUTH_REDIRECT_BASE_URL` = Your base URL where OAuth will redirect to:
  - For production: `https://your-domain.com`
  - For local development with frontend proxy: `http://localhost:5173` (or your frontend port)
  - For local development with direct backend: `http://localhost:3333` (or your backend port)
  - **Important**: This must match the base URL of the redirect URI you registered in Azure Portal

### Step 6: Configure Outlook Connection in Helpmaton

1. Go to your workspace in Helpmaton
2. Navigate to the **Email Connection** section
3. Click **"CREATE"** or **"EDIT"**
4. Select **"Outlook (OAuth2)"** as the provider
5. Enter a name for the connection (e.g., "My Outlook Account")
6. Click **"CONNECT OUTLOOK"**
7. You will be redirected to Microsoft to authorize the connection
8. Sign in with your Microsoft account and click **"Accept"**
9. You will be redirected back to Helpmaton with the connection configured

**Note**: If you get an error about "No refresh_token received", this usually means the app was already authorized. To fix this:

1. Go to [Microsoft Account Privacy](https://account.microsoft.com/privacy/apps)
2. Find your app in the list and click **"Remove"** or **"Revoke"**
3. Try connecting again in Helpmaton

## SMTP Setup

Use SMTP for email providers that don't support OAuth2, such as Yahoo, Zoho, or custom domain email servers.

### When to Use SMTP

- You're using Yahoo Mail
- You're using Zoho Mail
- You're using a custom domain email server
- You prefer using SMTP credentials over OAuth2

### Step 1: Get SMTP Settings

Common SMTP settings for popular providers:

#### Gmail (SMTP - requires App Password)

- **Host**: `smtp.gmail.com`
- **Port**: `587` (TLS) or `465` (SSL)
- **Secure**: `true`
- **Username**: Your Gmail address
- **Password**: App Password (see Step 2)
- **From Email**: Your Gmail address

#### Outlook/Office 365 (SMTP - requires App Password)

- **Host**: `smtp.office365.com`
- **Port**: `587` (TLS)
- **Secure**: `true`
- **Username**: Your Outlook/Office 365 email
- **Password**: App Password (see Step 2)
- **From Email**: Your Outlook/Office 365 email

#### Yahoo Mail

- **Host**: `smtp.mail.yahoo.com`
- **Port**: `587` (TLS) or `465` (SSL)
- **Secure**: `true`
- **Username**: Your Yahoo email
- **Password**: App Password (see Step 2)
- **From Email**: Your Yahoo email

#### Zoho Mail

- **Host**: `smtp.zoho.com` (or `smtp.zoho.eu` for EU)
- **Port**: `587` (TLS) or `465` (SSL)
- **Secure**: `true`
- **Username**: Your Zoho email
- **Password**: Your Zoho password or App Password
- **From Email**: Your Zoho email

### Step 2: Generate App Password (for 2FA accounts)

If you have 2FA enabled on your email account, you'll need to generate an App Password instead of using your regular password.

#### Gmail App Password

1. Go to your [Google Account](https://myaccount.google.com)
2. Go to **"Security"**
3. Under **"How you sign in to Google"**, enable **"2-Step Verification"** if not already enabled
4. Go to **"App passwords"** (you may need to search for it)
5. Select **"Mail"** and **"Other (Custom name)"**
6. Enter a name (e.g., "Helpmaton")
7. Click **"Generate"**
8. Copy the 16-character password (spaces don't matter)
9. Use this password in the SMTP configuration

#### Outlook/Office 365 App Password

1. Go to your [Microsoft Account Security](https://account.microsoft.com/security)
2. Go to **"Security"** → **"Advanced security options"**
3. Under **"App passwords"**, click **"Create a new app password"**
4. Enter a name (e.g., "Helpmaton")
5. Click **"Generate"**
6. Copy the password
7. Use this password in the SMTP configuration

#### Yahoo App Password

1. Go to your [Yahoo Account Security](https://login.yahoo.com/account/security)
2. Enable **"Two-step verification"** if not already enabled
3. Go to **"App passwords"**
4. Select **"Mail"** and enter a name (e.g., "Helpmaton")
5. Click **"Generate"**
6. Copy the password
7. Use this password in the SMTP configuration

### Step 3: Configure SMTP Connection in Helpmaton

1. Go to your workspace in Helpmaton
2. Navigate to the **Email Connection** section
3. Click **"CREATE"** or **"EDIT"**
4. Select **"SMTP"** as the provider
5. Fill in the form:
   - **Name**: Give it a descriptive name (e.g., "My SMTP Connection")
   - **SMTP Host**: Your SMTP server hostname (e.g., `smtp.gmail.com`)
   - **SMTP Port**: Your SMTP port (usually `587` for TLS or `465` for SSL)
   - **Use Secure Connection**: Check this box for TLS/SSL
   - **Username**: Your email address
   - **Password**: Your password or App Password
   - **From Email**: The email address to send from
6. Click **"CREATE"** or **"SAVE"**

### Step 4: Test Your Connection

1. After creating the connection, click **"SEND TEST EMAIL"**
2. A test email will be sent to your account email address
3. Check your inbox to verify the email was received
4. If the test fails, check your SMTP settings and credentials

## Using Email in Agents

Once an email connection is configured for your workspace, all agents in that workspace will have access to the `send_email` tool.

### Agent Tool Usage

The `send_email` tool accepts the following parameters:

- **to** (required): Recipient email address
- **subject** (required): Email subject line
- **text** (required): Plain text email body
- **html** (optional): HTML email body (if provided, this will be used instead of text)
- **from** (optional): Sender email address (defaults to the connection's configured sender)

### Example Agent Prompts

- "Send an email to john@example.com with subject 'Meeting Reminder' and body 'Don't forget about our meeting tomorrow at 2 PM.'"
- "Email sarah@example.com about the project update"
- "Send a thank you email to client@example.com"

## Troubleshooting

### OAuth Errors

#### "Invalid redirect URI" or "redirect_uri_mismatch"

**Step-by-step debugging:**

1. **Check what redirect URI is being sent**:

   - Look at the error message - it shows the exact redirect URI being sent (e.g., `redirect_uri=http://localhost:5173/api/email/oauth/gmail/callback`)
   - Check your backend logs - the code logs the redirect URI being used: `[Gmail OAuth] Redirect URI: ...`

2. **Verify Google Cloud Console configuration**:

   - Go to [Google Cloud Console](https://console.cloud.google.com) → Your Project → APIs & Services → Credentials
   - Click on your OAuth 2.0 Client ID
   - Under "Authorized redirect URIs", verify the exact URI is listed:
     - For local development: `http://localhost:5173/api/email/oauth/gmail/callback`
     - For production: `https://your-domain.com/api/email/oauth/gmail/callback`
   - **Critical checks**:
     - No trailing slash (should NOT end with `/`)
     - Exact protocol match (`http://` vs `https://`)
     - Exact port number match
     - Exact path match (`/api/email/oauth/gmail/callback`)
   - If the URI is there but still failing:
     - Remove it, save, then add it back and save again
     - Make sure you're editing the correct OAuth client (check the Client ID matches your `GMAIL_CLIENT_ID` env var)
     - Wait a few minutes for Google's systems to update

3. **Verify environment variable**:

   - Check that `OAUTH_REDIRECT_BASE_URL` is set correctly:
     - For local development with frontend proxy: `http://localhost:5173` (no trailing slash)
     - For local development with direct backend: `http://localhost:3333` (no trailing slash)
     - For production: `https://your-domain.com` (no trailing slash)
   - Restart your backend server after changing this variable
   - The full redirect URI will be: `{OAUTH_REDIRECT_BASE_URL}/api/email/oauth/gmail/callback`

4. **Common issues**:

   - **Trailing slash**: Google is very strict - `http://localhost:5173/api/email/oauth/gmail/callback/` (with trailing slash) is different from `http://localhost:5173/api/email/oauth/gmail/callback` (without)
   - **Wrong OAuth client**: Make sure you're using the Client ID that matches the redirect URI configuration
   - **Multiple redirect URIs**: If you have multiple URIs registered, make sure the one being sent matches one of them exactly
   - **Caching**: Google may cache redirect URI configurations - try removing and re-adding the URI

5. **For Outlook/Microsoft**:
   - Same principles apply - check Azure Portal → App registrations → Your app → Authentication
   - Verify the redirect URI matches exactly (no trailing slash, correct protocol/port)

#### "Access denied" or "User cancelled"

- The user may have cancelled the OAuth flow
- Try the connection process again
- Make sure you're signing in with the correct account

#### "No refresh_token received" (Outlook)

- This usually happens if the app was already authorized before
- **Solution**: Revoke the app's access and try again:
  1. Go to [Microsoft Account Privacy](https://account.microsoft.com/privacy/apps)
  2. Find your app in the list and click **"Remove"** or **"Revoke"**
  3. Try connecting again in Helpmaton
- Make sure `offline_access` permission is added in Azure Portal (see Step 2)
- Ensure `prompt=consent` is used in the OAuth flow (this is handled automatically)

#### "Token refresh failed"

- The refresh token may have been revoked
- Reconnect the email account through the Helpmaton UI
- Check that the OAuth app is still active and not deleted

### SMTP Connection Errors

#### "Connection timeout"

- Check that the SMTP host and port are correct
- Verify your firewall isn't blocking the connection
- Try a different port (587 vs 465)

#### "Authentication failed"

- Verify your username and password are correct
- If you have 2FA enabled, make sure you're using an App Password, not your regular password
- Check that your account allows "less secure app access" if required (not recommended)

#### "Invalid credentials"

- Double-check your username (usually your full email address)
- Verify the password doesn't have extra spaces
- For Gmail, ensure you're using an App Password if 2FA is enabled

### Email Sending Errors

#### "Failed to send email"

- Check that the email connection is still valid
- For OAuth connections, tokens may have expired - they should refresh automatically
- Verify the "to" email address is valid
- Check that your email account hasn't been suspended or restricted

#### "Token expired"

- OAuth tokens should refresh automatically
- If refresh fails, reconnect the email account
- Check that the OAuth app credentials are still valid

### General Issues

#### "No email connection found"

- Make sure you've created an email connection for the workspace
- Verify you're in the correct workspace
- Check that you have WRITE permissions on the workspace

#### Connection appears but emails fail

- Test the connection using the "SEND TEST EMAIL" button
- Check the error message for specific details
- Verify your email account is active and not restricted

## Security Best Practices

1. **Use OAuth2 when possible** - More secure than SMTP passwords
2. **Never share credentials** - Treat OAuth secrets and SMTP passwords like passwords
3. **Use App Passwords for 2FA** - Never disable 2FA to use SMTP
4. **Rotate credentials regularly** - Periodically regenerate OAuth secrets and App Passwords
5. **Limit permissions** - OAuth scopes are limited to sending emails only
6. **Monitor email activity** - Check your email account logs if emails stop working
7. **Use separate connections per workspace** - Don't reuse the same email account across multiple workspaces if possible

## Additional Resources

- [Google Gmail API Documentation](https://developers.google.com/gmail/api)
- [Microsoft Graph Mail API Documentation](https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview)
- [Nodemailer Documentation](https://nodemailer.com/about/) (for SMTP)
- [Google OAuth 2.0 Guide](https://developers.google.com/identity/protocols/oauth2)
- [Microsoft Identity Platform Documentation](https://learn.microsoft.com/en-us/azure/active-directory/develop/)
