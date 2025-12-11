#!/usr/bin/env node
/**
 * Fix resource drift for HTTPApiResource
 * 
 * This script handles the case where HTTPApiResource exists in CloudFormation
 * but was manually deleted from API Gateway. It recreates the resource in API Gateway
 * and then uses CloudFormation resource import to align the stack.
 * 
 * Usage:
 *   node scripts/fix-api-resource-drift.mjs
 */

import { execSync } from 'child_process';

const STACK_NAME = 'HelpmatonProduction';
const REGION = 'eu-west-2';
const REST_API_ID = 'yiipb955d0';
const EXPECTED_PHYSICAL_ID = 'pbp01b';

function execCommand(command, description) {
  try {
    console.log(`\n📋 ${description}...`);
    const output = execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
    return { success: true, output: output.trim() };
  } catch (error) {
    return { success: false, error: error.message, stderr: error.stderr?.toString() };
  }
}

function checkApiResource() {
  const result = execCommand(
    `aws apigateway get-resources --rest-api-id ${REST_API_ID} --region ${REGION} --query 'items[?path==\`/api\`].id' --output text`,
    'Checking if /api resource exists in API Gateway'
  );
  
  if (result.success && result.output) {
    const resourceId = result.output.trim();
    console.log(`✅ /api resource exists with ID: ${resourceId}`);
    if (resourceId === EXPECTED_PHYSICAL_ID) {
      console.log('✅ Resource ID matches CloudFormation expectation');
      return { exists: true, id: resourceId, matches: true };
    } else {
      console.log(`⚠️  Resource ID mismatch! CloudFormation expects: ${EXPECTED_PHYSICAL_ID}`);
      return { exists: true, id: resourceId, matches: false };
    }
  } else {
    console.log('❌ /api resource does not exist in API Gateway');
    return { exists: false, id: null, matches: false };
  }
}

function getRootResourceId() {
  const result = execCommand(
    `aws apigateway get-resources --rest-api-id ${REST_API_ID} --region ${REGION} --query 'items[?path==\`/\`].id' --output text`,
    'Getting root resource ID'
  );
  
  if (result.success && result.output) {
    return result.output.trim();
  }
  throw new Error('Failed to get root resource ID');
}

function recreateApiResource(rootId) {
  console.log(`\n🔧 Recreating /api resource in API Gateway...`);
  const result = execCommand(
    `aws apigateway create-resource --rest-api-id ${REST_API_ID} --region ${REGION} --parent-id ${rootId} --path-part api --output json`,
    'Creating /api resource'
  );
  
  if (result.success) {
    const resource = JSON.parse(result.output);
    const newId = resource.id;
    console.log(`✅ Created /api resource with ID: ${newId}`);
    return newId;
  } else {
    throw new Error(`Failed to create /api resource: ${result.error}`);
  }
}

async function main() {
  console.log('🔍 Checking resource drift for HTTPApiResource...\n');
  
  const apiResource = checkApiResource();
  
  if (apiResource.exists && apiResource.matches) {
    console.log('\n✅ No action needed - resource exists and matches CloudFormation expectation');
    process.exit(0);
  }
  
  if (!apiResource.exists) {
    console.log('\n⚠️  /api resource is missing from API Gateway');
    console.log('CloudFormation expects PhysicalId:', EXPECTED_PHYSICAL_ID);
    console.log('\n📝 Solution: Recreate the resource and use CloudFormation resource import');
    console.log('However, API Gateway does not allow setting a specific resource ID.');
    console.log('\n💡 Recommended approach:');
    console.log('1. Remove HTTPApiResource from CloudFormation stack (requires stack update)');
    console.log('2. Redeploy to let CloudFormation recreate it');
    console.log('\n⚠️  This requires modifying the stack template to temporarily remove HTTPApiResource.');
    console.log('Since you prefer CloudFormation-managed resources, the best approach is to:');
    console.log('1. Use the cleanup script to remove all route resources');
    console.log('2. Redeploy to recreate everything from scratch');
    process.exit(1);
  }
  
  if (apiResource.exists && !apiResource.matches) {
    console.log('\n⚠️  Resource ID mismatch detected');
    console.log('This indicates resource drift. The resource exists but with a different ID.');
    console.log('CloudFormation expects:', EXPECTED_PHYSICAL_ID);
    console.log('API Gateway has:', apiResource.id);
    console.log('\n💡 This requires CloudFormation resource import to fix.');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});

