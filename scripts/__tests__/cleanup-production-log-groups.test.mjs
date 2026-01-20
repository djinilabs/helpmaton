import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLambdaLogGroupName,
  collectExpectedLogGroups,
  extractLambdaFunctionName,
  filterLogGroupsByPattern,
  getUnusedLogGroups,
} from '../cleanup-production-log-groups.mjs';

test('extractLambdaFunctionName handles plain names', () => {
  assert.equal(extractLambdaFunctionName('helpmaton-fn'), 'helpmaton-fn');
});

test('extractLambdaFunctionName handles Lambda ARN', () => {
  const arn = 'arn:aws:lambda:eu-west-2:123456789:function:helpmaton-fn';
  assert.equal(extractLambdaFunctionName(arn), 'helpmaton-fn');
});

test('extractLambdaFunctionName handles ARN with alias', () => {
  const arn = 'arn:aws:lambda:eu-west-2:123456789:function:helpmaton-fn:prod';
  assert.equal(extractLambdaFunctionName(arn), 'helpmaton-fn');
});

test('buildLambdaLogGroupName formats name', () => {
  assert.equal(buildLambdaLogGroupName('helpmaton-fn'), '/aws/lambda/helpmaton-fn');
});

test('collectExpectedLogGroups combines lambda and log group resources', () => {
  const resources = [
    {
      ResourceType: 'AWS::Lambda::Function',
      PhysicalResourceId: 'helpmaton-fn',
    },
    {
      ResourceType: 'AWS::Lambda::Function',
      PhysicalResourceId: 'arn:aws:lambda:eu-west-2:123:function:another-fn:prod',
    },
    {
      ResourceType: 'AWS::Logs::LogGroup',
      PhysicalResourceId: '/aws/lambda/explicit-log-group',
    },
  ];

  const expected = collectExpectedLogGroups(resources);

  assert.equal(expected.size, 3);
  assert.ok(expected.has('/aws/lambda/helpmaton-fn'));
  assert.ok(expected.has('/aws/lambda/another-fn'));
  assert.ok(expected.has('/aws/lambda/explicit-log-group'));
});

test('filterLogGroupsByPattern matches regex', () => {
  const names = [
    '/aws/lambda/HelpmatonProduction-foo',
    '/aws/lambda/HelpmatonStagingPR123-bar',
  ];
  const pattern = /^\/aws\/lambda\/HelpmatonProduction/;

  assert.deepEqual(filterLogGroupsByPattern(names, pattern), [
    '/aws/lambda/HelpmatonProduction-foo',
  ]);
});

test('getUnusedLogGroups returns diff between matching and expected', () => {
  const logGroupNames = [
    '/aws/lambda/HelpmatonProduction-used',
    '/aws/lambda/HelpmatonProduction-unused',
    '/aws/lambda/HelpmatonStagingPR123-other',
  ];
  const expectedLogGroups = new Set(['/aws/lambda/HelpmatonProduction-used']);
  const pattern = /^\/aws\/lambda\/HelpmatonProduction/;

  const unused = getUnusedLogGroups({
    logGroupNames,
    expectedLogGroups,
    pattern,
  });

  assert.deepEqual(unused, ['/aws/lambda/HelpmatonProduction-unused']);
});
