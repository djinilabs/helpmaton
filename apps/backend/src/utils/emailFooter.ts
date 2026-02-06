/**
 * Standard footer appended to every outgoing email.
 */

export const EMAIL_FOOTER_TEXT =
  "Found a bug? I probably fixed it 10 minutes ago, but tell me anyway. Just hit reply.";

const EMAIL_FOOTER_HTML = `<p style="margin-top: 1.5em; color: #666; font-size: 0.9em;">${EMAIL_FOOTER_TEXT}</p>`;

export interface AppendEmailFooterInput {
  text: string;
  html?: string;
}

export interface AppendEmailFooterOutput {
  text: string;
  html?: string;
}

/**
 * Appends the standard email footer to plain text and optionally HTML.
 * Idempotent: does not add the footer again if it is already present.
 * For HTML, inserts before the last `</body>` to avoid breaking content that
 * contains `</body>` in scripts or attributes.
 *
 * @param input - Plain text body and optional HTML body
 * @returns Object with text (and html if provided) including the footer
 */
export function appendEmailFooter({
  text,
  html,
}: AppendEmailFooterInput): AppendEmailFooterOutput {
  const trimmed = text.trimEnd();
  const textAlreadyHasFooter = trimmed.endsWith(EMAIL_FOOTER_TEXT);
  const textWithFooter = textAlreadyHasFooter
    ? text
    : `${trimmed}\n\n${EMAIL_FOOTER_TEXT}`;

  let htmlWithFooter: string | undefined;
  if (typeof html === "string") {
    const alreadyHasFooter = html.includes(EMAIL_FOOTER_TEXT);
    if (alreadyHasFooter) {
      htmlWithFooter = html;
    } else {
      const lastBodyClose = html.lastIndexOf("</body>");
      if (lastBodyClose !== -1) {
        htmlWithFooter =
          html.slice(0, lastBodyClose) +
          EMAIL_FOOTER_HTML +
          "\n" +
          html.slice(lastBodyClose);
      } else {
        htmlWithFooter = `${html}${EMAIL_FOOTER_HTML}`;
      }
    }
  }

  return {
    text: textWithFooter,
    html: htmlWithFooter,
  };
}
