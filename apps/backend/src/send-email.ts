import { appendEmailFooter } from "./utils/emailFooter";

const domain = process.env.MAILGUN_DOMAIN || "helpmaton.com";

/**
 * Check if we're in production environment
 */
function isProduction(): boolean {
  return (
    process.env.ARC_ENV === "production" ||
    process.env.NODE_ENV === "production"
  );
}

export const sendEmail = async ({
  to,
  subject,
  text,
  html,
}: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}) => {
  const { text: textWithFooter, html: htmlWithFooter } = appendEmailFooter({
    text,
    html,
  });

  const emailContents = {
    to,
    subject,
    text: textWithFooter,
    html: htmlWithFooter,
    from: `info@${domain}`,
  };

  const mailgunKey = process.env.MAILGUN_KEY;
  if (!mailgunKey) {
    if (isProduction()) {
      throw new Error("MAILGUN_KEY environment variable is required");
    }
    // In non-production, just log and continue
    console.log(
      "[sendEmail] Not in production - logging email instead of sending:"
    );
    console.log("[sendEmail] Email contents:", emailContents);
    return { message: "Email logged (not sent - non-production environment)" };
  }

  let formData: FormData;
  try {
    formData = new FormData();
  } catch (error) {
    console.error("Failed to create FormData:", error);
    if (!isProduction()) {
      console.log("[sendEmail] FormData not available - logging email instead");
      console.log("[sendEmail] Email contents:", emailContents);
      return { message: "Email logged (FormData not available)" };
    }
    throw new Error("FormData is not available in this environment");
  }

  formData.append("from", `info@${domain}`);
  formData.append("to", to);
  formData.append("subject", subject);
  formData.append("text", textWithFooter);
  if (htmlWithFooter) {
    formData.append("html", htmlWithFooter);
    // Add charset headers for Mailslurp compatibility
    formData.append("h:Content-Type", "text/html; charset=UTF-8");
    formData.append("h:Content-Transfer-Encoding", "8bit");
    formData.append("h:MIME-Version", "1.0");
  }

  let response: Response;
  try {
    response = await fetch(
      `https://api.eu.mailgun.net/v3/${domain}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`api:${mailgunKey}`).toString(
            "base64"
          )}`,
        },
        body: formData,
      }
    );
  } catch (error) {
    console.error("Network error sending email:", error);
    // In non-production, don't throw - just log and return
    if (!isProduction()) {
      console.log(
        "[sendEmail] Network error in non-production - logging instead of throwing"
      );
      console.log("[sendEmail] Email contents:", emailContents);
      return { message: "Email logged (network error in non-production)" };
    }
    throw new Error(`Network error sending email: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    console.error("Failed to send email");
    console.error("Email contents:", emailContents);
    console.error("Status:", response.status);
    console.error("Status text:", response.statusText);
    let errorText: string;
    try {
      errorText = await response.text();
      console.error("Error response:", errorText);
    } catch (error) {
      console.error("Failed to read error response:", error);
      errorText = "Unable to read error response";
    }

    // In non-production, don't throw - just log and return
    if (!isProduction()) {
      console.log(
        "[sendEmail] Not in production - email sending failed but not throwing error"
      );
      return { message: "Email sending failed (logged in non-production)" };
    }

    throw new Error(`Failed to send email: ${response.statusText} - ${errorText}`);
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch (error) {
    console.error("Failed to parse email response as JSON:", error);
    // In non-production, don't throw - just return a success message
    if (!isProduction()) {
      console.log(
        "[sendEmail] Response not valid JSON in non-production - treating as success"
      );
      return { message: "Email sent (response not JSON in non-production)" };
    }
    throw new Error(`Failed to parse email response: ${error instanceof Error ? error.message : String(error)}`);
  }

  return result;
};
