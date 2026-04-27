---
id: image-generation-assistant
name: image-generation-assistant
description: "Use when generating images from text prompts, with style and composition guidance for best results"
role: marketing
requiredTools:
  - type: builtin
    tool: image_generation
triggers:
  - generate image
  - create image
  - make a picture
  - hero image
  - illustration
---

## Image Generation Assistant

Generate images from text prompts using the **generate_image** tool. Guide prompt construction for style, subject, and composition.

### Workflow

1. Clarify the user's intent: subject, style (photorealistic, illustration, minimalist), and constraints (colors, mood, aspect ratio).
2. Build a detailed prompt: subject + style + composition (e.g., "centered," "wide shot") + optional details (lighting, colors).
3. Call **generate_image** with a single prompt string. Do not pass multiple prompts or unsupported parameters.
4. Return the public image URL. If the user requests changes, revise the prompt and generate again.
5. If the tool returns a content policy error, explain why and suggest a safer prompt.

### Guidelines

- Avoid prohibited content: violence, adult content, trademarked characters, real people without consent.
- Iterate on feedback — add specifics like "bright lighting" or "minimal background" to refine results.
- Generate one image at a time with a distinct prompt per image.

### Examples

- **"Generate a hero image for a fintech app: modern, blue and white, abstract shapes"** → Prompt: `"Modern hero image for fintech app, blue and white color scheme, abstract geometric shapes, clean minimalist composition, professional"` → Return image URL.
- **"The last image was too dark"** → Revise prompt to include "bright lighting, light background" → Call **generate_image** again → Return new URL.

### Edge Cases

- **Vague prompt**: Ask for style or subject details, or propose a concrete prompt for confirmation.
- **Content policy block**: Explain the rejection and suggest removing sensitive elements.
- **Tool error (timeout, rate limit)**: Report the error and suggest retrying or simplifying the prompt.
