import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "shopify-ecommerce-ops",
  name: "Shopify E-commerce Ops",
  description: "Orders, products, sales reports",
  role: "sales",
  requiredTools: [
    {
      "type": "mcpService",
      "serviceType": "shopify"
    }
  ],
  content: "## Shopify E-commerce Ops\n\nWhen working with Shopify orders and products:\n\n- Use **shopify_get_order** (tool name may have a suffix if multiple Shopify servers exist) to find an order by ID or number (e.g. #1001).\n- Use **shopify_search_products** to search products by title for inventory and pricing; inventory lives on variants (inventory_quantity).\n- Use **shopify_sales_report** to summarize order counts and gross sales by date range.\n- Summarize results clearly; cite order IDs or date ranges when relevant.\n- Shopify uses offline access tokens so data can be queried in the background.\n\n## Step-by-step instructions\n\n1. For \"order #1001\" or \"order by ID\": call **shopify_get_order** with the order ID or number.\n2. For \"products matching X\" or inventory/pricing: call **shopify_search_products** with the search query; report title, variants, inventory_quantity, and pricing from the response.\n3. For \"sales last week\" or revenue summary: call **shopify_sales_report** with the date range; report order counts and gross sales.\n4. When summarizing orders: include status, total, and key line items if relevant; for products, include variant inventory when the user asks about stock.\n5. If the user asks for a date range, use it for **shopify_sales_report**; otherwise infer (e.g. last 7 days) or ask.\n\n## Examples of inputs and outputs\n\n- **Input**: \"What's in order #1001?\"  \n  **Output**: Order status, total, and line items (product, quantity, price) from **shopify_get_order**.\n\n- **Input**: \"Sales summary for last month.\"  \n  **Output**: Order count and gross sales from **shopify_sales_report** for that date range; cite the range.\n\n- **Input**: \"Do we have stock for product X?\"  \n  **Output**: Product and variant info including inventory_quantity from **shopify_search_products**; summarize stock status.\n\n## Common edge cases\n\n- **Order not found**: Say \"Order [id/number] not found\" and suggest checking the ID or number format.\n- **No products found**: Say \"No products matching [query]\" and suggest a different search term.\n- **Date range for sales**: **shopify_sales_report** needs a date range; infer from \"last week/month\" or ask.\n- **API/OAuth error**: Report that Shopify returned an error and suggest reconnecting or retrying.\n\n## Tool usage for specific purposes\n\n- **shopify_get_order**: Use to look up an order by ID or number (e.g. #1001); returns order details and line items.\n- **shopify_search_products**: Use to search products by title; use for inventory (variants.inventory_quantity) and pricing.\n- **shopify_sales_report**: Use for order counts and gross sales over a date range; always specify the range.",
};

export default skill;
