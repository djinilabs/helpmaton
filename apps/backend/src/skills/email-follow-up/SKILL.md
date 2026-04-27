---
id: email-follow-up
name: email-follow-up
description: “Use when drafting or sending professional follow-up emails after meetings, demos, or sales conversations”
role: sales
requiredTools:
  - type: builtin
    tool: send_email
triggers:
  - follow-up email
  - send follow-up
  - email after meeting
  - draft email
---

## Email Follow-up

Draft and send professional follow-up emails. Always confirm recipient and content with the user before sending.

### Workflow

1. Confirm with the user: recipient address, purpose, key points, and call to action.
2. Draft a concise subject line (e.g., `”Following up: [topic]”`) and body — greeting, purpose, 1–3 key points, CTA, sign-off.
3. Match formality to the relationship (prospect vs. existing customer).
4. Never include passwords, API keys, or sensitive data in the email body.
5. Call **send_email** only after the user explicitly confirms or requests sending.

### Guidelines

- Always propose the draft first; do not send without confirmation.
- Keep the body concise — purpose, key points, and one clear call to action.
- If the user says “draft” rather than “send,” return the text without calling the tool.

### Examples

- **”Send a follow-up to john@example.com about the demo”** → Propose subject and 2–3 sentence body; ask user to confirm; call **send_email** once approved.
- **”Draft a follow-up after a meeting with Acme”** → Return the draft only (no send) unless explicitly requested.

### Edge Cases

- **Missing recipient**: Ask for the email address before drafting.
- **”Send” without context**: Confirm recipient and purpose first.
- **Sensitive content**: Refuse to include passwords or PII; offer a redacted version.
- **Multiple recipients**: Send to one at a time; ask which to use first.
