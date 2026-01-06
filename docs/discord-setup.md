# Discord Bot Setup Guide

This guide explains how to set up a Discord bot for sending notifications from your LLM agents.

## Overview

To enable Discord notifications, you need to:
1. Create a Discord application and bot
2. Get the bot token
3. Invite the bot to your Discord server
4. Find the Discord channel ID
5. Configure the channel in your workspace

## Step 1: Create a Discord Application

1. Go to the <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer">Discord Developer Portal</a>
2. Click **"New Application"**
3. Give your application a name (e.g., "Helpmaton Notifications")
4. Click **"Create"**

## Step 2: Create a Bot

1. In your application, go to the **"Bot"** section in the left sidebar
2. Click **"Add Bot"** and confirm
3. Under **"Token"**, click **"Reset Token"** or **"Copy"** to get your bot token
   - **Important**: Save this token securely. You'll need it when configuring the channel in Helpmaton.
   - The token will look like: `MTIzNDU2Nzg5MDEyMzQ1Njc4OTA.Xxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

## Step 3: Configure Bot Permissions

1. Still in the **"Bot"** section, scroll down to **"Privileged Gateway Intents"**
   - For basic message sending, you typically don't need any privileged intents

## Step 4: Invite Bot to Your Server

1. Go to the **"OAuth2"** section in the left sidebar (under "Settings")
2. Click on **"URL Generator"** (or find it in the OAuth2 section)
3. Under **"Scopes"**, select:
   - `bot`
4. Under **"Bot Permissions"**, select:
   - `Send Messages`
   - `View Channels` (required to see channels)
5. Copy the generated URL at the bottom of the page
6. Open the generated URL in your browser
7. Select the Discord server where you want to add the bot
8. Click **"Authorize"**
9. Complete any CAPTCHA if prompted

**Alternative method (if URL Generator is not available):**
- You can manually construct the invite URL using this format:
  ```
  https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=2048&scope=bot
  ```
  Replace `YOUR_CLIENT_ID` with your Application ID (found in the "General Information" section). The `permissions=2048` grants "Send Messages" permission.

## Step 5: Find the Discord Channel ID

You need the ID of the Discord channel where notifications should be sent.

### Method 1: Using Discord Developer Mode

1. Open Discord and go to **User Settings** (gear icon)
2. Go to **Advanced** → Enable **Developer Mode**
3. Right-click on the channel where you want notifications
4. Click **"Copy ID"**
5. The channel ID is a long number (e.g., `123456789012345678`)

### Method 2: Using Discord Web/Desktop

1. Make sure Developer Mode is enabled (see Method 1)
2. Right-click the channel in the channel list
3. Select **"Copy ID"**

## Step 6: Configure Channel in Helpmaton

1. Go to your workspace in Helpmaton
2. Navigate to the **Channels** section
3. Click **"Add Channel"** or **"Create Channel"**
4. Fill in the form:
   - **Type**: Select "Discord"
   - **Name**: Give it a descriptive name (e.g., "Production Alerts")
   - **Discord Channel ID**: Paste the channel ID from Step 5
   - **Bot Token**: Paste the bot token from Step 2
5. Click **"Create"**

## Step 7: Configure Agent to Use Channel

1. Go to your agent configuration
2. In the **Notification Channel** dropdown, select the channel you just created
3. Save the agent

## Testing

Once configured, your agent will have access to the `send_notification` tool. When the agent calls this tool, messages will be sent to the configured Discord channel from your bot.

## Troubleshooting

### Bot Token Invalid

- Make sure you copied the full token (it's very long)
- Check that you haven't accidentally added extra spaces
- If the token was exposed, reset it in the Discord Developer Portal

### Bot Can't Send Messages

- Verify the bot has the "Send Messages" permission in the channel
- Check that the bot is actually in the server
- Ensure the channel ID is correct

### Channel Not Found

- Double-check the channel ID (it should be a long number)
- Make sure Developer Mode is enabled when copying the ID
- Verify the bot has access to the channel

### Bot Not Showing in Server

- Re-invite the bot using the OAuth2 URL
- Check that you authorized the bot for the correct server
- Verify the bot appears in your server's member list

## Security Best Practices

1. **Never share your bot token** - Treat it like a password
2. **Use separate bots for different environments** - Don't reuse the same bot token across workspaces
3. **Rotate tokens regularly** - If a token is compromised, reset it immediately
4. **Limit bot permissions** - Only grant the minimum permissions needed (Send Messages, View Channels)
5. **Monitor bot activity** - Check your Discord server logs if notifications stop working

## Additional Resources

- <a href="https://discord.com/developers/docs/intro" target="_blank" rel="noopener noreferrer">Discord Developer Documentation</a>
- <a href="https://discord.com/developers/docs/topics/permissions" target="_blank" rel="noopener noreferrer">Discord Bot Permissions</a>
- <a href="https://discord.com/developers/docs/reference" target="_blank" rel="noopener noreferrer">Discord API Documentation</a>

