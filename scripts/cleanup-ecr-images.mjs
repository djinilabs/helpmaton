#!/usr/bin/env node
/**
 * ECR Image Cleanup Script
 * 
 * Safely removes unused Docker images from ECR while protecting:
 * - Images currently deployed in any environment
 * - Production images within retention count
 * - Images from open PRs
 * - Recently pushed images (< 24 hours)
 * 
 * Usage:
 *   node scripts/cleanup-ecr-images.mjs [options]
 * 
 * Options:
 *   --dry-run              Run without deleting images (default: true)
 *   --execute              Actually delete images (disables dry-run)
 *   --retention <number>   Number of production images to keep (default: 15)
 *   --min-age <hours>      Minimum image age in hours (default: 24)
 *   --region <region>      AWS region (default: eu-west-2)
 */

import {
  CloudFormationClient,
  DescribeStacksCommand,
  ListStacksCommand,
  DescribeStackResourcesCommand,
} from '@aws-sdk/client-cloudformation';
import {
  LambdaClient,
  GetFunctionCommand,
} from '@aws-sdk/client-lambda';
import {
  ECRClient,
  DescribeImagesCommand,
  BatchDeleteImageCommand,
} from '@aws-sdk/client-ecr';
import { Octokit } from '@octokit/rest';
import {
  parseImageTag,
  calculateImageAgeHours,
  sortImagesByDate,
  extractPRNumberFromStackName,
  buildImageIdentifier,
  parseImageUri,
  imageMatchesCommitSha,
  formatBytes,
  groupImagesByCommitSha,
} from './ecr-utils.mjs';

// Configuration
const CONFIG = {
  ECR_REPOSITORY_NAME: process.env.ECR_REPOSITORY_NAME || 'helpmaton-lambda-images',
  PRODUCTION_STACK_NAME: process.env.PRODUCTION_STACK_NAME || 'HelpmatonProduction',
  PR_STACK_PREFIX: process.env.PR_STACK_PREFIX || 'HelpmatonStagingPR',
  PRODUCTION_IMAGE_RETENTION_COUNT: parseInt(process.env.PRODUCTION_IMAGE_RETENTION_COUNT || '15', 10),
  MIN_IMAGE_AGE_HOURS: parseInt(process.env.MIN_IMAGE_AGE_HOURS || '24', 10),
  AWS_REGION: process.env.AWS_REGION || 'eu-west-2',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY || 'djinilabs/helpmaton',
  DRY_RUN: process.env.DRY_RUN !== 'false', // Default to true
};

// Parse command line arguments
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  switch (arg) {
    case '--dry-run':
      CONFIG.DRY_RUN = true;
      break;
    case '--execute':
      CONFIG.DRY_RUN = false;
      break;
    case '--retention':
      CONFIG.PRODUCTION_IMAGE_RETENTION_COUNT = parseInt(args[++i], 10);
      break;
    case '--min-age':
      CONFIG.MIN_IMAGE_AGE_HOURS = parseInt(args[++i], 10);
      break;
    case '--region':
      CONFIG.AWS_REGION = args[++i];
      break;
    case '--help':
    case '-h':
      console.log(`
ECR Image Cleanup Script

Usage: node scripts/cleanup-ecr-images.mjs [options]

Options:
  --dry-run              Run without deleting images (default: true)
  --execute              Actually delete images (disables dry-run)
  --retention <number>   Number of production images to keep (default: 15)
  --min-age <hours>      Minimum image age in hours (default: 24)
  --region <region>      AWS region (default: eu-west-2)
  --help, -h             Show this help message

Environment Variables:
  ECR_REPOSITORY_NAME                Name of ECR repository
  PRODUCTION_STACK_NAME              Name of production CloudFormation stack
  PR_STACK_PREFIX                    Prefix for PR stack names
  PRODUCTION_IMAGE_RETENTION_COUNT   Number of production images to keep
  MIN_IMAGE_AGE_HOURS                Minimum image age in hours
  AWS_REGION                         AWS region
  GITHUB_TOKEN                       GitHub API token
  GITHUB_REPOSITORY                  GitHub repository (owner/repo)
  DRY_RUN                            Set to 'false' to execute deletions
      `);
      process.exit(0);
  }
}

// Initialize AWS clients
const cloudformation = new CloudFormationClient({ region: CONFIG.AWS_REGION });
const lambda = new LambdaClient({ region: CONFIG.AWS_REGION });
const ecr = new ECRClient({ region: CONFIG.AWS_REGION });

// Initialize GitHub client if token provided
let octokit = null;
if (CONFIG.GITHUB_TOKEN) {
  octokit = new Octokit({ auth: CONFIG.GITHUB_TOKEN });
}

/**
 * Get all active CloudFormation stacks matching a pattern
 */
async function getActiveStacks(stackNamePattern) {
  console.log(`\n📋 Querying CloudFormation stacks matching: ${stackNamePattern}`);
  
  const stacks = [];
  let nextToken = undefined;
  
  do {
    const command = new ListStacksCommand({
      NextToken: nextToken,
      StackStatusFilter: [
        'CREATE_COMPLETE',
        'UPDATE_COMPLETE',
        'UPDATE_ROLLBACK_COMPLETE',
      ],
    });
    
    const response = await cloudformation.send(command);
    
    if (response.StackSummaries) {
      for (const stack of response.StackSummaries) {
        if (stack.StackName.includes(stackNamePattern)) {
          stacks.push(stack);
        }
      }
    }
    
    nextToken = response.NextToken;
  } while (nextToken);
  
  console.log(`   Found ${stacks.length} active stacks`);
  return stacks;
}

/**
 * Extract image URIs from Lambda functions in a stack
 */
async function extractImageURIsFromStack(stackName) {
  console.log(`\n🔍 Extracting image URIs from stack: ${stackName}`);
  
  const imageUris = new Set();
  
  try {
    // Get stack resources
    const resourcesCommand = new DescribeStackResourcesCommand({ StackName: stackName });
    const resourcesResponse = await cloudformation.send(resourcesCommand);
    
    if (!resourcesResponse.StackResources) {
      console.log(`   No resources found in stack`);
      return imageUris;
    }
    
    // Find Lambda function resources
    const lambdaResources = resourcesResponse.StackResources.filter(
      resource => resource.ResourceType === 'AWS::Lambda::Function'
    );
    
    console.log(`   Found ${lambdaResources.length} Lambda functions`);
    
    // Get function configuration for each Lambda
    for (const resource of lambdaResources) {
      try {
        const functionCommand = new GetFunctionCommand({
          FunctionName: resource.PhysicalResourceId,
        });
        
        const functionResponse = await lambda.send(functionCommand);
        const config = functionResponse.Configuration;
        
        // Check if function uses container image
        if (config.PackageType === 'Image' && config.ImageUri) {
          imageUris.add(config.ImageUri);
          console.log(`   ✓ ${resource.LogicalResourceId}: ${config.ImageUri}`);
        }
      } catch (error) {
        console.warn(`   ⚠️  Could not get function ${resource.LogicalResourceId}: ${error.message}`);
      }
    }
  } catch (error) {
    console.error(`   ❌ Error extracting images from ${stackName}: ${error.message}`);
  }
  
  return imageUris;
}

/**
 * Get all images from ECR repository
 */
async function getECRImages(repositoryName) {
  console.log(`\n📦 Querying ECR repository: ${repositoryName}`);
  
  const images = [];
  let nextToken = undefined;
  
  do {
    const command = new DescribeImagesCommand({
      repositoryName,
      nextToken,
      maxResults: 1000,
    });
    
    const response = await ecr.send(command);
    
    if (response.imageDetails) {
      images.push(...response.imageDetails);
    }
    
    nextToken = response.nextToken;
  } while (nextToken);
  
  console.log(`   Found ${images.length} images`);
  
  // Calculate total size
  const totalSize = images.reduce((sum, img) => sum + (img.imageSizeInBytes || 0), 0);
  console.log(`   Total size: ${formatBytes(totalSize)}`);
  
  return images;
}

/**
 * Check if a PR is open via GitHub API
 */
async function isPROpen(prNumber) {
  if (!octokit) {
    console.warn(`   ⚠️  GitHub token not provided, cannot check PR status`);
    return true; // Assume open to be safe
  }
  
  try {
    const [owner, repo] = CONFIG.GITHUB_REPOSITORY.split('/');
    const { data: pr } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });
    
    return pr.state === 'open';
  } catch (error) {
    if (error.status === 404) {
      return false; // PR doesn't exist or was deleted
    }
    console.warn(`   ⚠️  Error checking PR ${prNumber}: ${error.message}`);
    return true; // Assume open to be safe
  }
}

/**
 * Build protected images set from all active stacks
 */
async function buildProtectedImagesSet() {
  console.log(`\n🛡️  Building protected images set...`);
  
  const protectedImages = new Set();
  const productionImages = new Set();
  const prImages = new Map(); // PR number -> Set of image identifiers
  
  // Get production stack images
  console.log(`\n   Checking production stack: ${CONFIG.PRODUCTION_STACK_NAME}`);
  try {
    const prodImageUris = await extractImageURIsFromStack(CONFIG.PRODUCTION_STACK_NAME);
    for (const uri of prodImageUris) {
      const parsed = parseImageUri(uri);
      if (parsed.tag) {
        protectedImages.add(parsed.tag);
        productionImages.add(parsed.tag);
      }
      if (parsed.digest) {
        protectedImages.add(parsed.digest);
        productionImages.add(parsed.digest);
      }
    }
    console.log(`   Production images protected: ${productionImages.size}`);
  } catch (error) {
    console.error(`   ❌ Error processing production stack: ${error.message}`);
  }
  
  // Get PR stack images
  const prStacks = await getActiveStacks(CONFIG.PR_STACK_PREFIX);
  console.log(`\n   Checking ${prStacks.length} PR stacks...`);
  
  for (const stack of prStacks) {
    const prNumber = extractPRNumberFromStackName(stack.StackName, CONFIG.PR_STACK_PREFIX);
    if (prNumber) {
      const prImageUris = await extractImageURIsFromStack(stack.StackName);
      const prImageSet = new Set();
      
      for (const uri of prImageUris) {
        const parsed = parseImageUri(uri);
        if (parsed.tag) {
          protectedImages.add(parsed.tag);
          prImageSet.add(parsed.tag);
        }
        if (parsed.digest) {
          protectedImages.add(parsed.digest);
          prImageSet.add(parsed.digest);
        }
      }
      
      if (prImageSet.size > 0) {
        prImages.set(prNumber, prImageSet);
      }
    }
  }
  
  console.log(`\n   ✅ Protected images: ${protectedImages.size}`);
  console.log(`   📊 Production: ${productionImages.size}, PR environments: ${prImages.size}`);
  
  return { protectedImages, productionImages, prImages };
}

/**
 * Get production image history (last N deployments)
 */
async function getProductionImageHistory() {
  console.log(`\n📜 Getting production image history...`);
  
  const productionCommitShas = [];
  
  try {
    // Get production stack details
    const command = new DescribeStacksCommand({
      StackName: CONFIG.PRODUCTION_STACK_NAME,
    });
    const response = await cloudformation.send(command);
    
    if (response.Stacks && response.Stacks.length > 0) {
      const stack = response.Stacks[0];
      
      // Try to extract commit SHA from stack tags or outputs
      if (stack.Tags) {
        for (const tag of stack.Tags) {
          if (tag.Key === 'CommitSha' || tag.Key === 'GitCommit') {
            productionCommitShas.push(tag.Value);
          }
        }
      }
      
      // Also get current image URIs and extract commit SHAs
      const imageUris = await extractImageURIsFromStack(CONFIG.PRODUCTION_STACK_NAME);
      for (const uri of imageUris) {
        const parsed = parseImageUri(uri);
        if (parsed.tag) {
          const tagParsed = parseImageTag(parsed.tag);
          if (tagParsed.commitSha) {
            productionCommitShas.push(tagParsed.commitSha);
          }
        }
      }
    }
  } catch (error) {
    console.error(`   ❌ Error getting production history: ${error.message}`);
  }
  
  console.log(`   Found ${productionCommitShas.length} production commit SHAs`);
  return productionCommitShas;
}

/**
 * Determine if an image can be deleted
 */
function canDeleteImage(image, protectedImages, productionCommitShas, openPRNumbers) {
  const identifier = buildImageIdentifier(image);
  const imageTags = image.imageTags || [];
  const imageDigest = image.imageDigest;
  
  // CRITICAL: Check if currently deployed (check all tags and digest)
  if (protectedImages.has(imageDigest)) {
    return { canDelete: false, reason: 'Currently deployed (by digest)' };
  }
  for (const tag of imageTags) {
    if (protectedImages.has(tag)) {
      return { canDelete: false, reason: `Currently deployed (tag: ${tag})` };
    }
  }
  
  // SAFETY: Check minimum age
  const ageHours = calculateImageAgeHours(image.imagePushedAt);
  if (ageHours < CONFIG.MIN_IMAGE_AGE_HOURS) {
    return { canDelete: false, reason: `Too recent (${ageHours.toFixed(1)}h old, min ${CONFIG.MIN_IMAGE_AGE_HOURS}h)` };
  }
  
  // Handle untagged images
  if (imageTags.length === 0) {
    // Untagged images older than min age can be deleted
    return { canDelete: true, reason: `Untagged image (${ageHours.toFixed(1)}h old)` };
  }
  
  // Check each tag
  for (const imageTag of imageTags) {
    // Parse image tag
    const parsed = parseImageTag(imageTag);
    
    // Keep latest tags
    if (parsed.isLatestTag) {
      return { canDelete: false, reason: 'Latest tag' };
    }
    
    // Check if it's a production image
    if (parsed.commitSha && productionCommitShas.includes(parsed.commitSha)) {
      // Check if within retention count
      const index = productionCommitShas.indexOf(parsed.commitSha);
      if (index < CONFIG.PRODUCTION_IMAGE_RETENTION_COUNT) {
        return { canDelete: false, reason: `Production image within retention (${index + 1}/${CONFIG.PRODUCTION_IMAGE_RETENTION_COUNT})` };
      } else {
        return { canDelete: true, reason: `Production image outside retention (${index + 1}/${CONFIG.PRODUCTION_IMAGE_RETENTION_COUNT})` };
      }
    }
    
    // If any tag has an unknown pattern, be conservative and keep
    if (!parsed.isValid || !parsed.commitSha) {
      return { canDelete: false, reason: `Unknown pattern in tag: ${imageTag} (keeping for safety)` };
    }
  }
  
  // If we get here, all tags are valid with commit SHAs, not in production, and old enough
  return { canDelete: true, reason: `Old image (${ageHours.toFixed(1)}h old, not in use)` };
}

/**
 * Delete images from ECR
 */
async function deleteImages(repositoryName, imageIds) {
  if (imageIds.length === 0) {
    return { successCount: 0, failureCount: 0 };
  }
  
  console.log(`\n🗑️  Deleting ${imageIds.length} images...`);
  
  let successCount = 0;
  let failureCount = 0;
  
  // Batch delete (max 100 per request)
  const batchSize = 100;
  for (let i = 0; i < imageIds.length; i += batchSize) {
    const batch = imageIds.slice(i, i + batchSize);
    
    try {
      const command = new BatchDeleteImageCommand({
        repositoryName,
        imageIds: batch,
      });
      
      const response = await ecr.send(command);
      
      successCount += response.imageIds?.length || 0;
      failureCount += response.failures?.length || 0;
      
      if (response.failures && response.failures.length > 0) {
        console.error(`   ❌ Failed to delete ${response.failures.length} images:`);
        for (const failure of response.failures) {
          console.error(`      ${failure.imageId.imageTag || failure.imageId.imageDigest}: ${failure.failureReason}`);
        }
      }
    } catch (error) {
      console.error(`   ❌ Error deleting batch: ${error.message}`);
      failureCount += batch.length;
    }
  }
  
  return { successCount, failureCount };
}

/**
 * Generate cleanup report
 */
function generateReport(stats) {
  const mode = CONFIG.DRY_RUN ? 'DRY RUN' : 'EXECUTION';
  
  console.log(`
╔════════════════════════════════════════════════════════════════════
║ ECR Image Cleanup Report
╚════════════════════════════════════════════════════════════════════

Repository: ${CONFIG.ECR_REPOSITORY_NAME}
Execution Time: ${new Date().toISOString()}
Mode: ${mode}

Summary:
────────────────────────────────────────────────────────────────────
  Total images:           ${stats.totalImages}
  Protected (in use):     ${stats.protectedCount}
    - Production:         ${stats.productionCount}
    - PR environments:    ${stats.prEnvironmentCount}
  
  Deletion candidates:    ${stats.deletionCandidates}
    - Old PR images:      ${stats.oldPRImages}
    - Old prod images:    ${stats.oldProdImages}
    - Other old images:   ${stats.otherOldImages}
  
  ${CONFIG.DRY_RUN ? 'Would delete:' : 'Deleted:'}          ${stats.deletedCount}
  Failed:                 ${stats.failedCount}

Protected Images:
────────────────────────────────────────────────────────────────────`);
  
  if (stats.protectedImagesList.length > 0) {
    for (const img of stats.protectedImagesList.slice(0, 10)) {
      console.log(`  • ${img}`);
    }
    if (stats.protectedImagesList.length > 10) {
      console.log(`  ... and ${stats.protectedImagesList.length - 10} more`);
    }
  } else {
    console.log(`  (none)`);
  }
  
  console.log(`
Deletion Candidates:
────────────────────────────────────────────────────────────────────`);
  
  if (stats.deletionCandidatesList.length > 0) {
    for (const candidate of stats.deletionCandidatesList.slice(0, 20)) {
      console.log(`  • ${candidate.tag} - ${candidate.reason}`);
    }
    if (stats.deletionCandidatesList.length > 20) {
      console.log(`  ... and ${stats.deletionCandidatesList.length - 20} more`);
    }
  } else {
    console.log(`  (none)`);
  }
  
  if (stats.warnings.length > 0) {
    console.log(`
Warnings:
────────────────────────────────────────────────────────────────────`);
    for (const warning of stats.warnings) {
      console.log(`  ⚠️  ${warning}`);
    }
  }
  
  console.log(`
Configuration:
────────────────────────────────────────────────────────────────────
  Production retention:   ${CONFIG.PRODUCTION_IMAGE_RETENTION_COUNT} images
  Minimum image age:      ${CONFIG.MIN_IMAGE_AGE_HOURS} hours
  Region:                 ${CONFIG.AWS_REGION}
  Dry run:                ${CONFIG.DRY_RUN}

════════════════════════════════════════════════════════════════════
`);
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Starting ECR image cleanup...');
  console.log(`📝 Configuration:`);
  console.log(`   Repository: ${CONFIG.ECR_REPOSITORY_NAME}`);
  console.log(`   Production stack: ${CONFIG.PRODUCTION_STACK_NAME}`);
  console.log(`   PR stack prefix: ${CONFIG.PR_STACK_PREFIX}`);
  console.log(`   Production retention: ${CONFIG.PRODUCTION_IMAGE_RETENTION_COUNT} images`);
  console.log(`   Minimum age: ${CONFIG.MIN_IMAGE_AGE_HOURS} hours`);
  console.log(`   Region: ${CONFIG.AWS_REGION}`);
  console.log(`   Mode: ${CONFIG.DRY_RUN ? 'DRY RUN' : 'EXECUTION'}`);
  
  const startTime = Date.now();
  const stats = {
    totalImages: 0,
    protectedCount: 0,
    productionCount: 0,
    prEnvironmentCount: 0,
    deletionCandidates: 0,
    oldPRImages: 0,
    oldProdImages: 0,
    otherOldImages: 0,
    deletedCount: 0,
    failedCount: 0,
    protectedImagesList: [],
    deletionCandidatesList: [],
    warnings: [],
  };
  
  try {
    // Build protected images set
    const { protectedImages, productionImages, prImages } = await buildProtectedImagesSet();
    stats.protectedCount = protectedImages.size;
    stats.productionCount = productionImages.size;
    stats.prEnvironmentCount = prImages.size;
    stats.protectedImagesList = Array.from(protectedImages);
    
    // Get production image history
    const productionCommitShas = await getProductionImageHistory();
    
    // Get open PR numbers if GitHub token available
    const openPRNumbers = new Set();
    if (octokit) {
      console.log(`\n📋 Checking open PRs...`);
      try {
        const [owner, repo] = CONFIG.GITHUB_REPOSITORY.split('/');
        const { data: prs } = await octokit.pulls.list({
          owner,
          repo,
          state: 'open',
          per_page: 100,
        });
        
        for (const pr of prs) {
          openPRNumbers.add(pr.number);
        }
        console.log(`   Found ${openPRNumbers.size} open PRs`);
      } catch (error) {
        console.warn(`   ⚠️  Error fetching open PRs: ${error.message}`);
        stats.warnings.push('Could not fetch open PRs from GitHub');
      }
    }
    
    // Get all images from ECR
    const allImages = await getECRImages(CONFIG.ECR_REPOSITORY_NAME);
    stats.totalImages = allImages.length;
    
    // Analyze each image
    console.log(`\n🔍 Analyzing images...`);
    const imagesToDelete = [];
    
    for (const image of allImages) {
      const decision = canDeleteImage(image, protectedImages, productionCommitShas, openPRNumbers);
      
      if (decision.canDelete) {
        stats.deletionCandidates++;
        
        // Build image identifier for deletion
        const imageId = {
          imageDigest: image.imageDigest,
        };
        // Include all tags if available
        if (image.imageTags && image.imageTags.length > 0) {
          imageId.imageTag = image.imageTags[0]; // ECR API uses single tag for deletion
        }
        imagesToDelete.push(imageId);
        
        // Add to report list
        const displayTag = image.imageTags && image.imageTags.length > 0 
          ? image.imageTags.join(', ') 
          : `<untagged: ${image.imageDigest?.substring(0, 12)}>`;
        stats.deletionCandidatesList.push({
          tag: displayTag,
          reason: decision.reason,
        });
        
        // Categorize
        if (decision.reason.includes('Production')) {
          stats.oldProdImages++;
        } else if (decision.reason.includes('PR')) {
          stats.oldPRImages++;
        } else {
          stats.otherOldImages++;
        }
      }
    }
    
    console.log(`   ✅ Analysis complete`);
    console.log(`   📊 Deletion candidates: ${imagesToDelete.length}`);
    
    // Delete images (or simulate in dry-run mode)
    if (imagesToDelete.length > 0) {
      if (CONFIG.DRY_RUN) {
        console.log(`\n🔍 DRY RUN: Would delete ${imagesToDelete.length} images`);
        stats.deletedCount = imagesToDelete.length;
      } else {
        const result = await deleteImages(CONFIG.ECR_REPOSITORY_NAME, imagesToDelete);
        stats.deletedCount = result.successCount;
        stats.failedCount = result.failureCount;
        console.log(`   ✅ Successfully deleted: ${result.successCount}`);
        if (result.failureCount > 0) {
          console.log(`   ❌ Failed to delete: ${result.failureCount}`);
        }
      }
    } else {
      console.log(`\n✨ No images to delete`);
    }
    
    // Generate report
    generateReport(stats);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Cleanup completed in ${duration}s\n`);
    
  } catch (error) {
    console.error(`\n❌ Error during cleanup: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run main function
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

