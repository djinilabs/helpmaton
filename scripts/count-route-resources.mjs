#!/usr/bin/env node
/**
 * Count API Gateway route resources in a CloudFormation template
 * 
 * Usage:
 *   node scripts/count-route-resources.mjs <template-file>
 */

import { readFileSync } from 'fs';

const templateFile = process.argv[2];

if (!templateFile) {
  console.error('Usage: node scripts/count-route-resources.mjs <template-file>');
  process.exit(1);
}

try {
  const template = JSON.parse(readFileSync(templateFile, 'utf8'));
  const resources = template.Resources || {};
  
  const routeResourceTypes = [
    'AWS::ApiGateway::Method',
    'AWS::ApiGateway::Integration',
    'AWS::ApiGateway::Resource'
  ];
  
  const count = Object.values(resources).filter(
    res => routeResourceTypes.includes(res?.Type)
  ).length;
  
  console.log(count);
  process.exit(0);
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}

