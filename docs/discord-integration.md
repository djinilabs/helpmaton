# Discord Bot Integration

This guide explains how to connect your Helpmaton agents to Discord bots, allowing community members to interact with your agents directly in Discord.

## Overview

The Discord integration allows you to deploy a Discord bot that connects to one of your Helpmaton agents. Users can interact with the bot using slash commands or by mentioning it in messages.

## Setup Process

### Step 1: Create Discord Application

1. Go to https://discord.com/developers/applications
2. Click "New Application"
3. Give it a name and click "Create"

### Step 2: Create Bot

1. Go to the "Bot" section in your Discord application
2. Click "Add Bot"
3. Copy the "Bot Token" (keep this secure)
4. Under "Privileged Gateway Intents", enable "Message Content Intent" if you want the bot to read messages

### Step 3: Get Credentials

1. In "General Information", copy the "Application ID"
2. In "General Information" → "Public Key", copy the Public Key (64 hex characters)
3. Keep the Bot Token from Step 2

### Step 4: Create Integration in Helpmaton

1. Navigate to the Integrations page in your workspace
2. Click "Connect Discord"
3. Fill in:
   - Select the agent to connect
   - Integration name (e.g., "Community Bot")
   - Bot Token
   - Public Key (64 hex characters)
   - Application ID (optional but recommended)
4. Click "Create Integration"

### Step 5: Configure Interactions Endpoint

1. Copy the webhook URL shown after creating the integration
2. In Discord app settings, go to "General Information"
3. Scroll to "Interactions Endpoint URL"
4. Paste the webhook URL
5. Click "Save Changes"
6. Discord will verify the endpoint (you should see a checkmark)

### Step 6: Invite Bot to Server

1. Go to "OAuth2" → "URL Generator"
2. Select scopes: `bot` and `applications.commands`
3. Select bot permissions: `Send Messages`, `Read Message History`
4. Copy the generated URL
5. Open the URL in a browser and select your server
6. Authorize the bot

## How It Works

- **Interactions**: Discord sends interaction events (slash commands, mentions) to your webhook endpoint
- **Signature Verification**: All requests are verified using Ed25519 signature with your public key
- **Agent Execution**: Commands are forwarded to your agent, which generates responses
- **Throttled Updates**: Responses are updated in Discord every 1.5 seconds to simulate streaming

## Supported Interactions

- **Slash Commands**: Create custom slash commands (e.g., `/ask`)
- **Message Mentions**: When users mention your bot
- **Direct Messages**: Messages sent directly to the bot

## Message Formatting

The bot automatically converts markdown to Discord formatting:
- `**bold**` → `**bold**`
- `` `code` `` → `` `code` ``
- `[link](url)` → `[link](url)` (Discord supports markdown links)

## Rate Limits

Discord has rate limits of approximately 5 requests per second. The integration handles this by throttling message updates to every 1.5 seconds.

## Creating Slash Commands

To create custom slash commands:

1. Go to "Slash Commands" in your Discord app settings
2. Click "New Command"
3. Configure the command (name, description, options)
4. The command will be available after the bot is invited with `applications.commands` scope

## Troubleshooting

### Bot Not Responding

1. Check that the integration status is "active"
2. Verify the bot is invited to your Discord server
3. Check that the Interactions Endpoint URL is set and verified
4. Verify bot has necessary permissions in the server

### Signature Verification Failed

- Ensure the public key in Helpmaton matches the one in Discord
- Check that the webhook URL in Discord matches the one shown in Helpmaton
- Verify the public key is exactly 64 hex characters

### Interactions Endpoint Not Verifying

- Ensure the webhook handler is deployed and accessible
- Check that the endpoint returns `{ type: 1 }` for PING requests
- Verify the signature verification is working correctly

### Bot Missing Permissions

- Re-invite the bot with correct permissions
- Check server settings for bot role permissions
- Ensure bot has "Send Messages" and "Read Message History" permissions

