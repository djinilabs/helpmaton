const fs = require('fs');
const path = require('path');

module.exports = {
  deploy: {
    start: async ({ cloudformation, stage }) => {
      const customDomain = process.env.HELPMATON_CUSTOM_DOMAIN;
      const CertificateArn = process.env.AWS_CERTIFICATE_ARN;
      const HostedZoneId = process.env.AWS_ZONE_ID;
      console.log(`Custom domain: stage = ${stage}, custom domain = ${customDomain}`);
      
      // Check for HTTP resource and HTTPRestApi (for migration)
      const httpResource = cloudformation.Resources?.HTTP;
      const httpRestApiResource = cloudformation.Resources?.HTTPRestApi;
      // Prioritize HTTPRestApi when it exists (during Phase 1 migration, both exist but we want REST API)
      // This ensures domain configuration targets the REST API, not the HTTP API v2
      const apiResource = httpRestApiResource || httpResource;
      const restApiId = httpRestApiResource ? 'HTTPRestApi' : 'HTTP';
      
      if (!apiResource) {
        console.log('No HTTP or HTTPRestApi resource found, skipping domain configuration');
        return cloudformation;
      }

      // IMPORTANT: The 'http-to-rest' plugin must run before 'custom-domain' in the plugin order.
      // This is required because the following check depends on the HTTP resource being transformed
      // to a REST API by 'http-to-rest'. If the plugin order is incorrect, this check will not work as intended.
      // Check if this is REST API (transformed by http-to-rest plugin) or HTTP API v2
      // Note: We prioritize httpRestApiResource above, so during Phase 1, isRestApi will be true
      const isRestApi = apiResource.Type === 'AWS::ApiGateway::RestApi';
      
      // Detect Phase 1 migration: HTTPRestApi exists AND HTTP is still HTTP API v2
      // During Phase 1, we should NOT create domain resources - they will be created in Phase 2
      const isPhase1Migration = httpRestApiResource && 
                                 httpResource && 
                                 (httpResource.Type === 'AWS::Serverless::HttpApi' || 
                                  httpResource.Type === 'AWS::ApiGatewayV2::Api');
      
      // Detect Phase 2 migration: HTTPRestApi exists AND HTTP was removed or is REST API
      const isPhase2Migration = httpRestApiResource && (!httpResource || httpResource.Type === 'AWS::ApiGateway::RestApi');
      
      if (customDomain) {
        console.log(`Configuring domain name in deploy: ${customDomain}`);
        console.log('custom domain = ' + customDomain);
        console.log('certificate ARN = ' + CertificateArn);
        console.log('hosted zone id = ' + HostedZoneId);
        
        if (isRestApi) {
          // REST API domain configuration
          const domainNameResourceId = 'HTTPDomainName';
          const basePathMappingId = 'HTTPBasePathMapping';
          const recordSetId = 'HTTPDomainNameRecordSet';
          
          // Check if domain resource already exists in template
          const existingDomain = cloudformation.Resources?.[domainNameResourceId];
          
          // Check for old HTTP API v2 domain resources that might conflict
          // These should have been removed by http-to-rest plugin, but we check anyway
          const oldV2DomainResources = Object.keys(cloudformation.Resources || {}).filter(id => {
            const resource = cloudformation.Resources[id];
            return resource && (
              resource.Type === 'AWS::ApiGatewayV2::DomainName' ||
              resource.Type === 'AWS::ApiGatewayV2::ApiMapping'
            );
          });
          
          // SOLUTION: Two-phase domain migration
          // Phase 1: Skip domain creation - HTTPRestApi exists but HTTP is still HTTP API v2
          // Phase 2: Create new REST API domain resources (old ones were deleted in Phase 1)
          // 
          // This approach avoids the "domain already exists" error because:
          // 1. Phase 1 skips domain creation → No domain resources created
          // 2. Phase 2 creates new domain resources → No conflict since old ones are gone
          
          if (isPhase1Migration) {
            console.log(`[custom-domain] Phase 1 migration detected: HTTPRestApi exists but HTTP is still HTTP API v2`);
            console.log(`[custom-domain] Skipping domain creation in Phase 1 - domains will be created in Phase 2`);
            console.log(`[custom-domain] This prevents "domain already exists" errors during Phase 2`);
            return cloudformation;
          }
          
          // Check if old domain resources are in template (will be deleted by CloudFormation)
          // These are the same as oldV2DomainResources, but we check them before removing
          const v2DomainResourcesInTemplate = oldV2DomainResources;
          
          if (isPhase2Migration) {
            console.log(`[custom-domain] Phase 2 migration: Creating new REST API domain resources`);
            console.log(`[custom-domain] HTTPRestApi exists: ${!!httpRestApiResource}`);
            console.log(`[custom-domain] HTTP resource exists: ${!!httpResource}, type: ${httpResource?.Type || 'N/A'}`);
            console.log(`[custom-domain] Certificate ARN: ${CertificateArn || 'MISSING'}`);
            console.log(`[custom-domain] Hosted Zone ID: ${HostedZoneId || 'MISSING'}`);
            if (v2DomainResourcesInTemplate.length > 0) {
              console.log(`[custom-domain] Old HTTP API v2 domain resources are in template (will be deleted): ${v2DomainResourcesInTemplate.join(', ')}`);
              console.log(`[custom-domain] CloudFormation will delete these first, then create the new REST API domain.`);
              // DON'T remove them - let CloudFormation delete them
              // The http-to-rest plugin keeps them in the template specifically so CloudFormation can delete them
            } else {
              // In Phase 2, if old HTTP API v2 domain resources are NOT in the template,
              // it means they were never created (Phase 1 skipped domain creation).
              // This is the expected case - we can safely create the new domain.
              console.log(`[custom-domain] No old HTTP API v2 domain resources in template (expected - Phase 1 skipped domain creation)`);
              console.log(`[custom-domain] Creating new REST API domain resources.`);
            }
          } else {
            // Not Phase 2 - remove old domain resources if they exist
            if (oldV2DomainResources.length > 0) {
              console.log(`[custom-domain] WARNING: Found old HTTP API v2 domain resources still in template: ${oldV2DomainResources.join(', ')}`);
              console.log(`[custom-domain] These should have been deleted by http-to-rest plugin. Removing them now to prevent conflicts.`);
              // Remove them ourselves as a safety measure
              oldV2DomainResources.forEach(id => {
                console.log(`[custom-domain] Removing conflicting HTTP API v2 domain resource: ${id}`);
                delete cloudformation.Resources[id];
              });
            }
          }
          
          if (existingDomain && existingDomain.Type === 'AWS::ApiGateway::DomainName') {
            console.log(`[custom-domain] Domain resource ${domainNameResourceId} already exists in template, updating it`);
            // Update existing domain resource
            // For REGIONAL endpoints, only use RegionalCertificateArn (not CertificateArn)
            existingDomain.Properties = {
              DomainName: customDomain,
              RegionalCertificateArn: CertificateArn,
              EndpointConfiguration: {
                Types: ['REGIONAL'],
              },
            };
          } else {
            // Create new DomainName resource
            // For REGIONAL endpoints, only use RegionalCertificateArn (not CertificateArn)
            // CertificateArn is for EDGE endpoints, RegionalCertificateArn is for REGIONAL endpoints
            console.log(`[custom-domain] Creating new domain resource ${domainNameResourceId}`);
            cloudformation.Resources[domainNameResourceId] = {
              Type: 'AWS::ApiGateway::DomainName',
              Properties: {
                DomainName: customDomain,
                RegionalCertificateArn: CertificateArn,
                EndpointConfiguration: {
                  Types: ['REGIONAL'],
                },
              },
            };
          }
          
          // Find the actual stage name from the REST API stage resources
          // The stage name must match exactly what was created in the REST API
          let actualStageName = stage || 'staging';
          const stageResources = Object.keys(cloudformation.Resources || {}).filter(id => {
            const resource = cloudformation.Resources[id];
            return resource && 
                   resource.Type === 'AWS::ApiGateway::Stage' &&
                   resource.Properties &&
                   resource.Properties.RestApiId &&
                   ((typeof resource.Properties.RestApiId === 'object' && resource.Properties.RestApiId.Ref === restApiId) ||
                    resource.Properties.RestApiId === restApiId);
          });
          
          if (stageResources.length > 0) {
            // Use the first stage's StageName
            const firstStage = cloudformation.Resources[stageResources[0]];
            if (firstStage && firstStage.Properties && firstStage.Properties.StageName) {
              actualStageName = firstStage.Properties.StageName;
              console.log(`[custom-domain] Found REST API stage: ${actualStageName} (from resource ${stageResources[0]})`);
            }
          } else {
            console.log(`[custom-domain] No REST API stage found, using default: ${actualStageName}`);
          }
          
          // Create or update BasePathMapping
          // Use HTTPRestApi if it exists (Phase 2 migration), otherwise use HTTP
          console.log(`[custom-domain] Creating BasePathMapping with stage: ${actualStageName}`);
          
          // Find the stage resource ID to add as a dependency
          // This ensures BasePathMapping is deleted before the stage during stack deletion
          // CloudFormation deletes in reverse dependency order, so if BasePathMapping depends on Stage,
          // BasePathMapping will be deleted first (preventing "Deleting stage failed" errors)
          let stageResourceIdForMapping = null;
          const stageResourcesForMapping = Object.keys(cloudformation.Resources || {}).filter(id => {
            const resource = cloudformation.Resources[id];
            return resource && 
                   resource.Type === 'AWS::ApiGateway::Stage' &&
                   resource.Properties &&
                   resource.Properties.StageName === actualStageName &&
                   ((typeof resource.Properties.RestApiId === 'object' && resource.Properties.RestApiId.Ref === restApiId) ||
                    resource.Properties.RestApiId === restApiId);
          });
          
          if (stageResourcesForMapping.length > 0) {
            stageResourceIdForMapping = stageResourcesForMapping[0];
            console.log(`[custom-domain] Found stage resource ${stageResourceIdForMapping}, adding as dependency to BasePathMapping`);
          }
          
          cloudformation.Resources[basePathMappingId] = {
            Type: 'AWS::ApiGateway::BasePathMapping',
            Properties: {
              DomainName: { Ref: domainNameResourceId },
              RestApiId: { Ref: restApiId },
              Stage: actualStageName,
              BasePath: '', // Explicitly set empty base path to ensure proper mapping
            },
            ...(stageResourceIdForMapping && { DependsOn: [stageResourceIdForMapping] }),
          };
          
          // Create Route53 record if HostedZoneId is provided and SKIP_ROUTE53_RECORD is not set
          // In production, DNS records may already exist, so we can skip creating them via CloudFormation
          const skipRoute53Record = process.env.SKIP_ROUTE53_RECORD === 'true' || 
                                   process.env.SKIP_ROUTE53_RECORD === '1' ||
                                   stage === 'production';
          
          if (HostedZoneId && !skipRoute53Record) {
            console.log(`[custom-domain] Creating Route53 record for ${customDomain} in hosted zone ${HostedZoneId}`);
            cloudformation.Resources[recordSetId] = {
              Type: 'AWS::Route53::RecordSet',
              Properties: {
                HostedZoneId,
                Name: customDomain,
                Type: 'A',
                AliasTarget: {
                  DNSName: { 'Fn::GetAtt': [domainNameResourceId, 'RegionalDomainName'] },
                  HostedZoneId: { 'Fn::GetAtt': [domainNameResourceId, 'RegionalHostedZoneId'] },
                },
              },
            };
          } else if (HostedZoneId && skipRoute53Record) {
            console.log(`[custom-domain] Skipping Route53 record creation for ${customDomain} (already exists in production or SKIP_ROUTE53_RECORD is set)`);
            console.log(`[custom-domain] The DNS record should already exist and point to the API Gateway domain.`);
          } else {
            console.warn(`[custom-domain] WARNING: HostedZoneId is not set - Route53 record will NOT be created`);
            console.warn(`[custom-domain] This means DNS will not be configured automatically. You may need to create the DNS record manually.`);
          }
        } else {
          // HTTP API v2 domain configuration (original behavior)
          // Only apply to HTTP resource, not HTTPRestApi
          // BUT: Skip domain configuration during Phase 1 migration to prevent SAM from
          // automatically creating domain resources that will conflict in Phase 2
          if (isPhase1Migration) {
            console.log(`[custom-domain] Phase 1 migration: Skipping HTTP API v2 domain configuration`);
            console.log(`[custom-domain] This prevents SAM from automatically creating domain resources`);
            console.log(`[custom-domain] Domain will be configured in Phase 2 for the REST API`);
          } else if (httpResource) {
            httpResource.Properties = httpResource.Properties || {};
            httpResource.Properties.Domain = {
              DomainName: customDomain,
              CertificateArn,
              Route53: {
                HostedZoneId,
                DistributionDomainName: customDomain,
              }
            };
          }
        }
      } else {
        // Remove domain configuration
        if (isRestApi) {
          // Remove REST API domain resources
          delete cloudformation.Resources?.HTTPDomainName;
          delete cloudformation.Resources?.HTTPBasePathMapping;
          delete cloudformation.Resources?.HTTPDomainNameRecordSet;
        } else {
          // Remove HTTP API v2 domain configuration
          // Check if httpResource exists before accessing its properties
          // (httpResource can be undefined during Phase 2 migration when HTTP resource was removed)
          if (httpResource?.Properties?.Domain) {
            delete httpResource.Properties.Domain;
          }
        }
      }

      return cloudformation;
    }
  }
};

