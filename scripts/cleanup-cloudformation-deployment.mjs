#!/usr/bin/env node
/**
 * Complete cleanup script for CloudFormation API Gateway route resources
 * 
 * This script handles the entire cleanup process:
 * - Checks stack status and handles rollbacks
 * - Downloads the current template
 * - Removes route resources
 * - Verifies REST API is preserved
 * - Deploys the cleaned template
 * - Waits for deployment to complete
 * 
 * Usage:
 *   node scripts/cleanup-cloudformation-deployment.mjs <stack-name> <region>
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { execSync } from 'child_process';

const [stackName, region] = process.argv.slice(2);

if (!stackName || !region) {
  console.error('Usage: node scripts/cleanup-cloudformation-deployment.mjs <stack-name> <region>');
  process.exit(1);
}

const TEMP_CURRENT_TEMPLATE = '/tmp/current-template.json';
const TEMP_CLEANED_TEMPLATE = '/tmp/cleaned-template.json';
const MAX_WAIT = 1800; // 30 minutes

function execCommand(command, options = {}) {
  try {
    return execSync(command, { 
      encoding: 'utf8', 
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options 
    });
  } catch (error) {
    if (options.allowFailure) {
      return error.stdout || error.stderr || '';
    }
    throw error;
  }
}

function getStackStatus() {
  try {
    const result = execCommand(
      `aws cloudformation describe-stacks --stack-name "${stackName}" --region ${region} --query 'Stacks[0].StackStatus' --output text`,
      { silent: true, allowFailure: true }
    );
    return result.trim();
  } catch {
    return 'NOT_FOUND';
  }
}

function waitForRollbackComplete() {
  console.log('⏳ Stack is in rollback state, waiting for rollback to complete...');
  try {
    execCommand(
      `aws cloudformation wait stack-rollback-complete --stack-name "${stackName}" --region ${region}`,
      { allowFailure: true }
    );
    console.log('✅ Rollback complete');
  } catch {
    console.log('⚠️  Rollback wait completed (may have timed out or already complete)');
  }
}

function downloadTemplate() {
  console.log('📥 Downloading current CloudFormation template...');
  try {
    execCommand(
      `aws cloudformation get-template --stack-name "${stackName}" --region ${region} --query 'TemplateBody' --output json > ${TEMP_CURRENT_TEMPLATE}`,
      { silent: true }
    );
    return true;
  } catch (error) {
    console.error('⚠️  Could not download template, stack may not exist or be in invalid state');
    return false;
  }
}

function cleanupTemplate() {
  console.log('🔧 Removing API Gateway route resources from template...');
  try {
    execCommand(`node scripts/cleanup-cloudformation-routes.mjs ${TEMP_CURRENT_TEMPLATE} ${TEMP_CLEANED_TEMPLATE}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to cleanup template:', error.message);
    return false;
  }
}

function verifyRestApi() {
  try {
    execCommand(`node scripts/verify-rest-api-preserved.mjs ${TEMP_CURRENT_TEMPLATE} ${TEMP_CLEANED_TEMPLATE}`);
    return true;
  } catch (error) {
    console.error('❌ REST API verification failed. Aborting deployment.');
    return false;
  }
}

function countRouteResources() {
  try {
    const result = execCommand(
      `node scripts/count-route-resources.mjs ${TEMP_CURRENT_TEMPLATE}`,
      { silent: true }
    );
    return parseInt(result.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function uploadTemplateToS3(templatePath) {
  // Generate a unique S3 key for this template
  const timestamp = Date.now();
  const s3Key = `cloudformation-templates/cleanup-${stackName}-${timestamp}.json`;
  
  // Try to use HELPMATON_S3_BUCKET from environment if available
  let bucketName = process.env.HELPMATON_S3_BUCKET;
  
  // If not available, try to construct default CloudFormation bucket
  if (!bucketName) {
    let accountId;
    try {
      accountId = execCommand(
        `aws sts get-caller-identity --query Account --output text --region ${region}`,
        { silent: true }
      ).trim();
      // AWS CloudFormation uses: aws-cloudformation-templates-{region}-{account-id}
      bucketName = `aws-cloudformation-templates-${region}-${accountId}`;
    } catch (error) {
      console.error('❌ Failed to get AWS account ID:', error.message);
      return null;
    }
  }
  
  console.log(`📤 Uploading template to S3: s3://${bucketName}/${s3Key}`);
  
  // Check if bucket exists, create if it doesn't
  let bucketExists = false;
  try {
    execCommand(
      `aws s3api head-bucket --bucket "${bucketName}" --region ${region}`,
      { silent: true }
    );
    bucketExists = true;
  } catch {
    // Bucket doesn't exist, try to create it
    console.log(`   Creating S3 bucket: ${bucketName}`);
    try {
      if (region === 'us-east-1') {
        // us-east-1 doesn't need LocationConstraint
        execCommand(
          `aws s3api create-bucket --bucket "${bucketName}" --region ${region}`,
          { silent: true }
        );
      } else {
        execCommand(
          `aws s3api create-bucket --bucket "${bucketName}" --region ${region} --create-bucket-configuration LocationConstraint=${region}`,
          { silent: true }
        );
      }
      console.log(`   ✅ Bucket created successfully`);
      bucketExists = true;
    } catch (createError) {
      const errorMsg = (createError.stdout || createError.stderr || createError.message || '').toString();
      console.error(`   ❌ Failed to create bucket: ${errorMsg}`);
      console.error('   You may need to create the bucket manually or provide HELPMATON_S3_BUCKET');
      return null;
    }
  }
  
  if (!bucketExists) {
    console.error('   ❌ Bucket does not exist and could not be created');
    return null;
  }
  
  try {
    // Upload to S3
    execCommand(
      `aws s3 cp "${templatePath}" "s3://${bucketName}/${s3Key}" --region ${region}`,
      { silent: true }
    );
    
    // Get the S3 URL
    const templateUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${s3Key}`;
    console.log(`✅ Template uploaded successfully`);
    return templateUrl;
  } catch (error) {
    const errorMsg = (error.stdout || error.stderr || error.message || '').toString();
    console.error(`❌ Failed to upload template to S3: ${errorMsg}`);
    console.error('   Attempted bucket:', bucketName);
    console.error('   Make sure the bucket exists and you have S3 upload permissions');
    return null;
  }
}

function deployCleanedTemplate() {
  console.log('🚀 Deploying cleaned template (without route resources)...');
  
  // Check template size
  const templateStats = statSync(TEMP_CLEANED_TEMPLATE);
  const templateSize = templateStats.size;
  const MAX_TEMPLATE_BODY_SIZE = 51200; // 50KB limit for --template-body
  
  let templateArg;
  
  if (templateSize > MAX_TEMPLATE_BODY_SIZE) {
    console.log(`📏 Template size (${templateSize} bytes) exceeds limit (${MAX_TEMPLATE_BODY_SIZE} bytes), uploading to S3...`);
    const templateUrl = uploadTemplateToS3(TEMP_CLEANED_TEMPLATE);
    if (!templateUrl) {
      console.error('❌ Failed to upload template to S3. Cannot proceed with deployment.');
      return false;
    }
    templateArg = `--template-url "${templateUrl}"`;
  } else {
    templateArg = `--template-body file://${TEMP_CLEANED_TEMPLATE}`;
  }
  
  // Check if the cleaned template has parameters
  let parametersArg = '';
  try {
    const templateContent = readFileSync(TEMP_CLEANED_TEMPLATE, 'utf8');
    const template = JSON.parse(templateContent);
    const parameters = template.Parameters || {};
    
    // Only use UsePreviousValue for parameters that exist in the cleaned template
    if (Object.keys(parameters).length > 0) {
      const paramKeys = Object.keys(parameters);
      const paramList = paramKeys.map(key => `ParameterKey=${key},UsePreviousValue=true`).join(' ');
      parametersArg = `--parameters ${paramList}`;
    }
  } catch (error) {
    console.log('⚠️  Could not parse template to check parameters, proceeding without parameters');
  }
  
  try {
    const command = `aws cloudformation update-stack --stack-name "${stackName}" ${templateArg} --capabilities CAPABILITY_IAM --region ${region}${parametersArg ? ' ' + parametersArg : ''}`;
    execCommand(command, { silent: true });
    return { success: true, updateInitiated: true };
  } catch (error) {
    const errorOutput = (error.stdout || error.stderr || error.message || '').toString();
    if (errorOutput.includes('No updates are to be performed')) {
      console.log('ℹ️  No updates needed (template is identical), skipping deployment');
      return { success: true, updateInitiated: false };
    }
    console.error('❌ Failed to initiate stack update:');
    console.error(errorOutput);
    return { success: false, updateInitiated: false };
  }
}

async function waitForDeployment() {
  console.log('⏳ Waiting for cleanup deployment to complete...');
  
  let elapsed = 0;
  while (elapsed < MAX_WAIT) {
    const status = getStackStatus();
    
    if (status === 'UPDATE_COMPLETE') {
      console.log('✅ Cleanup deployment completed successfully');
      return true;
    }
    
    if (status.includes('ROLLBACK') || status.includes('FAILED')) {
      console.error(`❌ Cleanup deployment failed. Stack status: ${status}`);
      
      // Get error details
      console.log('📋 Recent stack events with failures:');
      try {
        execCommand(
          `aws cloudformation describe-stack-events --stack-name "${stackName}" --region ${region} --max-items 20 --query 'StackEvents[?ResourceStatus==\`CREATE_FAILED\` || ResourceStatus==\`UPDATE_FAILED\` || ResourceStatus==\`DELETE_FAILED\`].{Time:Timestamp,Status:ResourceStatus,Reason:ResourceStatusReason,LogicalId:LogicalResourceId}' --output table`,
          { allowFailure: true }
        );
      } catch {
        // Ignore errors in getting events
      }
      
      return false;
    }
    
    // Wait 10 seconds
    await new Promise(resolve => setTimeout(resolve, 10000));
    elapsed += 10;
    console.log(`  Still waiting... (${elapsed}s elapsed, status: ${status})`);
  }
  
  // Final status check
  const finalStatus = getStackStatus();
  if (finalStatus !== 'UPDATE_COMPLETE') {
    if (finalStatus.includes('ROLLBACK') || finalStatus.includes('FAILED')) {
      console.error(`❌ Cleanup deployment failed. Final stack status: ${finalStatus}`);
      return false;
    } else {
      console.log(`⚠️  Cleanup deployment still in progress (status: ${finalStatus}), but timeout reached. Proceeding with caution...`);
      return true; // Continue anyway
    }
  }
  
  return true;
}

async function main() {
  console.log('🧹 Step 1: Removing all API Gateway route resources from stack');
  
  // Check if stack exists and is in a rollback state
  let stackStatus = getStackStatus();
  
  if (stackStatus === 'NOT_FOUND') {
    console.log('ℹ️  Stack doesn\'t exist yet, skipping cleanup');
    process.exit(0);
  }
  
  console.log(`📋 Current stack status: ${stackStatus}`);
  
  // If stack is in rollback, wait for it to complete
  if (stackStatus.includes('ROLLBACK')) {
    waitForRollbackComplete();
  }
  
  // Get the current template
  if (!downloadTemplate()) {
    process.exit(0);
  }
  
  // Create a modified template with all route resources removed
  if (!cleanupTemplate()) {
    console.error('❌ Failed to cleanup template');
    process.exit(1);
  }
  
  // Verify cleaned template exists
  if (!existsSync(TEMP_CLEANED_TEMPLATE)) {
    console.error('❌ Cleaned template not created. Aborting deployment.');
    process.exit(1);
  }
  
  // Verify we're not removing the REST API itself
  if (!verifyRestApi()) {
    process.exit(1);
  }
  
  // Check if there are any resources to remove
  const resourcesToRemoveCount = countRouteResources();
  
  if (resourcesToRemoveCount === 0) {
    console.log('ℹ️  No route resources to remove, skipping cleanup deployment');
    process.exit(0);
  }
  
  // Deploy the cleaned template
  const deployResult = deployCleanedTemplate();
  if (!deployResult.success) {
    console.error('❌ Cleanup step failed. Aborting deployment.');
    process.exit(1);
  }
  
  // Only wait for deployment if an update was actually initiated
  if (deployResult.updateInitiated) {
    if (!(await waitForDeployment())) {
      console.error('❌ Cleanup step failed. Aborting deployment.');
      process.exit(1);
    }
  } else {
    console.log('ℹ️  No deployment was initiated, skipping wait');
  }
  
  console.log('✅ Cleanup step complete');
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Unexpected error:', error.message);
  process.exit(1);
});

