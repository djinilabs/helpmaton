#!/usr/bin/env node
/**
 * Test script to reproduce the duplicate {workspaceId} resource issue
 */

const { createResourceHierarchy } = require('./src/plugins/http-to-rest/resources');

// Simulate routes that might cause duplicate {workspaceId} resources
// This tests the scenario where multiple routes need {workspaceId} under the same parent
const routes = [
  { Properties: { RouteKey: 'POST /api/streams/:workspaceId/:agentId/test' } },
  { Properties: { RouteKey: 'GET /api/workspaces/:workspaceId' } }, // Another route with {workspaceId}
  { Properties: { RouteKey: 'ANY /api/workspaces/*' } },
];

console.log('Testing for duplicate {workspaceId} resources...\n');

const { resources, pathToResourceId } = createResourceHierarchy(routes);

// Check for duplicate pathParts under the same parent
const resourcesByParent = {};
for (const [resourceId, resource] of Object.entries(resources)) {
  const props = resource.Properties || {};
  const pathPart = props.PathPart;
  const parentId = props.ParentId;
  
  const parentKey = JSON.stringify(parentId);
  if (!resourcesByParent[parentKey]) {
    resourcesByParent[parentKey] = [];
  }
  
  resourcesByParent[parentKey].push({ resourceId, pathPart });
}

console.log('Resources grouped by parent:\n');
for (const [parentKey, children] of Object.entries(resourcesByParent)) {
  const pathPartCounts = {};
  children.forEach(child => {
    pathPartCounts[child.pathPart] = (pathPartCounts[child.pathPart] || 0) + 1;
  });
  
  const duplicates = Object.entries(pathPartCounts).filter(([_, count]) => count > 1);
  
  if (duplicates.length > 0) {
    console.log(`⚠️  PARENT: ${parentKey}`);
    duplicates.forEach(([pathPart, count]) => {
      const duplicateResources = children.filter(c => c.pathPart === pathPart);
      console.log(`  DUPLICATE ${pathPart}: ${count} resources`);
      duplicateResources.forEach(r => {
        console.log(`    - ${r.resourceId}`);
      });
    });
  }
}

console.log('\nAll resources:');
for (const [resourceId, resource] of Object.entries(resources)) {
  const props = resource.Properties || {};
  console.log(`  ${resourceId}: PathPart=${props.PathPart}, Parent=${JSON.stringify(props.ParentId)}`);
}

