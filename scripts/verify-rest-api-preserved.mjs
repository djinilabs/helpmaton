#!/usr/bin/env node
/**
 * Verification script to ensure REST API is preserved in cleaned CloudFormation template
 * 
 * This script checks that the REST API resource is not accidentally removed during cleanup.
 * 
 * Usage:
 *   node scripts/verify-rest-api-preserved.mjs <current-template> <cleaned-template>
 */

import { readFileSync } from 'fs';

const [currentFile, cleanedFile] = process.argv.slice(2);

if (!currentFile || !cleanedFile) {
  console.error('Usage: node scripts/verify-rest-api-preserved.mjs <current-template> <cleaned-template>');
  process.exit(1);
}

try {
  const currentTemplate = JSON.parse(readFileSync(currentFile, 'utf8'));
  const cleanedTemplate = JSON.parse(readFileSync(cleanedFile, 'utf8'));

  const currentResources = currentTemplate.Resources || {};
  const cleanedResources = cleanedTemplate.Resources || {};

  // Find REST API resources by type
  const currentRestApis = Object.fromEntries(
    Object.entries(currentResources).filter(([, res]) => res?.Type === 'AWS::ApiGateway::RestApi')
  );
  const cleanedRestApis = Object.fromEntries(
    Object.entries(cleanedResources).filter(([, res]) => res?.Type === 'AWS::ApiGateway::RestApi')
  );

  // Also check known logical IDs
  const knownRestApiIds = ['HTTP', 'HTTPRestApi'];
  const currentById = Object.fromEntries(
    knownRestApiIds.filter(id => id in currentResources).map(id => [id, currentResources[id]])
  );
  const cleanedById = Object.fromEntries(
    knownRestApiIds.filter(id => id in cleanedResources).map(id => [id, cleanedResources[id]])
  );

  console.log('📊 REST API check:');
  console.log(`   Current template: ${Object.keys(currentRestApis).length} by type, ${Object.keys(currentById).length} by known IDs`);
  console.log(`   Cleaned template: ${Object.keys(cleanedRestApis).length} by type, ${Object.keys(cleanedById).length} by known IDs`);

  // Check if REST API exists in cleaned template
  if (Object.keys(cleanedRestApis).length === 0 && Object.keys(cleanedById).length === 0) {
    console.error('❌ ERROR: REST API resource not found in cleaned template!');
    console.error('   This means the cleanup script accidentally removed the REST API.');
    console.error(`   Current REST APIs: ${Object.keys(currentRestApis).join(', ')}`);
    console.error(`   Current by ID: ${Object.keys(currentById).join(', ')}`);
    process.exit(1);
  }

  // Check if we lost any REST APIs
  if (Object.keys(cleanedRestApis).length < Object.keys(currentRestApis).length) {
    console.error(`❌ ERROR: REST API count decreased! (${Object.keys(currentRestApis).length} -> ${Object.keys(cleanedRestApis).length})`);
    process.exit(1);
  }

  if (Object.keys(cleanedById).length < Object.keys(currentById).length) {
    console.error(`❌ ERROR: Known REST API IDs decreased! (${Object.keys(currentById).join(', ')} -> ${Object.keys(cleanedById).join(', ')})`);
    process.exit(1);
  }

  console.log('✅ REST API preserved in cleaned template');
  process.exit(0);
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}

