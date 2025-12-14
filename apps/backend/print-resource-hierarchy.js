#!/usr/bin/env node
/**
 * Script to print API Gateway resource hierarchy from CloudFormation template
 * This helps debug resource naming conflicts
 */

const fs = require('fs');
const path = require('path');

// Read the CloudFormation template from .arc output or generate it
// For now, we'll use arc package to generate it

async function printResourceHierarchy() {
  const { execSync } = require('child_process');
  
  // Set minimal env vars needed for package
  process.env.ARC_ENV = process.env.ARC_ENV || 'staging';
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'dummy-secret-for-package';
  
  console.log('📦 Generating CloudFormation template...\n');
  
  try {
    // Run arc package to generate the template
    execSync('pnpm arc package --quiet', { 
      stdio: 'inherit',
      cwd: __dirname,
      env: { ...process.env }
    });
    
    // Find the generated template
    const templatePath = path.join(__dirname, '.arc', 'sam.json');
    
    if (!fs.existsSync(templatePath)) {
      console.error('❌ Template not found at:', templatePath);
      console.log('Looking for template in .arc directory...');
      const arcDir = path.join(__dirname, '.arc');
      if (fs.existsSync(arcDir)) {
        const files = fs.readdirSync(arcDir);
        console.log('Files in .arc:', files);
      }
      return;
    }
    
    const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    const resources = template.Resources || {};
    
    console.log('\n' + '='.repeat(80));
    console.log('API GATEWAY RESOURCE HIERARCHY');
    console.log('='.repeat(80) + '\n');
    
    // Find all API Gateway resources
    const apiResources = {};
    const resourceParents = {};
    
    for (const [resourceId, resource] of Object.entries(resources)) {
      if (resource.Type === 'AWS::ApiGateway::Resource') {
        const props = resource.Properties || {};
        const pathPart = props.PathPart;
        const parentId = props.ParentId;
        
        apiResources[resourceId] = {
          pathPart,
          parentId: typeof parentId === 'object' ? JSON.stringify(parentId) : parentId,
          resourceId
        };
        
        // Track parent-child relationships
        const parentKey = typeof parentId === 'object' ? JSON.stringify(parentId) : String(parentId);
        if (!resourceParents[parentKey]) {
          resourceParents[parentKey] = [];
        }
        resourceParents[parentKey].push(resourceId);
      }
    }
    
    // Build hierarchy tree
    function printResource(id, indent = '', visited = new Set()) {
      if (visited.has(id)) {
        return; // Avoid cycles
      }
      visited.add(id);
      
      const resource = apiResources[id];
      if (!resource) {
        return;
      }
      
      const pathPart = resource.pathPart || '(root)';
      const parentRef = resource.parentId;
      
      // Check for conflicts - multiple resources with same pathPart under same parent
      const siblings = resourceParents[parentRef] || [];
      const conflicts = siblings.filter(sid => {
        const sib = apiResources[sid];
        return sib && sib.pathPart === resource.pathPart && sid !== id;
      });
      
      const conflictMarker = conflicts.length > 0 ? ' ⚠️  CONFLICT!' : '';
      console.log(`${indent}${pathPart} (${id})${conflictMarker}`);
      
      if (conflicts.length > 0) {
        console.log(`${indent}  └─ Conflicts with: ${conflicts.join(', ')}`);
      }
      
      // Print children
      const children = resourceParents[`{"Ref":"${id}"}`] || resourceParents[id] || [];
      children.forEach(childId => {
        printResource(childId, indent + '  ', visited);
      });
    }
    
    // Find root resources (those with GetAtt HTTP RootResourceId or direct Ref to HTTP)
    const rootResources = Object.entries(apiResources)
      .filter(([id, res]) => {
        const parent = res.parentId;
        return typeof parent === 'string' && (
          parent.includes('RootResourceId') || 
          parent === '{"Ref":"HTTP"}' ||
          parent === '{"Fn::GetAtt":["HTTP","RootResourceId"]}'
        );
      })
      .map(([id]) => id);
    
    console.log('Root Resources:');
    rootResources.forEach(id => {
      printResource(id);
    });
    
    // Also print all resources grouped by parent
    console.log('\n' + '-'.repeat(80));
    console.log('ALL RESOURCES GROUPED BY PARENT:');
    console.log('-'.repeat(80) + '\n');
    
    const parentGroups = {};
    for (const [id, resource] of Object.entries(apiResources)) {
      const parentKey = resource.parentId;
      if (!parentGroups[parentKey]) {
        parentGroups[parentKey] = [];
      }
      parentGroups[parentKey].push({ id, pathPart: resource.pathPart });
    }
    
    for (const [parentKey, children] of Object.entries(parentGroups)) {
      console.log(`\nParent: ${parentKey}`);
      
      // Check for duplicate pathParts under same parent
      const pathPartCounts = {};
      children.forEach(child => {
        pathPartCounts[child.pathPart] = (pathPartCounts[child.pathPart] || 0) + 1;
      });
      
      const duplicates = Object.entries(pathPartCounts).filter(([_, count]) => count > 1);
      
      if (duplicates.length > 0) {
        console.log('  ⚠️  DUPLICATE PATH PARTS FOUND:');
        duplicates.forEach(([pathPart, count]) => {
          const duplicateResources = children.filter(c => c.pathPart === pathPart);
          console.log(`    ${pathPart}: ${count} resources - ${duplicateResources.map(r => r.id).join(', ')}`);
        });
      }
      
      children.forEach(child => {
        const isDuplicate = pathPartCounts[child.pathPart] > 1;
        const marker = isDuplicate ? ' ⚠️' : '';
        console.log(`  - ${child.pathPart} (${child.id})${marker}`);
      });
    }
    
    console.log('\n' + '='.repeat(80));
    console.log(`Total API Gateway Resources: ${Object.keys(apiResources).length}`);
    console.log('='.repeat(80) + '\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stdout) console.error('STDOUT:', error.stdout.toString());
    if (error.stderr) console.error('STDERR:', error.stderr.toString());
    process.exit(1);
  }
}

printResourceHierarchy().catch(console.error);

