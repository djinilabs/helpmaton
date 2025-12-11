/**
 * Domain transformation logic
 */

/**
 * Transform custom domain configuration from HTTP API v2 to REST API
 * @param {Object} httpDomain - HTTP API v2 domain config from HTTP.Properties.Domain
 * @param {string} restApiId - REST API resource ID (should be 'HTTP')
 * @param {string} stageName - Stage name
 * @returns {Object} REST API domain resources (DomainName and BasePathMapping)
 */
function transformDomain(httpDomain, restApiId, stageName) {
  if (!httpDomain) {
    return {
      domainName: null,
      basePathMapping: null,
    };
  }

  const domainName = httpDomain.DomainName;
  const certificateArn = httpDomain.CertificateArn;
  const route53 = httpDomain.Route53;

  if (!domainName || !certificateArn) {
    console.warn('Domain configuration missing DomainName or CertificateArn');
    return {
      domainName: null,
      basePathMapping: null,
    };
  }

  // Create DomainName resource
  // For REGIONAL endpoints, only use RegionalCertificateArn (not CertificateArn)
  // CertificateArn is for EDGE endpoints, RegionalCertificateArn is for REGIONAL endpoints
  const domainNameResourceId = 'HTTPDomainName';
  const domainNameResource = {
    Type: 'AWS::ApiGateway::DomainName',
    Properties: {
      DomainName: domainName,
      RegionalCertificateArn: certificateArn,
      EndpointConfiguration: {
        Types: ['REGIONAL'],
      },
    },
  };

  // Add Route53 record if configured
  if (route53 && route53.HostedZoneId) {
    const recordSetId = 'HTTPDomainNameRecordSet';
      const recordSet = {
        Type: 'AWS::Route53::RecordSet',
        Properties: {
          HostedZoneId: route53.HostedZoneId,
          // The Name property should match the custom domain name (see AWS docs)
          // Note: DistributionDomainName is a legacy property name from HTTP API v2
          // that may be present for backwards compatibility, but the Name should
          // typically match the domainName
          Name: route53.DistributionDomainName || domainName,
        Type: 'A',
        AliasTarget: {
          // For REST API, we need to use the regional domain name
          DNSName: { 'Fn::GetAtt': [domainNameResourceId, 'RegionalDomainName'] },
          HostedZoneId: { 'Fn::GetAtt': [domainNameResourceId, 'RegionalHostedZoneId'] },
        },
      },
    };

    return {
      domainName: {
        [domainNameResourceId]: domainNameResource,
      },
      basePathMapping: {
        HTTPBasePathMapping: {
          Type: 'AWS::ApiGateway::BasePathMapping',
          Properties: {
            DomainName: { Ref: domainNameResourceId },
            RestApiId: { Ref: restApiId },
            Stage: stageName,
          },
        },
      },
      recordSet: {
        [recordSetId]: recordSet,
      },
    };
  }

  // Return without Route53 record
  return {
    domainName: {
      [domainNameResourceId]: domainNameResource,
    },
    basePathMapping: {
      HTTPBasePathMapping: {
        Type: 'AWS::ApiGateway::BasePathMapping',
        Properties: {
          DomainName: { Ref: domainNameResourceId },
          RestApiId: { Ref: restApiId },
          Stage: stageName,
        },
      },
    },
    recordSet: null,
  };
}

module.exports = {
  transformDomain,
};

