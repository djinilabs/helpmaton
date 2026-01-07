# Slack Bot Integration

This guide explains how to connect your Helpmaton agents to Slack bots, allowing team members to interact with your agents directly in Slack.

## Overview

The Slack integration allows you to deploy a Slack bot that connects to one of your Helpmaton agents. When users mention the bot or send it messages in Slack, the bot will respond using your agent's configuration and knowledge base.

## Setup Process

### Step 1: Generate Slack App Manifest

1. Navigate to the Integrations page in your workspace
2. Click "Connect Slack"
3. Select the agent you want to connect
4. Click "Generate Manifest"
5. Copy the generated manifest JSON

### Step 2: Create Slack App

1. Go to <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer">https://api.slack.com/apps</a>
2. Click "Create New App" → "From Manifest"
3. Paste the manifest JSON you copied
4. Click "Create"

### Step 3: Install Bot to Workspace

**Important**: You must install the app to your workspace before you can get the Bot User OAuth Token.

1. In your Slack app settings, go to "Install App" (in the left sidebar)
2. Click "Install to Workspace"
3. Authorize the bot with the requested permissions
4. After installation, you'll be redirected back to the app settings

### Step 4: Get Credentials

After installing the app, you can now get the required credentials:

1. **Bot User OAuth Token**:
   - Go to "OAuth & Permissions" in your Slack app settings
   - Scroll down to "Bot User OAuth Token"
   - Click "Copy" to copy the token (it starts with `xoxb-`)
   - **Note**: If you don't see this token, make sure you've completed Step 3 (Install Bot to Workspace)

2. **Signing Secret**:
   - Go to "Basic Information" → "App Credentials"
   - Find "Signing Secret" and click "Show" or "Copy"
   - Copy the signing secret

### Step 5: Complete Integration

1. Return to the Helpmaton Integrations page
2. Click "Continue to Credentials"
3. Enter:
   - Integration name (e.g., "Support Bot")
   - Bot User OAuth Token (from Step 4)
   - Signing Secret (from Step 4)
4. Click "Create Integration"

## How It Works

- **Event Subscriptions**: The bot listens for `app_mentions` and `message` events
- **Webhook URL**: Slack sends events to your Helpmaton webhook endpoint
- **Signature Verification**: All requests are verified using the signing secret
- **Agent Execution**: Messages are forwarded to your agent, which generates responses
- **Throttled Updates**: Responses are updated in Slack every 1.5 seconds to simulate streaming

## Supported Events

- **App Mentions**: When users mention your bot with `@botname`
- **Direct Messages**: Messages sent directly to the bot
- **Channel Messages**: Messages in channels where the bot is a member

## Message Formatting

The bot automatically converts markdown to Slack formatting:
- `**bold**` → `*bold*`
- `` `code` `` → `` `code` ``
- `[link](url)` → `<url|link>`

## Rate Limits

Slack has rate limits of approximately 1 request per second per channel. The integration handles this by throttling message updates to every 1.5 seconds.

## Troubleshooting

### Bot Not Responding

1. Check that the integration status is "active"
2. Verify the bot is installed in your Slack workspace
3. Check that event subscriptions are enabled in Slack app settings
4. Verify the webhook URL is correct in Slack app settings

### Signature Verification Failed

- Ensure the signing secret in Helpmaton matches the one in Slack
- Check that the webhook URL in Slack matches the one shown in Helpmaton

### Messages Not Appearing

- Check bot permissions in Slack
- Verify the bot is a member of the channel (for channel messages)
- Check Slack app logs for errors

