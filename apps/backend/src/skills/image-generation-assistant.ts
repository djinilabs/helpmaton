import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "image-generation-assistant",
  name: "Image Generation Assistant",
  description: "Generate images from prompts; style and composition guidance",
  role: "marketing",
  requiredTools: [
    {
      "type": "builtin",
      "tool": "image_generation"
    }
  ],
  content: "## Image Generation Assistant\n\nWhen generating images (the actual tool is **generate_image**):\n\n- Craft detailed prompts that specify style, subject, and composition for best results.\n- Avoid sensitive or prohibited content (violence, adult content, trademarked characters, real people without consent); follow content policy.\n- Iterate on feedback: if the result is off, suggest a revised prompt (e.g. more specific style, different composition).\n- Return the public image URL from the tool so the user can view or download the image.\n- Do not invent capabilities; only use the **generate_image** tool as provided (single prompt, returns URL).\n\n## Step-by-step instructions\n\n1. Clarify the user's intent: subject, style (e.g. photorealistic, illustration, minimalist), and any constraints (colors, mood, aspect).\n2. Build a clear prompt: include subject, style, composition (e.g. \"centered\", \"wide shot\"), and optional details (lighting, colors).\n3. Call **generate_image** with the prompt string; do not pass multiple prompts or unsupported parameters.\n4. Return the image URL to the user; if they ask for changes, suggest a revised prompt and generate again.\n5. If the tool returns an error (e.g. content policy), explain and suggest a safer prompt.\n\n## Examples of inputs and outputs\n\n- **Input**: \"Generate a hero image for a fintech app: modern, blue and white, abstract shapes.\"  \n  **Output**: A prompt like \"Modern hero image for fintech app, blue and white color scheme, abstract geometric shapes, clean minimalist composition, professional\"; then the returned image URL.\n\n- **Input**: \"The last image was too dark.\"  \n  **Output**: Revise the prompt to add \"bright lighting\" or \"light background\"; call **generate_image** again and return the new URL.\n\n## Common edge cases\n\n- **Vague prompt**: Ask for style or subject details before generating, or propose a concrete prompt and confirm.\n- **Content policy / blocked**: Tell the user the request was rejected and suggest removing or changing sensitive elements (e.g. no real people, no trademarked content).\n- **User wants multiple images**: Generate one at a time; use the tool once per image with a distinct prompt.\n- **Tool error**: Report the error (e.g. timeout, rate limit) and suggest retrying or simplifying the prompt.\n\n## Tool usage for specific purposes\n\n- **generate_image** (builtin **image_generation**): Use with a single, detailed prompt string. Specify style, subject, composition; avoid prohibited content. Returns a public image URL.",
};

export default skill;
