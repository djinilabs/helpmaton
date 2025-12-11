#!/usr/bin/env node
/**
 * Comprehensive script to analyze API Gateway resource hierarchy and find deployment issues
 * This simulates what the http-to-rest plugin does during transformation
 */

const { createResourceHierarchy, printResourceTree } = require('./src/plugins/http-to-rest/resources');

// Routes from app.arc - extracted from @http section
const routes = [
  { Properties: { RouteKey: 'POST /api/workspaces/:workspaceId/agents/:agentId/test' } },
  { Properties: { RouteKey: 'POST /api/webhook/:workspaceId/:agentId/:key' } },
  { Properties: { RouteKey: 'GET /api/usage' } },
  { Properties: { RouteKey: 'GET /api/models' } },
  { Properties: { RouteKey: 'ANY /api/discord' } },
  { Properties: { RouteKey: 'ANY /api/auth' } },
  { Properties: { RouteKey: 'ANY /api/auth/*' } },
  { Properties: { RouteKey: 'ANY /api/email/oauth/:provider/callback' } },
  { Properties: { RouteKey: 'ANY /api/subscription' } },
  { Properties: { RouteKey: 'ANY /api/subscription/*' } },
  { Properties: { RouteKey: 'ANY /api/workspaces' } },
  { Properties: { RouteKey: 'ANY /api/workspaces/*' } },
  { Properties: { RouteKey: 'ANY /*' } },
];

console.log('='.repeat(80));
console.log('COMPREHENSIVE API GATEWAY RESOURCE HIERARCHY ANALYSIS');
console.log('='.repeat(80));
console.log('\nRoutes to process:');
routes.forEach((route, i) => {
  console.log(`  ${i + 1}. ${route.Properties.RouteKey}`);
});

console.log('\n' + '-'.repeat(80));
console.log('GENERATING RESOURCE HIERARCHY...');
console.log('-'.repeat(80) + '\n');

const { resources, pathToResourceId } = createResourceHierarchy(routes);

console.log('\n' + '='.repeat(80));
console.log('RESOURCE TREE STRUCTURE');
console.log('='.repeat(80) + '\n');

// Print the resource tree
printResourceTree(resources, pathToResourceId, 'HTTP');

console.log('\n' + '='.repeat(80));
console.log('DEPLOYMENT ISSUE ANALYSIS');
console.log('='.repeat(80) + '\n');

// Analysis 1: Check for duplicate logical IDs (should never happen)
const logicalIdCounts = {};
Object.keys(resources).forEach(id => {
  logicalIdCounts[id] = (logicalIdCounts[id] || 0) + 1;
});
const duplicateLogicalIds = Object.entries(logicalIdCounts).filter(([_, count]) => count > 1);

if (duplicateLogicalIds.length > 0) {
  console.log('❌ CRITICAL: Duplicate logical IDs found:');
  duplicateLogicalIds.forEach(([id, count]) => {
    console.log(`  - ${id}: appears ${count} times`);
  });
  console.log('');
} else {
  console.log('✅ No duplicate logical IDs');
}

// Analysis 2: Check for duplicate PathPart+ParentId combinations (CloudFormation error)
const pathPartParentCombos = {};
const conflicts = [];

for (const [resourceId, resource] of Object.entries(resources)) {
  if (resource.Type !== 'AWS::ApiGateway::Resource') continue;
  
  const props = resource.Properties || {};
  const pathPart = props.PathPart;
  const parentId = props.ParentId;
  
  // Normalize parent ID for comparison
  let parentKey;
  if (typeof parentId === 'object') {
    if (parentId['Fn::GetAtt']) {
      parentKey = `GetAtt:${parentId['Fn::GetAtt'].join('.')}`;
    } else if (parentId.Ref) {
      parentKey = `Ref:${parentId.Ref}`;
    } else {
      parentKey = JSON.stringify(parentId);
    }
  } else {
    parentKey = String(parentId);
  }
  
  const comboKey = `${parentKey}::${pathPart}`;
  
  if (!pathPartParentCombos[comboKey]) {
    pathPartParentCombos[comboKey] = [];
  }
  
  pathPartParentCombos[comboKey].push({
    resourceId,
    pathPart,
    parentKey,
    parentId
  });
  
  // If we have more than one resource with same PathPart+ParentId, it's a conflict
  if (pathPartParentCombos[comboKey].length > 1) {
    const existingConflict = conflicts.find(c => c.comboKey === comboKey);
    if (!existingConflict) {
      conflicts.push({
        comboKey,
        pathPart,
        parentKey,
        resources: pathPartParentCombos[comboKey]
      });
    }
  }
}

if (conflicts.length > 0) {
  console.log('❌ CRITICAL: Duplicate PathPart+ParentId combinations found:');
  conflicts.forEach(conflict => {
    console.log(`\n  PathPart: ${conflict.pathPart}`);
    console.log(`  Parent: ${conflict.parentKey}`);
    console.log(`  Conflicting Resources (${conflict.resources.length}):`);
    conflict.resources.forEach(r => {
      console.log(`    - ${r.resourceId}`);
    });
    console.log(`  ⚠️  CloudFormation Error: "Another resource with the same parent already has this name: ${conflict.pathPart}"`);
  });
  console.log('');
} else {
  console.log('✅ No duplicate PathPart+ParentId combinations');
}

// Analysis 3: Check for resources with invalid parent references
console.log('\nChecking parent references...');
const parentRefs = new Set();
Object.values(resources).forEach(resource => {
  if (resource.Type === 'AWS::ApiGateway::Resource' && resource.Properties) {
    const parentId = resource.Properties.ParentId;
    if (parentId && typeof parentId === 'object' && parentId.Ref) {
      parentRefs.add(parentId.Ref);
    }
  }
});

const missingParents = [];
parentRefs.forEach(parentRef => {
  if (parentRef !== 'HTTPRootResource' && !resources[parentRef]) {
    missingParents.push(parentRef);
  }
});

if (missingParents.length > 0) {
  console.log('❌ CRITICAL: Resources reference non-existent parents:');
  missingParents.forEach(parent => {
    console.log(`  - ${parent}`);
  });
  console.log('');
} else {
  console.log('✅ All parent references are valid');
}

// Analysis 4: Check for resources with same logical ID but different properties
console.log('\nChecking for logical ID consistency...');
const resourceGroups = {};
Object.entries(resources).forEach(([id, resource]) => {
  if (!resourceGroups[id]) {
    resourceGroups[id] = [];
  }
  resourceGroups[id].push(resource);
});

const inconsistentResources = [];
Object.entries(resourceGroups).forEach(([id, group]) => {
  if (group.length > 1) {
    // Check if all resources have same properties
    const firstProps = JSON.stringify(group[0].Properties || {});
    const allSame = group.every(r => JSON.stringify(r.Properties || {}) === firstProps);
    if (!allSame) {
      inconsistentResources.push({ id, resources: group });
    }
  }
});

if (inconsistentResources.length > 0) {
  console.log('❌ CRITICAL: Resources with same logical ID but different properties:');
  inconsistentResources.forEach(({ id, resources: resList }) => {
    console.log(`  - ${id}: ${resList.length} different definitions`);
  });
  console.log('');
} else {
  console.log('✅ All logical IDs are consistent');
}

// Analysis 5: Check for orphaned paths (paths that don't map to resources)
console.log('\nChecking path mappings...');
const orphanedPaths = [];
Object.entries(pathToResourceId).forEach(([path, resourceId]) => {
  if (!resources[resourceId] && resourceId !== 'HTTPRootResource') {
    orphanedPaths.push({ path, resourceId });
  }
});

if (orphanedPaths.length > 0) {
  console.log('⚠️  WARNING: Paths mapped to non-existent resources:');
  orphanedPaths.forEach(({ path, resourceId }) => {
    console.log(`  - ${path} -> ${resourceId}`);
  });
  console.log('');
} else {
  console.log('✅ All path mappings are valid');
}

// Analysis 6: Check for resources without path mappings
console.log('\nChecking for unmapped resources...');
const unmappedResources = [];
Object.keys(resources).forEach(resourceId => {
  if (resourceId === 'HTTPRootResource') return;
  const isMapped = Object.values(pathToResourceId).includes(resourceId);
  if (!isMapped) {
    unmappedResources.push(resourceId);
  }
});

if (unmappedResources.length > 0) {
  console.log('⚠️  WARNING: Resources without path mappings:');
  unmappedResources.forEach(id => {
    console.log(`  - ${id}`);
  });
  console.log('');
} else {
  console.log('✅ All resources have path mappings');
}

// Summary
console.log('\n' + '='.repeat(80));
console.log('DEPLOYMENT READINESS SUMMARY');
console.log('='.repeat(80));
console.log(`Total Resources: ${Object.keys(resources).length}`);
console.log(`Total Path Mappings: ${Object.keys(pathToResourceId).length}`);
console.log(`Critical Issues: ${duplicateLogicalIds.length + conflicts.length + missingParents.length + inconsistentResources.length}`);
console.log(`Warnings: ${orphanedPaths.length + unmappedResources.length}`);

const hasCriticalIssues = duplicateLogicalIds.length > 0 || 
                          conflicts.length > 0 || 
                          missingParents.length > 0 || 
                          inconsistentResources.length > 0;

if (hasCriticalIssues) {
  console.log('\n❌ DEPLOYMENT WILL FAIL - Critical issues detected!');
  process.exit(1);
} else {
  console.log('\n✅ RESOURCE TREE IS READY FOR DEPLOYMENT');
  if (orphanedPaths.length > 0 || unmappedResources.length > 0) {
    console.log('⚠️  Warnings present but deployment should succeed');
  }
}

console.log('\n' + '='.repeat(80) + '\n');
