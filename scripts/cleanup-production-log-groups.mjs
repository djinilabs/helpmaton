#!/usr/bin/env node
/**
 * Cleanup script to remove unused production CloudWatch log groups.
 *
 * It matches log group names by pattern and cross-checks against
 * CloudFormation resources in the HelpmatonProduction stack.
 */

import { CloudFormationClient, paginateListStackResources } from '@aws-sdk/client-cloudformation';
import { CloudWatchLogsClient, DeleteLogGroupCommand, paginateDescribeLogGroups } from '@aws-sdk/client-cloudwatch-logs';
import { fileURLToPath } from 'url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const DEFAULT_REGION = 'eu-west-2';
const DEFAULT_STACK_NAME = 'HelpmatonProduction';
const DEFAULT_LOG_GROUP_PREFIX = '/aws/lambda/HelpmatonProduction';

const LOG_GROUP_RESOURCE_TYPE = 'AWS::Logs::LogGroup';
const LAMBDA_RESOURCE_TYPE = 'AWS::Lambda::Function';

const COLORS = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
};

const printStatus = (message) => console.log(`${COLORS.blue}[INFO]${COLORS.reset} ${message}`);
const printSuccess = (message) => console.log(`${COLORS.green}[SUCCESS]${COLORS.reset} ${message}`);
const printWarning = (message) => console.log(`${COLORS.yellow}[WARNING]${COLORS.reset} ${message}`);
const printError = (message) => console.error(`${COLORS.red}[ERROR]${COLORS.reset} ${message}`);
const printHighlight = (message) => console.log(`${COLORS.cyan}[HIGHLIGHT]${COLORS.reset} ${message}`);

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const extractLambdaFunctionName = (physicalResourceId) => {
  if (!physicalResourceId || typeof physicalResourceId !== 'string') {
    return null;
  }

  const arnMatch = physicalResourceId.match(/:function:([^:]+)(?::|$)/);
  if (arnMatch?.[1]) {
    return arnMatch[1];
  }

  return physicalResourceId;
};

export const buildLambdaLogGroupName = (functionName) => {
  if (!functionName) {
    return null;
  }

  return `/aws/lambda/${functionName}`;
};

export const collectExpectedLogGroups = (stackResources) => {
  const expected = new Set();

  for (const resource of stackResources) {
    if (!resource?.ResourceType || !resource?.PhysicalResourceId) {
      continue;
    }

    if (resource.ResourceType === LAMBDA_RESOURCE_TYPE) {
      const functionName = extractLambdaFunctionName(resource.PhysicalResourceId);
      const logGroupName = buildLambdaLogGroupName(functionName);
      if (logGroupName) {
        expected.add(logGroupName);
      }
    }

    if (resource.ResourceType === LOG_GROUP_RESOURCE_TYPE) {
      expected.add(resource.PhysicalResourceId);
    }
  }

  return expected;
};

export const filterLogGroupsByPattern = (logGroupNames, pattern) =>
  logGroupNames.filter((name) => pattern.test(name));

export const getUnusedLogGroups = ({ logGroupNames, expectedLogGroups, pattern }) => {
  const matching = filterLogGroupsByPattern(logGroupNames, pattern);
  return matching.filter((name) => !expectedLogGroups.has(name));
};

const showUsage = () => {
  console.log('Usage: node scripts/cleanup-production-log-groups.mjs [options]');
  console.log('');
  console.log('Options:');
  console.log('  --execute             Perform deletions (default is dry-run)');
  console.log('  --force               Skip confirmation prompt when deleting');
  console.log(`  --region <region>      AWS region (default: ${DEFAULT_REGION})`);
  console.log(`  --stack <name>         CloudFormation stack (default: ${DEFAULT_STACK_NAME})`);
  console.log(`  --prefix <prefix>      Log group prefix to list (default: ${DEFAULT_LOG_GROUP_PREFIX})`);
  console.log('  --pattern <regex>      Regex pattern to match log groups (default: ^<prefix>)');
  console.log('  -h, --help             Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  node scripts/cleanup-production-log-groups.mjs');
  console.log('  node scripts/cleanup-production-log-groups.mjs --execute');
  console.log('  node scripts/cleanup-production-log-groups.mjs --pattern "^/aws/lambda/HelpmatonProduction"');
};

const parseArgs = (argv) => {
  const args = {
    execute: false,
    force: false,
    region: DEFAULT_REGION,
    stackName: DEFAULT_STACK_NAME,
    prefix: DEFAULT_LOG_GROUP_PREFIX,
    pattern: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--execute':
        args.execute = true;
        break;
      case '--force':
        args.force = true;
        break;
      case '--region':
        args.region = argv[i + 1];
        i += 1;
        break;
      case '--stack':
        args.stackName = argv[i + 1];
        i += 1;
        break;
      case '--prefix':
        args.prefix = argv[i + 1];
        i += 1;
        break;
      case '--pattern':
        args.pattern = argv[i + 1];
        i += 1;
        break;
      case '-h':
      case '--help':
        showUsage();
        process.exit(0);
        break;
      default:
        printError(`Unknown option: ${arg}`);
        showUsage();
        process.exit(1);
    }
  }

  return args;
};

const createPattern = (pattern, prefix) => {
  if (pattern) {
    try {
      return new RegExp(pattern);
    } catch (error) {
      throw new Error(`Invalid pattern regex: ${pattern}`);
    }
  }

  return new RegExp(`^${escapeRegExp(prefix)}`);
};

const listStackResources = async (client, stackName) => {
  const resources = [];

  for await (const page of paginateListStackResources({ client }, { StackName: stackName })) {
    if (page?.StackResourceSummaries?.length) {
      resources.push(...page.StackResourceSummaries);
    }
  }

  return resources;
};

const listLogGroups = async (client, prefix) => {
  const logGroupNames = [];

  const paginatorConfig = { client };
  const request = prefix ? { logGroupNamePrefix: prefix } : {};

  for await (const page of paginateDescribeLogGroups(paginatorConfig, request)) {
    if (page?.logGroups?.length) {
      for (const logGroup of page.logGroups) {
        if (logGroup?.logGroupName) {
          logGroupNames.push(logGroup.logGroupName);
        }
      }
    }
  }

  return logGroupNames;
};

const confirmDeletion = async (logGroups) => {
  const rl = readline.createInterface({ input, output });
  printWarning('This will permanently delete the following log groups:');
  logGroups.forEach((name) => printWarning(`  - ${name}`));
  const answer = await rl.question('Continue? (y/N): ');
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const pattern = createPattern(args.pattern, args.prefix);

  printHighlight('Starting production CloudWatch log group cleanup');
  printStatus(`Region: ${args.region}`);
  printStatus(`Stack: ${args.stackName}`);
  printStatus(`Prefix: ${args.prefix}`);
  printStatus(`Pattern: ${pattern}`);

  if (!args.execute) {
    printWarning('DRY RUN - no deletions will be performed');
  }

  const cloudFormation = new CloudFormationClient({ region: args.region });
  const cloudWatchLogs = new CloudWatchLogsClient({ region: args.region });

  printStatus('Fetching stack resources...');
  const stackResources = await listStackResources(cloudFormation, args.stackName);
  printStatus(`Stack resources: ${stackResources.length}`);

  const expectedLogGroups = collectExpectedLogGroups(stackResources);
  printStatus(`Expected log groups from stack: ${expectedLogGroups.size}`);

  printStatus('Fetching log groups...');
  const logGroupNames = await listLogGroups(cloudWatchLogs, args.prefix);
  printStatus(`Log groups fetched: ${logGroupNames.length}`);

  const unusedLogGroups = getUnusedLogGroups({
    logGroupNames,
    expectedLogGroups,
    pattern,
  });

  if (unusedLogGroups.length === 0) {
    printSuccess('No unused log groups found.');
    return;
  }

  printHighlight(`Found ${unusedLogGroups.length} unused log groups:`);
  unusedLogGroups.forEach((name) => printWarning(`  - ${name}`));

  if (!args.execute) {
    printWarning('Run with --execute to delete these log groups.');
    return;
  }

  if (!args.force) {
    const confirmed = await confirmDeletion(unusedLogGroups);
    if (!confirmed) {
      printStatus('Aborted by user.');
      return;
    }
  }

  let successCount = 0;
  let failureCount = 0;

  for (const logGroupName of unusedLogGroups) {
    try {
      await cloudWatchLogs.send(new DeleteLogGroupCommand({ logGroupName }));
      printSuccess(`Deleted ${logGroupName}`);
      successCount += 1;
    } catch (error) {
      printError(`Failed to delete ${logGroupName}: ${error?.message || error}`);
      failureCount += 1;
    }
  }

  printHighlight('Cleanup summary');
  printStatus(`Unused log groups found: ${unusedLogGroups.length}`);
  printSuccess(`Deleted: ${successCount}`);

  if (failureCount > 0) {
    printError(`Failed: ${failureCount}`);
    process.exitCode = 1;
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    printError(error?.message || error);
    process.exit(1);
  });
}
