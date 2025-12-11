/**
 * Unit tests for domain transformation
 */

import { describe, it, expect } from 'vitest';
import { transformDomain } from '../domain.js';

describe('Domain Transformation', () => {
  describe('transformDomain', () => {
    it('should create domain name resource', () => {
      const httpDomain = {
        DomainName: 'api.example.com',
        CertificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012',
      };

      const result = transformDomain(httpDomain, 'HTTP', 'staging');

      expect(result.domainName).toBeDefined();
      expect(result.domainName.HTTPDomainName).toBeDefined();
      
      const domainResource = result.domainName.HTTPDomainName;
      expect(domainResource.Type).toBe('AWS::ApiGateway::DomainName');
      expect(domainResource.Properties.DomainName).toBe('api.example.com');
      // For REGIONAL endpoints, only RegionalCertificateArn should be set (not CertificateArn)
      expect(domainResource.Properties.CertificateArn).toBeUndefined();
      expect(domainResource.Properties.RegionalCertificateArn).toBe(httpDomain.CertificateArn);
      expect(domainResource.Properties.EndpointConfiguration.Types).toEqual(['REGIONAL']);
    });

    it('should create base path mapping', () => {
      const httpDomain = {
        DomainName: 'api.example.com',
        CertificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012',
      };

      const result = transformDomain(httpDomain, 'HTTP', 'staging');

      expect(result.basePathMapping).toBeDefined();
      expect(result.basePathMapping.HTTPBasePathMapping).toBeDefined();
      
      const basePathMapping = result.basePathMapping.HTTPBasePathMapping;
      expect(basePathMapping.Type).toBe('AWS::ApiGateway::BasePathMapping');
      expect(basePathMapping.Properties.DomainName).toEqual({ Ref: 'HTTPDomainName' });
      expect(basePathMapping.Properties.RestApiId).toEqual({ Ref: 'HTTP' });
      expect(basePathMapping.Properties.Stage).toBe('staging');
    });

    it('should create Route53 record when HostedZoneId is provided', () => {
      const httpDomain = {
        DomainName: 'api.example.com',
        CertificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012',
        Route53: {
          HostedZoneId: 'Z1234567890ABC',
          DistributionDomainName: 'api.example.com',
        },
      };

      const result = transformDomain(httpDomain, 'HTTP', 'staging');

      expect(result.recordSet).toBeDefined();
      expect(result.recordSet.HTTPDomainNameRecordSet).toBeDefined();
      
      const recordSet = result.recordSet.HTTPDomainNameRecordSet;
      expect(recordSet.Type).toBe('AWS::Route53::RecordSet');
      expect(recordSet.Properties.HostedZoneId).toBe('Z1234567890ABC');
      expect(recordSet.Properties.Name).toBe('api.example.com');
      expect(recordSet.Properties.Type).toBe('A');
      expect(recordSet.Properties.AliasTarget).toBeDefined();
      expect(recordSet.Properties.AliasTarget.DNSName).toEqual({
        'Fn::GetAtt': ['HTTPDomainName', 'RegionalDomainName'],
      });
      expect(recordSet.Properties.AliasTarget.HostedZoneId).toEqual({
        'Fn::GetAtt': ['HTTPDomainName', 'RegionalHostedZoneId'],
      });
    });

    it('should use DistributionDomainName for Route53 record when provided', () => {
      const httpDomain = {
        DomainName: 'api.example.com',
        CertificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012',
        Route53: {
          HostedZoneId: 'Z1234567890ABC',
          DistributionDomainName: 'd1234567890.cloudfront.net',
        },
      };

      const result = transformDomain(httpDomain, 'HTTP', 'staging');

      expect(result.recordSet.HTTPDomainNameRecordSet.Properties.Name).toBe('d1234567890.cloudfront.net');
    });

    it('should not create Route53 record when HostedZoneId is missing', () => {
      const httpDomain = {
        DomainName: 'api.example.com',
        CertificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012',
      };

      const result = transformDomain(httpDomain, 'HTTP', 'staging');

      expect(result.recordSet).toBeNull();
    });

    it('should return null resources when domain is not provided', () => {
      const result = transformDomain(null, 'HTTP', 'staging');

      expect(result.domainName).toBeNull();
      expect(result.basePathMapping).toBeNull();
    });

    it('should return null resources when DomainName is missing', () => {
      const httpDomain = {
        CertificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012',
      };

      const result = transformDomain(httpDomain, 'HTTP', 'staging');

      expect(result.domainName).toBeNull();
      expect(result.basePathMapping).toBeNull();
    });

    it('should return null resources when CertificateArn is missing', () => {
      const httpDomain = {
        DomainName: 'api.example.com',
      };

      const result = transformDomain(httpDomain, 'HTTP', 'staging');

      expect(result.domainName).toBeNull();
      expect(result.basePathMapping).toBeNull();
    });

    it('should use different stage names', () => {
      const httpDomain = {
        DomainName: 'api.example.com',
        CertificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012',
      };

      const stagingResult = transformDomain(httpDomain, 'HTTP', 'staging');
      const productionResult = transformDomain(httpDomain, 'HTTP', 'production');

      expect(stagingResult.basePathMapping.HTTPBasePathMapping.Properties.Stage).toBe('staging');
      expect(productionResult.basePathMapping.HTTPBasePathMapping.Properties.Stage).toBe('production');
    });
  });
});

