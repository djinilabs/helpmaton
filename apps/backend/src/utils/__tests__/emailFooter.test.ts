import { describe, expect, it } from "vitest";

import {
  appendEmailFooter,
  EMAIL_FOOTER_TEXT,
} from "../emailFooter";

describe("emailFooter", () => {
  const footerLine =
    "Found a bug? I probably fixed it 10 minutes ago, but tell me anyway. Just hit reply.";

  it("appends footer to plain text", () => {
    const input = { text: "Hello, this is the body." };
    const result = appendEmailFooter(input);
    expect(result.text).toBe(`Hello, this is the body.\n\n${footerLine}`);
    expect(result.html).toBeUndefined();
  });

  it("appends footer when html is provided", () => {
    const input = {
      text: "Body",
      html: "<html><body><p>Body</p></body></html>",
    };
    const result = appendEmailFooter(input);
    expect(result.text).toBe(`Body\n\n${footerLine}`);
    expect(result.html).toContain(footerLine);
    expect(result.html).toContain("</body>");
  });

  it("when html is undefined only text is modified", () => {
    const input = { text: "Only text" };
    const result = appendEmailFooter(input);
    expect(result.text.endsWith(footerLine)).toBe(true);
    expect(result.html).toBeUndefined();
  });

  it("footer text constant matches expected line", () => {
    expect(EMAIL_FOOTER_TEXT).toBe(footerLine);
  });

  it("inserts footer before </body> when present", () => {
    const html = "<html><body><p>Content</p></body></html>";
    const result = appendEmailFooter({ text: "x", html });
    const bodyCloseIndex = result.html!.indexOf("</body>");
    const footerIndex = result.html!.indexOf(footerLine);
    expect(footerIndex).toBeGreaterThan(-1);
    expect(bodyCloseIndex).toBeGreaterThan(footerIndex);
  });

  it("appends footer at end when html has no </body>", () => {
    const html = "<div><p>No body tag</p></div>";
    const result = appendEmailFooter({ text: "x", html });
    expect(result.html).toContain(footerLine);
    expect(result.html).toContain("<div><p>No body tag</p></div>");
  });

  it("handles empty text by appending only footer", () => {
    const result = appendEmailFooter({ text: "" });
    expect(result.text).toBe(`\n\n${footerLine}`);
    expect(result.html).toBeUndefined();
  });

  it("is idempotent for text when footer already present", () => {
    const text = `Hello.\n\n${footerLine}`;
    const result = appendEmailFooter({ text });
    expect(result.text).toBe(text);
    expect(result.text).not.toContain(`${footerLine}\n\n${footerLine}`);
  });

  it("is idempotent for html when footer text already present", () => {
    const html = `<html><body><p>Hi</p><p>${footerLine}</p></body></html>`;
    const result = appendEmailFooter({ text: "x", html });
    expect(result.html).toBe(html);
    const footerCount = (result.html!.match(new RegExp(footerLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
    expect(footerCount).toBe(1);
  });

  it("inserts footer before last </body> when multiple </body> present", () => {
    const html = '<html><body><script>var x = "</body>";</script><p>Content</p></body></html>';
    const result = appendEmailFooter({ text: "x", html });
    expect(result.html).toContain(footerLine);
    const lastBodyClose = result.html!.lastIndexOf("</body>");
    const footerIndex = result.html!.indexOf(footerLine);
    expect(footerIndex).toBeGreaterThan(-1);
    expect(lastBodyClose).toBeGreaterThan(footerIndex);
    expect(result.html).toContain('<script>var x = "</body>";</script>');
  });
});
