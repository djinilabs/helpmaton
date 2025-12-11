import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

import { database } from "../tables";

import { refreshGmailToken } from "./oauth/gmail";
import { refreshOutlookToken } from "./oauth/outlook";

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  from?: string;
}

interface GmailConfig {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  email?: string;
}

interface OutlookConfig {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  email?: string;
}

interface SMTPConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
}

/**
 * Check if token is expired or will expire soon (within 5 minutes)
 */
function isTokenExpired(expiresAt: string): boolean {
  const expirationTime = new Date(expiresAt).getTime();
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;
  return expirationTime <= now + fiveMinutes;
}

/**
 * Ensure Gmail token is valid, refresh if needed
 */
async function ensureGmailToken(
  config: GmailConfig,
  workspaceId: string
): Promise<string> {
  if (isTokenExpired(config.expiresAt)) {
    // Refresh token
    const refreshed = await refreshGmailToken(config.refreshToken);

    // Update stored config in database
    const db = await database();
    const pk = `email-connections/${workspaceId}`;
    const connection = await db["email-connection"].get(pk, "connection");
    if (connection) {
      const updatedConfig = {
        ...config,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
      };
      await db["email-connection"].update({
        ...connection,
        config: updatedConfig,
        updatedAt: new Date().toISOString(),
      });
    }

    return refreshed.accessToken;
  }
  return config.accessToken;
}

/**
 * Ensure Outlook token is valid, refresh if needed
 */
async function ensureOutlookToken(
  config: OutlookConfig,
  workspaceId: string
): Promise<string> {
  if (isTokenExpired(config.expiresAt)) {
    // Refresh token
    const refreshed = await refreshOutlookToken(config.refreshToken);

    // Update stored config in database
    const db = await database();
    const pk = `email-connections/${workspaceId}`;
    const connection = await db["email-connection"].get(pk, "connection");
    if (connection) {
      const updatedConfig = {
        ...config,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
      };
      await db["email-connection"].update({
        ...connection,
        config: updatedConfig,
        updatedAt: new Date().toISOString(),
      });
    }

    return refreshed.accessToken;
  }
  return config.accessToken;
}

/**
 * Send email via Gmail API
 */
async function sendEmailViaGmail(
  accessToken: string,
  options: EmailOptions
): Promise<void> {
  const fromEmail = options.from || "me";
  const to = options.to;
  const subject = options.subject;
  const text = options.text;
  const html = options.html;

  // Create MIME message
  const messageParts = [
    `To: ${to}`,
    `From: ${fromEmail}`,
    `Subject: ${subject}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    html || text,
  ];

  const message = messageParts.join("\n");

  // Encode message in base64url format
  const encodedMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const response = await fetch(
    "https://www.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw: encodedMessage,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Failed to send email via Gmail");
    console.error("Email contents:", {
      from: fromEmail,
      to,
      subject,
      text,
      html,
    });
    throw new Error(
      `Failed to send email via Gmail: ${response.status} ${errorText}`
    );
  }
}

/**
 * Send email via Outlook/Microsoft Graph API
 */
async function sendEmailViaOutlook(
  accessToken: string,
  options: EmailOptions
): Promise<void> {
  const to = options.to;
  const subject = options.subject;
  const text = options.text;
  const html = options.html;

  const message = {
    message: {
      subject,
      body: {
        contentType: html ? "HTML" : "Text",
        content: html || text,
      },
      toRecipients: [
        {
          emailAddress: {
            address: to,
          },
        },
      ],
      // Note: 'from' field is omitted - Microsoft Graph API automatically uses
      // the authenticated user's email address as the sender
    },
  };

  const response = await fetch(
    "https://graph.microsoft.com/v1.0/me/sendMail",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Failed to send email via Outlook");
    console.error("Email contents:", {
      to,
      subject,
      text,
      html,
      from: options.from,
    });
    throw new Error(
      `Failed to send email via Outlook: ${response.status} ${errorText}`
    );
  }
}

/**
 * Send email via SMTP
 */
async function sendEmailViaSMTP(
  config: SMTPConfig,
  options: EmailOptions
): Promise<void> {
  const transporter: Transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure, // true for 465, false for other ports
    auth: {
      user: config.username,
      pass: config.password,
    },
  });

  try {
    await transporter.sendMail({
      from: options.from || config.fromEmail,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
  } catch (error) {
    console.error("Failed to send email via SMTP");
    console.error("Email contents:", {
      from: options.from || config.fromEmail,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
    throw error;
  }
}

/**
 * Send email via workspace email connection
 */
export async function sendEmailViaConnection(
  workspaceId: string,
  options: EmailOptions
): Promise<void> {
  const db = await database();
  const pk = `email-connections/${workspaceId}`;
  const connection = await db["email-connection"].get(pk, "connection");

  if (!connection) {
    throw new Error(
      `No email connection found for workspace ${workspaceId}`
    );
  }

  switch (connection.type) {
    case "gmail": {
      const config = connection.config as unknown as GmailConfig;
      if (!config.accessToken || !config.refreshToken) {
        throw new Error("Gmail connection missing tokens");
      }
      const accessToken = await ensureGmailToken(config, workspaceId);
      await sendEmailViaGmail(accessToken, {
        ...options,
        from: options.from || config.email,
      });
      break;
    }
    case "outlook": {
      const config = connection.config as unknown as OutlookConfig;
      if (!config.accessToken || !config.refreshToken) {
        throw new Error("Outlook connection missing tokens");
      }
      const accessToken = await ensureOutlookToken(config, workspaceId);
      await sendEmailViaOutlook(accessToken, {
        ...options,
        from: options.from || config.email,
      });
      break;
    }
    case "smtp": {
      const config = connection.config as unknown as SMTPConfig;
      if (
        !config.host ||
        !config.port ||
        !config.username ||
        !config.password ||
        !config.fromEmail
      ) {
        throw new Error("SMTP connection missing required configuration");
      }
      await sendEmailViaSMTP(config, options);
      break;
    }
    default:
      throw new Error(`Unsupported email connection type: ${connection.type}`);
  }
}

