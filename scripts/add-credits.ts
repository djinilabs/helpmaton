#!/usr/bin/env tsx
/**
 * Script to add credits to a workspace for testing
 *
 * Usage:
 *   pnpm add-credits <workspaceId> <amount>
 *
 * Examples:
 *   pnpm add-credits 70a9418f-7343-481b-b632-aa672c0532b9 100
 *   pnpm add-credits 70a9418f-7343-481b-b632-aa672c0532b9 50.50
 */

// Use dynamic import to handle TypeScript modules
const { database } = await import("../apps/backend/src/tables/index.ts");
const { creditCredits } = await import(
  "../apps/backend/src/utils/creditManagement.ts"
);
const { toNanoDollars } = await import(
  "../apps/backend/src/utils/creditConversions.ts"
);

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`
Usage: pnpm add-credits <workspaceId> <amount> [options]

Arguments:
  workspaceId          The workspace ID to add credits to
  amount               The amount of credits to add (number)

Options:
  --help, -h              Show this help message

Examples:
  pnpm add-credits 70a9418f-7343-481b-b632-aa672c0532b9 100
  pnpm add-credits 70a9418f-7343-481b-b632-aa672c0532b9 50.50
    `);
    process.exit(0);
  }

  if (args.length < 2) {
    console.error("❌ Error: workspaceId and amount are required");
    console.error("Run 'pnpm add-credits --help' for usage information");
    process.exit(1);
  }

  const workspaceId = args[0];
  const amountStr = args[1];
  const amount = parseFloat(amountStr);

  if (isNaN(amount) || amount <= 0) {
    console.error(`❌ Error: Invalid amount: ${amountStr}`);
    console.error("Amount must be a positive number");
    process.exit(1);
  }

  try {
    console.log(`\n💰 Adding credits to workspace: ${workspaceId}`);
    console.log(`   Amount: ${amount.toFixed(2)} USD\n`);

    const db = await database();

    // Get workspace to show current balance
    const workspacePk = `workspaces/${workspaceId}`;
    const workspace = await db.workspace.get(workspacePk, "workspace");

    if (!workspace) {
      console.error(`❌ Error: Workspace ${workspaceId} not found`);
      process.exit(1);
    }

    console.log(
      `📊 Current balance: ${(workspace.creditBalance / 1_000_000_000).toFixed(
        2
      )} USD`
    );
    console.log(`   Currency: USD\n`);

    // Convert amount from dollars to nano-dollars before passing to creditCredits
    const amountInNanoDollars = toNanoDollars(amount);

    // Add credits (creditCredits expects amount in nano-dollars)
    const updated = await creditCredits(db, workspaceId, amountInNanoDollars);

    console.log(`✅ Successfully added ${amount.toFixed(2)} USD credits`);
    console.log(
      `📊 New balance: ${(updated.creditBalance / 1_000_000_000).toFixed(2)} USD\n`
    );
  } catch (error) {
    console.error(
      "❌ Error adding credits:",
      error instanceof Error ? error.message : String(error)
    );
    if (error instanceof Error && error.stack) {
      console.error("\nStack trace:", error.stack);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("❌ Unexpected error:", error);
  process.exit(1);
});
