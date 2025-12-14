import { customAlphabet } from "nanoid";

export interface MailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
}

const generateUniqueTag = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz",
  10
);

export class TestmailClient {
  private namespace: string;
  private tag: string;
  public emailAddress: string;

  constructor(namespace: string) {
    this.namespace = namespace;
    this.tag = generateUniqueTag();
    this.emailAddress = `${this.namespace}.${this.tag}@inbox.testmail.app`;
    console.log(
      `Testmail initialized with namespace: ${namespace}, tag: ${this.tag}`
    );
  }

  /**
   * Wait for a message to arrive with a timeout
   * Polls the Testmail API periodically until a message is received or timeout is reached
   */
  async waitForMessage(timeoutMs: number = 60000): Promise<MailMessage> {
    console.log(
      `Waiting for message in ${this.emailAddress} with ${timeoutMs}ms timeout...`
    );
    const apiKey = process.env.TESTMAIL_API_KEY;
    if (!apiKey) {
      throw new Error("TESTMAIL_API_KEY environment variable is required");
    }
    console.log(`Polling for messages in inbox: ${this.emailAddress}`);

    const startTime = Date.now();
    const pollInterval = 2000; // Poll every 2 seconds
    const url = new URL("https://api.testmail.app/api/json");
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("namespace", this.namespace);
    url.searchParams.set("tag", this.tag);
    url.searchParams.set("livequery", "true");

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(url.toString(), {
          signal: AbortSignal.timeout(10000), // 10 second timeout per request
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `HTTP error! status: ${response.status}, ${response.statusText}, ${errorText}`
          );
        }

        const data = await response.json();

        if (data.emails && data.emails.length > 0) {
          const message = data.emails[0]; // Get the most recent message
          console.log(`✅ Message received after ${Date.now() - startTime}ms:`, {
            to: message.to,
            from: message.from,
            subject: message.subject,
            text: message.text?.substring(0, 100) + "...",
          });
          return message;
        }

        // No emails yet, wait before next poll
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      } catch (error) {
        // If it's a timeout error, continue polling
        if (error instanceof Error && error.name === "TimeoutError") {
          console.log(`Poll timeout, retrying... (${Date.now() - startTime}ms elapsed)`);
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
          continue;
        }
        // For other errors, log and retry
        console.warn(`Error while polling:`, error);
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
    }

    throw new Error(`Timeout waiting for message after ${timeoutMs}ms`);
  }

  /**
   * Clean up the inbox after testing
   * Note: Testmail automatically cleans up emails after 24 hours
   */
  async cleanup(): Promise<void> {
    console.log(
      "Testmail cleanup: emails will be automatically cleaned up after 24 hours"
    );
  }
}

