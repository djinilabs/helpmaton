/**
 * ECR Image Cleanup Utilities
 * 
 * Helper functions for parsing image tags, extracting metadata,
 * and performing operations on ECR images.
 */

/**
 * Parse an image tag to extract metadata
 * @param {string} imageTag - Image tag (e.g., "lancedb-abc123def456" or "lancedb-latest")
 * @returns {Object} Parsed metadata
 */
export function parseImageTag(imageTag) {
  if (!imageTag || typeof imageTag !== 'string') {
    return {
      imageName: null,
      commitSha: null,
      isLatestTag: false,
      isValid: false
    };
  }

  const parts = imageTag.split('-');
  
  if (parts.length < 2) {
    return {
      imageName: parts[0] || null,
      commitSha: null,
      isLatestTag: imageTag === 'latest' || imageTag.endsWith('-latest'),
      isValid: false
    };
  }

  const imageName = parts[0]; // "lancedb"
  const rest = parts.slice(1).join('-'); // "abc123def456" or "latest"
  const isLatestTag = rest === 'latest';
  
  return {
    imageName,
    commitSha: isLatestTag ? null : rest,
    isLatestTag,
    isValid: true
  };
}

/**
 * Calculate the age of an image in hours
 * @param {Date} pushedAt - Image push timestamp
 * @returns {number} Age in hours
 */
export function calculateImageAgeHours(pushedAt) {
  if (!pushedAt) {
    return 0;
  }
  
  const now = new Date();
  const pushDate = pushedAt instanceof Date ? pushedAt : new Date(pushedAt);
  const diffMs = now - pushDate;
  return diffMs / (1000 * 60 * 60); // Convert to hours
}

/**
 * Sort images by push timestamp (newest first)
 * @param {Array} images - Array of image objects with imagePushedAt property
 * @returns {Array} Sorted array
 */
export function sortImagesByDate(images) {
  return [...images].sort((a, b) => {
    const dateA = a.imagePushedAt ? new Date(a.imagePushedAt) : new Date(0);
    const dateB = b.imagePushedAt ? new Date(b.imagePushedAt) : new Date(0);
    return dateB - dateA; // Newest first
  });
}

/**
 * Extract commit SHA from CloudFormation stack tags
 * @param {Array} tags - CloudFormation stack tags
 * @returns {string|null} Commit SHA if found
 */
export function extractCommitShaFromStackTags(tags) {
  if (!Array.isArray(tags)) {
    return null;
  }
  
  const commitTag = tags.find(tag => 
    tag.Key === 'CommitSha' || 
    tag.Key === 'GitCommit' || 
    tag.Key === 'commit'
  );
  
  return commitTag ? commitTag.Value : null;
}

/**
 * Extract PR number from stack name
 * @param {string} stackName - CloudFormation stack name (e.g., "HelpmatonStagingPR123")
 * @param {string} prefix - PR stack prefix (e.g., "HelpmatonStagingPR")
 * @returns {number|null} PR number if found
 */
export function extractPRNumberFromStackName(stackName, prefix) {
  if (!stackName || !prefix || !stackName.startsWith(prefix)) {
    return null;
  }
  
  const prNumberStr = stackName.substring(prefix.length);
  const prNumber = parseInt(prNumberStr, 10);
  
  return isNaN(prNumber) ? null : prNumber;
}

/**
 * Build a unique identifier for an image (using digest or tag)
 * @param {Object} image - ECR image object
 * @returns {string} Unique identifier
 */
export function buildImageIdentifier(image) {
  // Prefer digest as it's immutable
  if (image.imageDigest) {
    return image.imageDigest;
  }
  
  // Fall back to first tag if digest not available
  if (image.imageTags && image.imageTags.length > 0) {
    return image.imageTags[0];
  }
  
  // Last resort: use repository name
  return `${image.repositoryName || 'unknown'}:untagged`;
}

/**
 * Extract image URI components
 * @param {string} imageUri - Full ECR image URI
 * @returns {Object} Parsed URI components
 */
export function parseImageUri(imageUri) {
  if (!imageUri || typeof imageUri !== 'string') {
    return {
      registry: null,
      repository: null,
      tag: null,
      digest: null,
      isValid: false
    };
  }

  // Format: {account}.dkr.ecr.{region}.amazonaws.com/{repository}:{tag}
  // or: {account}.dkr.ecr.{region}.amazonaws.com/{repository}@{digest}
  
  const atIndex = imageUri.indexOf('@');
  const colonIndex = imageUri.lastIndexOf(':');
  
  let digest = null;
  let tag = null;
  let baseUri = imageUri;
  
  if (atIndex !== -1) {
    // Has digest
    digest = imageUri.substring(atIndex + 1);
    baseUri = imageUri.substring(0, atIndex);
  } else if (colonIndex !== -1 && colonIndex > imageUri.indexOf('/')) {
    // Has tag (colon after the first slash)
    tag = imageUri.substring(colonIndex + 1);
    baseUri = imageUri.substring(0, colonIndex);
  }
  
  const slashIndex = baseUri.indexOf('/');
  if (slashIndex === -1) {
    return {
      registry: null,
      repository: null,
      tag,
      digest,
      isValid: false
    };
  }
  
  const registry = baseUri.substring(0, slashIndex);
  const repository = baseUri.substring(slashIndex + 1);
  
  return {
    registry,
    repository,
    tag,
    digest,
    isValid: true
  };
}

/**
 * Check if an image matches a commit SHA
 * @param {Object} image - ECR image object with imageTags
 * @param {string} commitSha - Commit SHA to match
 * @returns {boolean} True if image matches commit SHA
 */
export function imageMatchesCommitSha(image, commitSha) {
  if (!image || !commitSha) {
    return false;
  }
  
  const imageTags = image.imageTags || [];
  
  for (const tag of imageTags) {
    const parsed = parseImageTag(tag);
    if (parsed.isValid && parsed.commitSha) {
      // Match full SHA or prefix (Git short SHA is typically 7-40 chars)
      if (parsed.commitSha === commitSha || 
          commitSha.startsWith(parsed.commitSha) ||
          parsed.commitSha.startsWith(commitSha)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted string (e.g., "1.5 GB")
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Group images by commit SHA
 * @param {Array} images - Array of ECR images
 * @returns {Map} Map of commit SHA to array of images
 */
export function groupImagesByCommitSha(images) {
  const groups = new Map();
  
  for (const image of images) {
    const imageTags = image.imageTags || [];
    
    for (const tag of imageTags) {
      const parsed = parseImageTag(tag);
      if (parsed.isValid && parsed.commitSha) {
        if (!groups.has(parsed.commitSha)) {
          groups.set(parsed.commitSha, []);
        }
        // Only add image once per commit SHA
        if (!groups.get(parsed.commitSha).includes(image)) {
          groups.get(parsed.commitSha).push(image);
        }
      }
    }
  }
  
  return groups;
}

