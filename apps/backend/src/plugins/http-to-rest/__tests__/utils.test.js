/**
 * Unit tests for utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  parseRouteKey,
  convertPathParameters,
  hasWildcard,
  convertWildcardPath,
  splitPath,
  generateResourceId,
  generateMethodId,
  getAllHttpMethods,
  sanitizeResourceName,
  isIamAuthorizer,
} from '../utils.js';

describe('Route Parsing', () => {
  describe('parseRouteKey', () => {
    it('should parse simple GET route', () => {
      const result = parseRouteKey('GET /api/usage');
      expect(result).toEqual({
        method: 'GET',
        path: '/api/usage',
      });
    });

    it('should parse POST route with path parameters', () => {
      const result = parseRouteKey('POST /api/webhook/:workspaceId/:agentId/:key');
      expect(result).toEqual({
        method: 'POST',
        path: '/api/webhook/:workspaceId/:agentId/:key',
      });
    });

    it('should parse ANY route with wildcard', () => {
      const result = parseRouteKey('ANY /api/auth/*');
      expect(result).toEqual({
        method: 'ANY',
        path: '/api/auth/*',
      });
    });

    it('should parse catch-all route', () => {
      const result = parseRouteKey('ANY /*');
      expect(result).toEqual({
        method: 'ANY',
        path: '/*',
      });
    });

    it('should handle lowercase method', () => {
      const result = parseRouteKey('get /api/test');
      expect(result).toEqual({
        method: 'GET',
        path: '/api/test',
      });
    });

    it('should throw error for invalid format', () => {
      expect(() => parseRouteKey('INVALID')).toThrow('Invalid route key format');
    });
  });

  describe('convertPathParameters', () => {
    it('should convert single path parameter', () => {
      const result = convertPathParameters('/api/user/:userId');
      expect(result).toBe('/api/user/{userId}');
    });

    it('should convert multiple path parameters', () => {
      const result = convertPathParameters('/api/webhook/:workspaceId/:agentId/:key');
      expect(result).toBe('/api/webhook/{workspaceId}/{agentId}/{key}');
    });

    it('should handle path without parameters', () => {
      const result = convertPathParameters('/api/usage');
      expect(result).toBe('/api/usage');
    });

    it('should handle root path', () => {
      const result = convertPathParameters('/');
      expect(result).toBe('/');
    });
  });

  describe('hasWildcard', () => {
    it('should detect wildcard at end', () => {
      expect(hasWildcard('/api/auth/*')).toBe(true);
    });

    it('should detect catch-all wildcard', () => {
      expect(hasWildcard('/*')).toBe(true);
    });

    it('should detect wildcard in middle', () => {
      expect(hasWildcard('/api/*/test')).toBe(true);
    });

    it('should return false for paths without wildcard', () => {
      expect(hasWildcard('/api/usage')).toBe(false);
    });

    it('should return false for path with parameters', () => {
      expect(hasWildcard('/api/user/:userId')).toBe(false);
    });
  });

  describe('convertWildcardPath', () => {
    it('should convert catch-all wildcard', () => {
      const result = convertWildcardPath('/*');
      expect(result).toBe('{proxy+}');
    });

    it('should convert wildcard at end of path', () => {
      const result = convertWildcardPath('/api/auth/*');
      expect(result).toBe('/api/auth/{proxy+}');
    });

    it('should convert standalone wildcard', () => {
      const result = convertWildcardPath('*');
      expect(result).toBe('{proxy+}');
    });
  });

  describe('splitPath', () => {
    it('should split simple path', () => {
      const result = splitPath('/api/usage');
      expect(result).toEqual(['api', 'usage']);
    });

    it('should split path with parameters', () => {
      const result = splitPath('/api/webhook/:workspaceId/:agentId');
      expect(result).toEqual(['api', 'webhook', ':workspaceId', ':agentId']);
    });

    it('should handle root path', () => {
      const result = splitPath('/');
      expect(result).toEqual([]);
    });

    it('should handle path without leading slash', () => {
      const result = splitPath('api/usage');
      expect(result).toEqual(['api', 'usage']);
    });

    it('should handle wildcard path', () => {
      const result = splitPath('/*');
      expect(result).toEqual([]);
    });
  });

  describe('generateResourceId', () => {
    it('should generate resource ID from segment', () => {
      const result = generateResourceId('api', 0);
      expect(result).toBe('Api');
    });

    it('should generate resource ID from path parameter', () => {
      const result = generateResourceId('{workspaceId}', 0);
      expect(result).toBe('WorkspaceId');
    });

    it('should preserve casing in path parameters', () => {
      const result = generateResourceId('{workspaceID}', 0);
      expect(result).toBe('WorkspaceID');
    });

    it('should handle mixed case segments', () => {
      const result = generateResourceId('workspaceId', 0);
      expect(result).toBe('WorkspaceId');
    });

    it('should handle segments with underscores', () => {
      const result = generateResourceId('workspace_id', 0);
      expect(result).toBe('WorkspaceId');
    });

    it('should generate resource ID from proxy segment', () => {
      const result = generateResourceId('{proxy+}', 0);
      expect(result).toBe('Proxy');
    });

    it('should handle empty segment', () => {
      const result = generateResourceId('', 0);
      expect(result).toBe('Segment0');
    });
  });

  describe('generateMethodId', () => {
    it('should generate method ID', () => {
      const result = generateMethodId('HTTPApiResource', 'GET');
      expect(result).toBe('HTTPApiResourceGETMethod');
    });

    it('should generate method ID for POST', () => {
      const result = generateMethodId('HTTPApiUsageResource', 'POST');
      expect(result).toBe('HTTPApiUsageResourcePOSTMethod');
    });
  });

  describe('getAllHttpMethods', () => {
    it('should return all HTTP methods', () => {
      const result = getAllHttpMethods();
      expect(result).toEqual(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);
    });
  });

  describe('sanitizeResourceName', () => {
    it('should remove non-alphanumeric characters', () => {
      const result = sanitizeResourceName('test-resource_name.123');
      expect(result).toBe('testresourcename123');
    });

    it('should preserve alphanumeric characters', () => {
      const result = sanitizeResourceName('TestResource123');
      expect(result).toBe('TestResource123');
    });

    it('should handle empty string', () => {
      const result = sanitizeResourceName('');
      expect(result).toBe('');
    });

    it('should handle string with only special characters', () => {
      const result = sanitizeResourceName('!@#$%^&*()');
      expect(result).toBe('');
    });

    it('should handle mixed case and numbers', () => {
      const result = sanitizeResourceName('MyResource-123_test');
      expect(result).toBe('MyResource123test');
    });
  });

  describe('isIamAuthorizer', () => {
    it('should return true for IAM authorizer', () => {
      const authorizer = {
        Properties: {
          AuthorizerType: 'IAM',
        },
      };
      expect(isIamAuthorizer(authorizer)).toBe(true);
    });

    it('should return true for AWS_IAM authorizer', () => {
      const authorizer = {
        Properties: {
          AuthorizerType: 'AWS_IAM',
        },
      };
      expect(isIamAuthorizer(authorizer)).toBe(true);
    });

    it('should return false for JWT authorizer', () => {
      const authorizer = {
        Properties: {
          AuthorizerType: 'JWT',
        },
      };
      expect(isIamAuthorizer(authorizer)).toBe(false);
    });

    it('should return false for REQUEST authorizer', () => {
      const authorizer = {
        Properties: {
          AuthorizerType: 'REQUEST',
        },
      };
      expect(isIamAuthorizer(authorizer)).toBe(false);
    });

    it('should return false for null authorizer', () => {
      expect(isIamAuthorizer(null)).toBe(false);
    });

    it('should return false for undefined authorizer', () => {
      expect(isIamAuthorizer(undefined)).toBe(false);
    });

    it('should return false for authorizer without Properties', () => {
      const authorizer = {};
      expect(isIamAuthorizer(authorizer)).toBe(false);
    });

    it('should return false for authorizer without AuthorizerType', () => {
      const authorizer = {
        Properties: {},
      };
      expect(isIamAuthorizer(authorizer)).toBe(false);
    });
  });
});

