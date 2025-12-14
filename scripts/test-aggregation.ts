#!/usr/bin/env tsx
/**
 * Test script for the token usage aggregation lambda
 * 
 * Usage:
 *   pnpm test-aggregation                    # Aggregate yesterday's data
 *   pnpm test-aggregation 2025-01-15         # Aggregate specific date
 *   pnpm test-aggregation --previous-day      # Aggregate previous day (default)
 */

// Use dynamic import to handle TypeScript modules
const aggregationModule = await import('../apps/backend/src/scheduled/aggregate-token-usage/index.ts');
const { aggregateTokenUsageForDate, aggregatePreviousDay } = aggregationModule;

async function main() {
  const args = process.argv.slice(2);
  
  try {
    if (args.length === 0 || args[0] === '--previous-day') {
      console.log('Aggregating token usage for previous day...');
      await aggregatePreviousDay();
      console.log('✅ Aggregation completed successfully');
    } else if (args[0] === '--help' || args[0] === '-h') {
      console.log(`
Usage: pnpm test-aggregation [options]

Options:
  --previous-day          Aggregate previous day's data (default)
  YYYY-MM-DD             Aggregate data for a specific date
  --help, -h             Show this help message

Examples:
  pnpm test-aggregation
  pnpm test-aggregation 2025-01-15
  pnpm test-aggregation --previous-day
      `);
      process.exit(0);
    } else {
      // Parse date argument
      const dateStr = args[0];
      const date = new Date(dateStr);
      
      if (isNaN(date.getTime())) {
        console.error(`❌ Invalid date format: ${dateStr}`);
        console.error('Please use YYYY-MM-DD format (e.g., 2025-01-15)');
        process.exit(1);
      }
      
      console.log(`Aggregating token usage for date: ${dateStr}...`);
      await aggregateTokenUsageForDate(date);
      console.log('✅ Aggregation completed successfully');
    }
  } catch (error) {
    console.error('❌ Aggregation failed:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

main();

