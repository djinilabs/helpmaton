#!/usr/bin/env tsx

import { IncomingMessage } from "http";
import * as https from "https";
import { URL } from "url";

const tryJsonParse = (json: string) => {
  try {
    return JSON.parse(json);
  } catch (err) {
    console.error(err);
    return undefined;
  }
};

/**
 * Discord Slash Commands Registration Script
 *
 * This script registers slash commands with Discord's API.
 * It should be run during deployment to ensure commands are up to date.
 */

interface DiscordCommand {
  name: string;
  description: string;
  options?: DiscordCommandOption[];
}

interface DiscordCommandOption {
  type: number;
  name: string;
  description: string;
  required: boolean;
}

interface DiscordAPIResponse {
  statusCode: number;
  data: unknown;
}

// Discord API configuration
const DISCORD_API_BASE = "https://discord.com/api/v10";
const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const BOT_TOKEN = process.env.DISCORD_CS_BOT_TOKEN;

// Command definitions
const COMMANDS: DiscordCommand[] = [
  {
    name: "credit",
    description: "Add credits to a workspace",
    options: [
      {
        type: 3, // STRING
        name: "workspace_id",
        description: "The workspace ID to credit",
        required: true,
      },
      {
        type: 10, // NUMBER
        name: "amount",
        description: "The amount of credits to add",
        required: true,
      },
    ],
  },
  {
    name: "debit",
    description: "Remove credits from a workspace",
    options: [
      {
        type: 3, // STRING
        name: "workspace_id",
        description: "The workspace ID to debit",
        required: true,
      },
      {
        type: 10, // NUMBER
        name: "amount",
        description: "The amount of credits to remove",
        required: true,
      },
    ],
  },
];

/**
 * Make HTTP request to Discord API
 */
async function makeRequest(
  method: string,
  path: string,
  data: unknown = null
): Promise<DiscordAPIResponse> {
  return new Promise((resolve, reject) => {
    // Remove leading slash from path to append to base URL instead of replacing it
    const cleanPath = path.startsWith("/") ? path.slice(1) : path;
    const url = new URL(cleanPath, DISCORD_API_BASE);

    console.log(`🔍 Making ${method} request to: ${url.toString()}`);

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "Helpmaton-Discord-Bot/1.0",
      },
    };

    if (data) {
      const jsonData = JSON.stringify(data);
      if (options.headers && !Array.isArray(options.headers)) {
        (options.headers as Record<string, string | number>)["Content-Length"] =
          Buffer.byteLength(jsonData);
      }
    }

    let res: IncomingMessage;

    const req = https.request(options, (r) => {
      res = r;
      let responseData = "";

      res.on("data", (chunk) => {
        responseData += chunk;
      });

      res.on("end", () => {
        try {
          const parsedData = responseData ? tryJsonParse(responseData) : {};
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, data: parsedData });
          } else {
            reject(
              new Error(
                `HTTP ${res.statusCode}: ${parsedData?.message || responseData}`
              )
            );
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          reject(new Error(`Failed to parse response: ${errorMessage}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

/**
 * Register commands globally (for all guilds)
 */
async function registerGlobalCommands(): Promise<DiscordCommand[]> {
  console.log("🔄 Registering global Discord commands...");
  console.log(
    `📡 Target URL: ${DISCORD_API_BASE}/applications/${APPLICATION_ID}/commands`
  );

  try {
    const response = await makeRequest(
      "PUT",
      `/applications/${APPLICATION_ID}/commands`,
      COMMANDS
    );

    console.log(
      `✅ Successfully registered ${COMMANDS.length} global commands`
    );
    console.log("📋 Registered commands:");
    COMMANDS.forEach((cmd) => {
      console.log(`   - /${cmd.name}: ${cmd.description}`);
    });

    return response.data as DiscordCommand[];
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("❌ Failed to register global commands:", errorMessage);
    throw error;
  }
}

/**
 * Get existing commands to compare
 */
async function getExistingCommands(): Promise<DiscordCommand[]> {
  try {
    const response = await makeRequest(
      "GET",
      `/applications/${APPLICATION_ID}/commands`
    );
    return response.data as DiscordCommand[];
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn("⚠️  Could not fetch existing commands:", errorMessage);
    return [];
  }
}

/**
 * Main function
 */
async function main(): Promise<void> {
  console.log("🚀 Starting Discord commands registration...");

  // Validate environment variables
  if (!APPLICATION_ID) {
    console.error("❌ DISCORD_APPLICATION_ID environment variable is required");
    process.exit(1);
  }

  if (!BOT_TOKEN) {
    console.error("❌ DISCORD_CS_BOT_TOKEN environment variable is required");
    process.exit(1);
  }

  console.log(`🔧 Configuration:`);
  console.log(`   - Application ID: ${APPLICATION_ID}`);
  console.log(
    `   - Bot Token: ${
      BOT_TOKEN ? `${BOT_TOKEN.substring(0, 10)}...` : "NOT SET"
    }`
  );
  console.log(`   - API Base: ${DISCORD_API_BASE}`);

  try {
    // Get existing commands for comparison
    const existingCommands = await getExistingCommands();
    console.log(`📊 Found ${existingCommands.length} existing commands`);

    // Register new commands
    const registeredCommands = await registerGlobalCommands();

    // Show summary
    console.log("\n📈 Registration Summary:");
    console.log(`   - Application ID: ${APPLICATION_ID}`);
    console.log(`   - Commands registered: ${registeredCommands.length}`);
    console.log(`   - Registration successful: ✅`);

    console.log("\n🎉 Discord commands registration completed successfully!");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("\n💥 Discord commands registration failed:", errorMessage);
    process.exit(1);
  }
}

// Run the script if called directly
// Check if this module is being run directly (not imported)
// For ES modules, compare the file URL with the script path
const isMainModule =
  import.meta.url.startsWith("file:") &&
  (import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.replace(/\\/g, "/") ===
      import.meta.url.replace("file://", "").replace(/\\/g, "/"));
if (isMainModule) {
  main();
}

export {
  registerGlobalCommands,
  getExistingCommands,
  COMMANDS,
  type DiscordCommand,
  type DiscordCommandOption,
};
