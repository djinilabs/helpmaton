/**
 * Send a message to a Slack channel using the Slack Incoming Webhooks API
 * @param webhookUrl - Slack webhook URL
 * @param content - Message content to send
 */
export async function sendSlackMessage(
  webhookUrl: string,
  content: string
): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: content,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Slack API error: ${response.status} ${response.statusText}`;
    
    try {
      const errorData = JSON.parse(errorText);
      if (errorData.error) {
        errorMessage = `Slack API error: ${errorData.error}`;
      } else {
        errorMessage = `Slack API error: ${errorText}`;
      }
    } catch {
      // If parsing fails, use the raw error text
      errorMessage = `Slack API error: ${errorText}`;
    }

    // Handle specific error cases
    if (response.status === 401) {
      throw new Error("Invalid Slack webhook URL or token");
    } else if (response.status === 403) {
      throw new Error("Slack webhook lacks permission to send messages");
    } else if (response.status === 404) {
      throw new Error("Slack webhook not found or has been deleted");
    }

    throw new Error(errorMessage);
  }

  // Message sent successfully
  // Slack webhooks return "ok" as plain text, not JSON
  await response.text();
}

