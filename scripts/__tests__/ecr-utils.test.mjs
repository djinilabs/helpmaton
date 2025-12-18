/**
 * Unit tests for ECR utilities
 */

import { describe, it, expect } from '@jest/globals';
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
} from '../ecr-utils.mjs';

describe('parseImageTag', () => {
  it('should parse valid lancedb image tag with commit SHA', () => {
    const result = parseImageTag('lancedb-abc123def456');
    expect(result).toEqual({
      imageName: 'lancedb',
      commitSha: 'abc123def456',
      isLatestTag: false,
      isValid: true,
    });
  });

  it('should parse latest tag', () => {
    const result = parseImageTag('lancedb-latest');
    expect(result).toEqual({
      imageName: 'lancedb',
      commitSha: null,
      isLatestTag: true,
      isValid: true,
    });
  });

  it('should handle tag with dashes in commit SHA', () => {
    const result = parseImageTag('lancedb-5a1d189aadabb3edb59c8515456aeb30743437e7');
    expect(result).toEqual({
      imageName: 'lancedb',
      commitSha: '5a1d189aadabb3edb59c8515456aeb30743437e7',
      isLatestTag: false,
      isValid: true,
    });
  });

  it('should handle invalid tag format', () => {
    const result = parseImageTag('invalid');
    expect(result.isValid).toBe(false);
  });

  it('should handle null/undefined', () => {
    expect(parseImageTag(null).isValid).toBe(false);
    expect(parseImageTag(undefined).isValid).toBe(false);
  });
});

describe('calculateImageAgeHours', () => {
  it('should calculate age in hours', () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const ageHours = calculateImageAgeHours(oneDayAgo);
    expect(ageHours).toBeGreaterThan(23.9);
    expect(ageHours).toBeLessThan(24.1);
  });

  it('should handle recent images', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const ageHours = calculateImageAgeHours(oneHourAgo);
    expect(ageHours).toBeGreaterThan(0.9);
    expect(ageHours).toBeLessThan(1.1);
  });

  it('should handle string dates', () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const ageHours = calculateImageAgeHours(oneDayAgo);
    expect(ageHours).toBeGreaterThan(23.9);
  });

  it('should return 0 for null/undefined', () => {
    expect(calculateImageAgeHours(null)).toBe(0);
    expect(calculateImageAgeHours(undefined)).toBe(0);
  });
});

describe('sortImagesByDate', () => {
  it('should sort images by date (newest first)', () => {
    const images = [
      { imagePushedAt: new Date('2025-01-01') },
      { imagePushedAt: new Date('2025-01-03') },
      { imagePushedAt: new Date('2025-01-02') },
    ];
    
    const sorted = sortImagesByDate(images);
    
    expect(sorted[0].imagePushedAt.toISOString()).toBe(new Date('2025-01-03').toISOString());
    expect(sorted[1].imagePushedAt.toISOString()).toBe(new Date('2025-01-02').toISOString());
    expect(sorted[2].imagePushedAt.toISOString()).toBe(new Date('2025-01-01').toISOString());
  });

  it('should handle images without dates', () => {
    const images = [
      { imagePushedAt: new Date('2025-01-02') },
      { imagePushedAt: null },
      { imagePushedAt: new Date('2025-01-01') },
    ];
    
    const sorted = sortImagesByDate(images);
    
    expect(sorted[0].imagePushedAt).not.toBeNull();
    expect(sorted[2].imagePushedAt).toBeNull();
  });
});

describe('extractPRNumberFromStackName', () => {
  it('should extract PR number from stack name', () => {
    const prNumber = extractPRNumberFromStackName('HelpmatonStagingPR123', 'HelpmatonStagingPR');
    expect(prNumber).toBe(123);
  });

  it('should return null for production stack', () => {
    const prNumber = extractPRNumberFromStackName('HelpmatonProduction', 'HelpmatonStagingPR');
    expect(prNumber).toBeNull();
  });

  it('should handle invalid PR numbers', () => {
    const prNumber = extractPRNumberFromStackName('HelpmatonStagingPRabc', 'HelpmatonStagingPR');
    expect(prNumber).toBeNull();
  });

  it('should return null for null inputs', () => {
    expect(extractPRNumberFromStackName(null, 'prefix')).toBeNull();
    expect(extractPRNumberFromStackName('stack', null)).toBeNull();
  });
});

describe('buildImageIdentifier', () => {
  it('should use digest when available', () => {
    const image = {
      imageDigest: 'sha256:abc123',
      imageTags: ['lancedb-xyz'],
    };
    
    expect(buildImageIdentifier(image)).toBe('sha256:abc123');
  });

  it('should use first tag when digest not available', () => {
    const image = {
      imageTags: ['lancedb-xyz', 'lancedb-latest'],
    };
    
    expect(buildImageIdentifier(image)).toBe('lancedb-xyz');
  });

  it('should handle untagged images', () => {
    const image = {
      repositoryName: 'helpmaton-lambda-images',
    };
    
    expect(buildImageIdentifier(image)).toBe('helpmaton-lambda-images:untagged');
  });
});

describe('parseImageUri', () => {
  it('should parse full image URI with tag', () => {
    const uri = '123456789.dkr.ecr.eu-west-2.amazonaws.com/helpmaton-lambda-images:lancedb-abc123';
    const result = parseImageUri(uri);
    
    expect(result).toEqual({
      registry: '123456789.dkr.ecr.eu-west-2.amazonaws.com',
      repository: 'helpmaton-lambda-images',
      tag: 'lancedb-abc123',
      digest: null,
      isValid: true,
    });
  });

  it('should parse image URI with digest', () => {
    const uri = '123456789.dkr.ecr.eu-west-2.amazonaws.com/helpmaton-lambda-images@sha256:abc123';
    const result = parseImageUri(uri);
    
    expect(result).toEqual({
      registry: '123456789.dkr.ecr.eu-west-2.amazonaws.com',
      repository: 'helpmaton-lambda-images',
      tag: null,
      digest: 'sha256:abc123',
      isValid: true,
    });
  });

  it('should handle invalid URI', () => {
    const result = parseImageUri('invalid-uri');
    expect(result.isValid).toBe(false);
  });

  it('should handle null/undefined', () => {
    expect(parseImageUri(null).isValid).toBe(false);
    expect(parseImageUri(undefined).isValid).toBe(false);
  });
});

describe('imageMatchesCommitSha', () => {
  it('should match exact commit SHA', () => {
    const image = {
      imageTags: ['lancedb-abc123def456'],
    };
    
    expect(imageMatchesCommitSha(image, 'abc123def456')).toBe(true);
  });

  it('should match commit SHA prefix', () => {
    const image = {
      imageTags: ['lancedb-abc123def456'],
    };
    
    expect(imageMatchesCommitSha(image, 'abc123')).toBe(true);
  });

  it('should match when image has short SHA and comparing to full', () => {
    const image = {
      imageTags: ['lancedb-abc123'],
    };
    
    expect(imageMatchesCommitSha(image, 'abc123def456789')).toBe(true);
  });

  it('should not match different commit SHAs', () => {
    const image = {
      imageTags: ['lancedb-abc123'],
    };
    
    expect(imageMatchesCommitSha(image, 'xyz789')).toBe(false);
  });

  it('should check multiple tags', () => {
    const image = {
      imageTags: ['lancedb-abc123', 'lancedb-latest'],
    };
    
    expect(imageMatchesCommitSha(image, 'abc123')).toBe(true);
  });

  it('should return false for untagged images', () => {
    const image = {
      imageTags: [],
    };
    
    expect(imageMatchesCommitSha(image, 'abc123')).toBe(false);
  });
});

describe('formatBytes', () => {
  it('should format bytes', () => {
    expect(formatBytes(0)).toBe('0 Bytes');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
  });

  it('should format with decimals', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB');
  });
});

describe('groupImagesByCommitSha', () => {
  it('should group images by commit SHA', () => {
    const images = [
      { imageTags: ['lancedb-abc123'] },
      { imageTags: ['lancedb-abc123', 'lancedb-latest'] },
      { imageTags: ['lancedb-xyz789'] },
    ];
    
    const groups = groupImagesByCommitSha(images);
    
    expect(groups.size).toBe(2);
    expect(groups.get('abc123').length).toBe(2);
    expect(groups.get('xyz789').length).toBe(1);
  });

  it('should handle images without valid tags', () => {
    const images = [
      { imageTags: ['lancedb-abc123'] },
      { imageTags: [] },
      { imageTags: ['invalid'] },
    ];
    
    const groups = groupImagesByCommitSha(images);
    
    expect(groups.size).toBe(1);
    expect(groups.get('abc123').length).toBe(1);
  });

  it('should not duplicate images in groups', () => {
    const image = { imageTags: ['lancedb-abc123', 'lancedb-abc123'] };
    const images = [image];
    
    const groups = groupImagesByCommitSha(images);
    
    expect(groups.get('abc123').length).toBe(1);
  });
});
