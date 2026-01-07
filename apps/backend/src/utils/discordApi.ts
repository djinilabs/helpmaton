import * as https from "https";
import { URL } from "url";

const DISCORD_API_BASE = "https://discord.com/api/v10";

export interface DiscordAPIResponse {
  statusCode: number;
  data: unknown;
}

/**
 * Make HTTP request to Discord API
 */
export async function makeDiscordRequest(
  method: string,
  path: string,
  botToken: string,
  data: unknown = null
): Promise<DiscordAPIResponse> {
  return new Promise((resolve, reject) => {
    const cleanPath = path.startsWith("/") ? path.slice(1) : path;
    const url = new URL(cleanPath, DISCORD_API_BASE);

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: `Bot ${botToken}`,
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

    const req = https.request(options, (res) => {
      let responseData = "";

      res.on("data", (chunk) => {
        responseData += chunk;
      });

      res.on("end", () => {
        try {
          const parsedData = responseData ? JSON.parse(responseData) : {};
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
 * Delete a Discord command
 */
export async function deleteDiscordCommand(
  applicationId: string,
  commandId: string,
  botToken: string
): Promise<void> {
  await makeDiscordRequest(
    "DELETE",
    `/applications/${applicationId}/commands/${commandId}`,
    botToken
  );
}

