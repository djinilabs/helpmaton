#!/usr/bin/env node

/**
 * Test script to verify LanceDB metadata is being stored and retrieved correctly
 * 
 * Usage:
 *   node scripts/test-lancedb-metadata.mjs <workspaceId> <agentId>
 * 
 * This script:
 * 1. Creates a test conversation with known IDs
 * 2. Writes it to working memory
 * 3. Waits for processing
 * 4. Queries the vector database
 * 5. Verifies metadata is present and correct
 */

import { randomUUID } from 'crypto';

// Parse command line arguments
const workspaceId = process.argv[2];
const agentId = process.argv[3];

if (!workspaceId || !agentId) {
  console.error('Usage: node scripts/test-lancedb-metadata.mjs <workspaceId> <agentId>');
  console.error('Example: node scripts/test-lancedb-metadata.mjs workspace-123 agent-456');
  process.exit(1);
}

console.log('=== LanceDB Metadata Test ===');
console.log(`Workspace ID: ${workspaceId}`);
console.log(`Agent ID: ${agentId}`);
console.log('');

// Test conversation data
const conversationId = `test-metadata-${randomUUID()}`;
const testMessages = [
  {
    role: 'user',
    content: 'This is a test message to verify metadata storage in LanceDB'
  },
  {
    role: 'assistant',
    content: 'I acknowledge your test message. The metadata should include the conversation, workspace, and agent IDs.'
  }
];

console.log(`Created test conversation: ${conversationId}`);
console.log('');

// Import the writeToWorkingMemory function
let writeToWorkingMemory;
try {
  const module = await import('../apps/backend/src/utils/memory/writeMemory.js');
  writeToWorkingMemory = module.writeToWorkingMemory;
} catch (error) {
  console.error('❌ Failed to import writeToWorkingMemory:', error.message);
  console.error('Make sure you build the backend first: pnpm build:backend');
  process.exit(1);
}

// Import the query function
let query;
try {
  const module = await import('../apps/backend/src/utils/vectordb/readClient.js');
  query = module.query;
} catch (error) {
  console.error('❌ Failed to import query:', error.message);
  console.error('Make sure you build the backend first: pnpm build:backend');
  process.exit(1);
}

// Step 1: Write to working memory
console.log('Step 1: Writing test conversation to working memory...');
try {
  await writeToWorkingMemory(agentId, workspaceId, conversationId, testMessages);
  console.log('✅ Successfully queued write operation');
} catch (error) {
  console.error('❌ Failed to write to working memory:', error.message);
  process.exit(1);
}
console.log('');

// Step 2: Wait for SQS processing
console.log('Step 2: Waiting for SQS queue processing (10 seconds)...');
await new Promise(resolve => setTimeout(resolve, 10000));
console.log('✅ Wait complete');
console.log('');

// Step 3: Query the vector database
console.log('Step 3: Querying vector database...');
let results;
try {
  results = await query(agentId, 'working', {
    limit: 100
  });
  console.log(`✅ Retrieved ${results.length} records`);
} catch (error) {
  console.error('❌ Failed to query vector database:', error.message);
  process.exit(1);
}
console.log('');

// Step 4: Find our test records
console.log('Step 4: Looking for test conversation records...');
const testRecords = results.filter(r => 
  r.metadata?.conversationId === conversationId
);

if (testRecords.length === 0) {
  console.error('❌ No records found with the test conversation ID');
  console.error('   This might indicate a delay in processing. Try running again.');
  console.error('');
  console.error('Sample records from database:');
  results.slice(0, 3).forEach((r, i) => {
    console.error(`  Record ${i + 1}:`);
    console.error(`    ID: ${r.id}`);
    console.error(`    Content: ${r.content.substring(0, 50)}...`);
    console.error(`    Metadata:`, JSON.stringify(r.metadata, null, 6));
  });
  process.exit(1);
}

console.log(`✅ Found ${testRecords.length} test records`);
console.log('');

// Step 5: Verify metadata
console.log('Step 5: Verifying metadata...');
let allCorrect = true;

testRecords.forEach((record, index) => {
  console.log(`\nRecord ${index + 1}:`);
  console.log(`  ID: ${record.id}`);
  console.log(`  Content: ${record.content.substring(0, 60)}...`);
  console.log(`  Timestamp: ${record.timestamp}`);
  console.log(`  Metadata:`, JSON.stringify(record.metadata, null, 4));
  
  // Verify metadata fields
  const errors = [];
  
  if (record.metadata?.conversationId !== conversationId) {
    errors.push(`conversationId mismatch: expected "${conversationId}", got "${record.metadata?.conversationId}"`);
  }
  
  if (record.metadata?.workspaceId !== workspaceId) {
    errors.push(`workspaceId mismatch: expected "${workspaceId}", got "${record.metadata?.workspaceId}"`);
  }
  
  if (record.metadata?.agentId !== agentId) {
    errors.push(`agentId mismatch: expected "${agentId}", got "${record.metadata?.agentId}"`);
  }
  
  if (errors.length > 0) {
    console.log('  ❌ Metadata validation FAILED:');
    errors.forEach(err => console.log(`     - ${err}`));
    allCorrect = false;
  } else {
    console.log('  ✅ Metadata is correct');
  }
});

console.log('');
console.log('=== Test Summary ===');
if (allCorrect) {
  console.log('✅ All metadata fields are correct!');
  console.log('   LanceDB is properly storing and retrieving metadata.');
  process.exit(0);
} else {
  console.log('❌ Some metadata fields are incorrect!');
  console.log('   This indicates an issue with metadata storage or retrieval.');
  console.log('   Check the diagnosis document: docs/lancedb-metadata-diagnosis.md');
  process.exit(1);
}
