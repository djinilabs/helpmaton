#!/usr/bin/env node
/**
 * Cleanup script to remove API Gateway route resources from CloudFormation template
 * 
 * This script removes all API Gateway route-related resources (Methods, Integrations, Resources, Deployments)
 * while preserving the REST API itself and other critical resources.
 * 
 * Usage:
 *   node scripts/cleanup-cloudformation-routes.mjs <input-template> <output-template>
 */

import { readFileSync, writeFileSync } from 'fs';

const [inputFile, outputFile] = process.argv.slice(2);

if (!inputFile || !outputFile) {
  console.error('Usage: node scripts/cleanup-cloudformation-routes.mjs <input-template> <output-template>');
  process.exit(1);
}

try {
  const template = JSON.parse(readFileSync(inputFile, 'utf8'));
  const resources = template.Resources || {};
  const resourcesToRemove = [];

  // Find all API Gateway route-related resources
  // CRITICAL: Never remove the REST API itself, only route-related resources
  const REST_API_TYPES_TO_KEEP = [
    'AWS::ApiGateway::RestApi',  // The main API Gateway - NEVER remove
    'AWS::ApiGateway::Stage',
    'AWS::ApiGateway::DomainName',
    'AWS::ApiGateway::BasePathMapping',
    'AWS::ApiGateway::Authorizer',
    'AWS::ApiGateway::RequestValidator',
  ];

  for (const [resourceId, resource] of Object.entries(resources)) {
    const resourceType = resource?.Type || '';
    
    // Skip if this is a resource type we must keep
    if (REST_API_TYPES_TO_KEEP.includes(resourceType)) {
      continue;
    }
    
    // Remove methods, integrations, resources (but keep REST API, Stage, DomainName, BasePathMapping)
    if ([
      'AWS::ApiGateway::Method',
      'AWS::ApiGateway::Integration',
      'AWS::ApiGateway::Resource'
    ].includes(resourceType)) {
      resourcesToRemove.push(resourceId);
    }
  }

  // Also remove Deployment if it exists (it depends on methods we're removing)
  // Note: Deployment will be recreated in the next deployment step
  let deploymentId = null;
  for (const [resourceId, resource] of Object.entries(resources)) {
    if (resource?.Type === 'AWS::ApiGateway::Deployment') {
      deploymentId = resourceId;
      break;
    }
  }

  if (deploymentId) {
    resourcesToRemove.push(deploymentId);
    console.log(`  Will also remove: ${deploymentId} (depends on methods, will be recreated)`);
  }

  // Safety check: Never remove REST API
  const restApiIds = Object.entries(resources)
    .filter(([, res]) => res?.Type === 'AWS::ApiGateway::RestApi')
    .map(([rid]) => rid);
  
  for (const restApiId of restApiIds) {
    if (resourcesToRemove.includes(restApiId)) {
      console.error(`  ❌ ERROR: Attempted to remove REST API ${restApiId}! This should never happen.`);
      process.exit(1);
    }
  }

  /**
   * Recursively check if a value references any deleted resource
   */
  function referencesDeletedResource(value, deletedResources) {
    if (typeof value === 'object' && value !== null) {
      // Check Ref
      if ('Ref' in value) {
        return deletedResources.includes(value.Ref);
      }
      
      // Check Fn::GetAtt - format: {'Fn::GetAtt': ['ResourceId', 'Property']}
      if ('Fn::GetAtt' in value) {
        const getAtt = value['Fn::GetAtt'];
        if (Array.isArray(getAtt) && getAtt.length > 0) {
          return deletedResources.includes(getAtt[0]);
        }
      }
      
      // Check Fn::Sub - format: {'Fn::Sub': '${ResourceId}'} or {'Fn::Sub': ['string', {'key': Ref}]}
      if ('Fn::Sub' in value) {
        const subValue = value['Fn::Sub'];
        if (typeof subValue === 'string') {
          // Check if string contains ${ResourceId} pattern
          for (const resourceId of deletedResources) {
            const pattern = '${' + resourceId + '}';
            if (subValue.includes(pattern)) {
              return true;
            }
          }
        } else if (Array.isArray(subValue) && subValue.length > 1) {
          // Check substitution map
          const subMap = typeof subValue[1] === 'object' && subValue[1] !== null ? subValue[1] : {};
          for (const subVal of Object.values(subMap)) {
            if (referencesDeletedResource(subVal, deletedResources)) {
              return true;
            }
          }
        }
      }
      
      // Check Fn::Join - format: {'Fn::Join': [',', [{'Ref': 'ResourceId'}]]}
      if ('Fn::Join' in value) {
        const joinValue = value['Fn::Join'];
        if (Array.isArray(joinValue) && joinValue.length > 1) {
          for (const item of joinValue[1]) {
            if (referencesDeletedResource(item, deletedResources)) {
              return true;
            }
          }
        }
      }
      
      // Recursively check all values
      for (const val of Object.values(value)) {
        if (referencesDeletedResource(val, deletedResources)) {
          return true;
        }
      }
    } else if (Array.isArray(value)) {
      // Recursively check list items
      for (const item of value) {
        if (referencesDeletedResource(item, deletedResources)) {
          return true;
        }
      }
    }
    
    return false;
  }

  // Actually delete the resources we identified for removal
  for (const resourceId of resourcesToRemove) {
    if (resourceId in resources) {
      delete resources[resourceId];
    }
  }

  // Clean up DependsOn references and remove resources that reference deleted resources
  // Iterate until no more resources need to be removed
  let hasChanges = true;
  while (hasChanges) {
    hasChanges = false;
    const resourcesWithDeletedDeps = [];
    
    for (const [resourceId, resource] of Object.entries(resources)) {
      if (typeof resource !== 'object' || resource === null) {
        continue;
      }
      
      const resourceType = resource?.Type || '';
      
      // Handle DependsOn (can be string or array)
      if ('DependsOn' in resource) {
        const dependsOn = resource.DependsOn;
        if (typeof dependsOn === 'string') {
          if (resourcesToRemove.includes(dependsOn)) {
            delete resource.DependsOn;
            console.log(`  Removed DependsOn from ${resourceId}`);
            hasChanges = true;
          }
        } else if (Array.isArray(dependsOn)) {
          const originalLength = dependsOn.length;
          resource.DependsOn = dependsOn.filter(dep => !resourcesToRemove.includes(dep));
          if (resource.DependsOn.length < originalLength) {
            console.log(`  Cleaned DependsOn for ${resourceId}`);
            hasChanges = true;
          }
          // Remove DependsOn if it becomes empty
          if (resource.DependsOn.length === 0) {
            delete resource.DependsOn;
          }
        }
      }
      
      // Check entire resource (not just Properties) for references to deleted resources
      // This includes Properties, Conditions, and any other sections
      // BUT skip resources that we must keep (they'll be handled separately)
      // Also skip if we've already cleaned up the references (e.g., DeploymentId from Stage)
      if (!REST_API_TYPES_TO_KEEP.includes(resourceType) && referencesDeletedResource(resource, resourcesToRemove)) {
        // Skip if this resource is already marked for removal
        if (!resourcesToRemove.includes(resourceId)) {
          resourcesWithDeletedDeps.push(resourceId);
        }
      } else if (REST_API_TYPES_TO_KEEP.includes(resourceType) && referencesDeletedResource(resource, resourcesToRemove)) {
        // For resources we must keep, clean up references immediately
        // This prevents them from being flagged as having unresolved dependencies
        if ('Properties' in resource && typeof resource.Properties === 'object' && resource.Properties !== null) {
          for (const [propKey, propValue] of Object.entries(resource.Properties)) {
            if (referencesDeletedResource(propValue, resourcesToRemove)) {
              console.log(`  ⚠️  Removing property ${propKey} from ${resourceId} (references deleted resource)`);
              delete resource.Properties[propKey];
              hasChanges = true;
            }
          }
        }
      }
    }
    
    // Remove resources that reference deleted resources
    for (const resourceId of resourcesWithDeletedDeps) {
      const resource = resources[resourceId];
      const resourceType = resource?.Type || '';
      
      // Never remove critical resources, even if they reference deleted resources
      if (REST_API_TYPES_TO_KEEP.includes(resourceType)) {
        console.log(`  ⚠️  Skipping ${resourceId} (${resourceType} must be preserved, but it references deleted resources)`);
        // Clean up the reference instead of removing the resource
        if ('DependsOn' in resource) {
          delete resource.DependsOn;
        }
        // Try to clean up Properties that reference deleted resources
        if ('Properties' in resource && typeof resource.Properties === 'object' && resource.Properties !== null) {
          // Remove properties that reference deleted resources
          for (const [propKey, propValue] of Object.entries(resource.Properties)) {
            if (referencesDeletedResource(propValue, resourcesToRemove)) {
              console.log(`  ⚠️  Removing property ${propKey} from ${resourceId} (references deleted resource)`);
              delete resource.Properties[propKey];
            }
          }
          // Special handling for Stage: if DeploymentId references a deleted Deployment, remove it
          if (resourceType === 'AWS::ApiGateway::Stage' && 'DeploymentId' in resource.Properties) {
            const deploymentId = resource.Properties.DeploymentId;
            // Check if it's a Ref to a deleted resource
            if (typeof deploymentId === 'object' && deploymentId !== null && 'Ref' in deploymentId) {
              if (resourcesToRemove.includes(deploymentId.Ref)) {
                console.log(`  ⚠️  Removing DeploymentId from ${resourceId} (references deleted Deployment)`);
                delete resource.Properties.DeploymentId;
              }
            }
          }
        }
        continue;
      }
      
      console.log(`  Removing ${resourceId} (references deleted resources)`);
      delete resources[resourceId];
      resourcesToRemove.push(resourceId);
      hasChanges = true;
    }
  }

  // Update outputs to remove references to deleted resources
  const outputs = template.Outputs || {};
  const outputsToRemove = [];

  for (const [outputId, output] of Object.entries(outputs)) {
    // Check if output references any deleted resource
    const value = output?.Value;
    if (value && referencesDeletedResource(value, resourcesToRemove)) {
      outputsToRemove.push(outputId);
    }
  }

  for (const outputId of outputsToRemove) {
    delete outputs[outputId];
    console.log(`  Removed output: ${outputId}`);
  }

  // Save modified template
  writeFileSync(outputFile, JSON.stringify(template, null, 2), 'utf8');

  console.log(`✅ Removed ${resourcesToRemove.length} route resources`);
  process.exit(0);
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}

