# ECR Image Cleanup Strategy

## Overview

The ECR Image Cleanup system automatically removes unused Docker images from the `helpmaton-lambda-images` ECR repository while protecting images that are currently deployed or needed for production rollbacks.

## Features

- **Safe deletion**: Never deletes images currently deployed in any environment
- **Production protection**: Keeps the last N production deployments for rollback capability
- **PR environment aware**: Protects images from active PR environments
- **Age-based safety**: Won't delete images newer than 24 hours (configurable)
- **Dry-run mode**: Test cleanup logic without actually deleting images
- **Automated**: Runs weekly via GitHub Actions

## How It Works

### Protection Layers

The cleanup script uses multiple layers of protection to ensure safety:

1. **Currently Deployed Images** (CRITICAL)

   - Queries all active CloudFormation stacks (production + PR environments)
   - Extracts image URIs from Lambda functions
   - Builds a protected set of image digests and tags
   - Never deletes any image in this set

2. **Minimum Age Check** (SAFETY)

   - Won't delete images newer than 24 hours (default)
   - Prevents race conditions with ongoing deployments
   - Configurable via `MIN_IMAGE_AGE_HOURS`

3. **Production Retention**

   - Keeps last N production images for rollback capability
   - Default: 15 images (~2 months of daily deploys)
   - Configurable via `PRODUCTION_IMAGE_RETENTION_COUNT`

4. **Open PR Check**
   - Checks GitHub API for open PRs
   - Protects images from PRs that are still active
   - Requires `GITHUB_TOKEN` to be set

### Deletion Decision Tree

For each image in ECR, the script follows this logic:

```
1. Is image currently deployed? → KEEP
2. Is image < 24 hours old? → KEEP
3. Is image tagged as "latest"? → KEEP
4. Is image a production image?
   a. Within retention count? → KEEP
   b. Outside retention count? → DELETE
5. Is image pattern unknown/invalid? → KEEP (safety)
6. Otherwise → DELETE
```

### Image Classification

Images are classified by their tags:

- **Valid format**: `lancedb-{commit-sha}` (e.g., `lancedb-abc123def456`)
- **Latest tag**: `lancedb-latest` (always protected)
- **Untagged**: Images with no tags (deleted if old enough)
- **Unknown**: Images not matching expected patterns (kept for safety)

## Usage

### Manual Execution

**Dry run (recommended first):**

```bash
pnpm cleanup-ecr:dry-run
# or
node scripts/cleanup-ecr-images.mjs --dry-run
```

**Execute deletion:**

```bash
pnpm cleanup-ecr:execute
# or
node scripts/cleanup-ecr-images.mjs --execute
```

**Custom parameters:**

```bash
node scripts/cleanup-ecr-images.mjs \
  --execute \
  --retention 20 \
  --min-age 48 \
  --region eu-west-2
```

### GitHub Actions Workflow

The cleanup runs automatically via GitHub Actions:

**Schedule**: Daily at 2 AM UTC (dry-run mode by default)

**Manual Trigger**:

1. Go to Actions → "Cleanup ECR Images"
2. Click "Run workflow"
3. Configure parameters:
   - **Dry run**: `true` (simulate) or `false` (execute)
   - **Production retention**: Number of images to keep (default: 15)
   - **Minimum age**: Hours before image can be deleted (default: 24)

## Configuration

### Environment Variables

| Variable                           | Description                         | Default                   |
| ---------------------------------- | ----------------------------------- | ------------------------- |
| `ECR_REPOSITORY_NAME`              | ECR repository name                 | `helpmaton-lambda-images` |
| `PRODUCTION_STACK_NAME`            | Production CloudFormation stack     | `HelpmatonProduction`     |
| `PR_STACK_PREFIX`                  | Prefix for PR stacks                | `HelpmatonStagingPR`      |
| `PRODUCTION_IMAGE_RETENTION_COUNT` | Number of production images to keep | `15`                      |
| `MIN_IMAGE_AGE_HOURS`              | Minimum image age before deletion   | `24`                      |
| `AWS_REGION`                       | AWS region                          | `eu-west-2`               |
| `GITHUB_TOKEN`                     | GitHub API token (for PR checks)    | Required                  |
| `GITHUB_REPOSITORY`                | GitHub repository (owner/repo)      | `djinilabs/helpmaton`     |
| `DRY_RUN`                          | Set to `false` to execute deletions | `true`                    |

### Recommended Settings

**Initial deployment** (first month):

- Production retention: 15 images
- Minimum age: 24 hours
- Dry-run: true
- Frequency: Daily

**Production (after validation)**:

- Production retention: 15-20 images
- Minimum age: 24-48 hours
- Dry-run: false (for manual triggers only)
- Frequency: Daily

## Safety Features

### Protected Image Set

The script builds a complete set of protected images by:

1. Querying production CloudFormation stack
2. Querying all PR CloudFormation stacks
3. Extracting image URIs from all Lambda functions
4. Collecting both image tags and digests

**Result**: A comprehensive set of images that must never be deleted.

### Edge Case Handling

| Scenario                        | Protection Mechanism                                        |
| ------------------------------- | ----------------------------------------------------------- |
| Image deleted during deployment | 24-hour minimum age prevents deletion of recent images      |
| PR deployment in progress       | Query current stack state; in-use images are protected      |
| Failed deployment               | 24-hour age + open PR check keeps failed deployment images  |
| Production rollback needed      | Keep last N production images (15+) for rollback capability |
| Manual deployment               | Protected set includes ALL currently deployed images        |
| Unknown image patterns          | Conservative approach: keep unrecognized patterns           |

## Monitoring

### Cleanup Report

Each run generates a detailed report:

```
ECR Image Cleanup Report
========================
Repository: helpmaton-lambda-images
Execution Time: 2025-12-18 02:00:00 UTC
Mode: DRY RUN

Summary:
  Total images:           76
  Protected (in use):     12
    - Production:         1
    - PR environments:    11

  Deletion candidates:    53
    - Old PR images:      45
    - Old prod images:    5
    - Other old images:   3

  Would delete:          53
  Failed:                 0

Protected Images:
  • lancedb-abc123 (Production)
  • lancedb-def456 (PR #123)
  ...

Deletion Candidates:
  • lancedb-xyz123 - Old image (78.5h old, not in use)
  • <untagged> - Untagged image (120.3h old)
  ...

Configuration:
  Production retention:   15 images
  Minimum image age:      24 hours
  Region:                 eu-west-2
  Dry run:                true
```

### Metrics to Monitor

1. **Total images**: Should stabilize after initial cleanup
2. **Protected images**: Should match number of active environments
3. **Deletion candidates**: Should decrease over time
4. **Failed deletions**: Should be zero (investigate if non-zero)

### GitHub Actions Artifacts

Each workflow run uploads a cleanup report artifact:

- Name: `ecr-cleanup-report-{run_number}`
- Retention: 30 days
- Contains: Full execution log and report

## Troubleshooting

### No Images Deleted

**Symptoms**: Script runs but reports 0 deletion candidates

**Possible causes**:

1. All images are within minimum age (< 24 hours)
2. All images are currently deployed
3. All images are within production retention count

**Diagnosis**:

```bash
# Check image ages
node scripts/cleanup-ecr-images.mjs --dry-run

# Check protected images count
# Should match: 1 (production) + N (active PRs)
```

### Protected Images Count is Zero

**Symptoms**: Report shows 0 protected production images

**Possible causes**:

1. Production stack name is incorrect
2. Lambda functions don't use container images
3. Stack query failed

**Diagnosis**:

```bash
# Verify stack exists
aws cloudformation describe-stacks --stack-name HelpmatonProduction

# Check Lambda functions in stack
aws cloudformation describe-stack-resources \
  --stack-name HelpmatonProduction \
  --query 'StackResources[?ResourceType==`AWS::Lambda::Function`]'
```

### Images Deleted Too Aggressively

**Symptoms**: Images needed for rollback were deleted

**Solution**:

1. Increase `PRODUCTION_IMAGE_RETENTION_COUNT`
2. Increase `MIN_IMAGE_AGE_HOURS`
3. Review deletion logic in dry-run mode first

**Recovery**:

- ECR doesn't support image recovery
- Rebuild images from commit SHA
- Deploy from backup environment

### GitHub API Rate Limiting

**Symptoms**: Warning about PR checks failing

**Solution**:

1. Ensure `GITHUB_TOKEN` is set
2. Use a token with sufficient rate limits
3. Script will conservatively keep images if checks fail

## Cost Impact

### Before Cleanup

Estimated with unlimited growth:

- 500+ images × 500MB avg = 250GB+ storage
- At $0.10/GB-month = $25+/month and growing

### After Cleanup

Estimated steady state:

- ~50 active images (15 production + 35 active PRs)
- 50 × 500MB = 25GB storage
- At $0.10/GB-month = $2.50/month

**Savings**: ~$22.50/month (90% reduction)

## Maintenance

### Weekly Tasks (Automated)

- Review cleanup report in GitHub Actions
- Verify deletion counts are reasonable
- Check for any warnings or errors

### Monthly Tasks

- Review total image count trend
- Adjust retention count if needed
- Verify cost savings in AWS Cost Explorer

### Quarterly Tasks

- Review and tune configuration parameters
- Update documentation if process changes
- Audit cleanup logic for edge cases

## Security

### IAM Permissions Required

The cleanup script requires these AWS permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:ListStacks",
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackResources",
        "lambda:GetFunction",
        "ecr:DescribeImages",
        "ecr:BatchDeleteImage"
      ],
      "Resource": "*"
    }
  ]
}
```

### GitHub Token

The `GITHUB_TOKEN` requires these permissions:

- `pull_requests: read` - Check PR status

**Note**: The automatic `GITHUB_TOKEN` provided by GitHub Actions has these permissions by default.

## References

- **Cleanup Script**: [`scripts/cleanup-ecr-images.mjs`](../scripts/cleanup-ecr-images.mjs)
- **Utilities**: [`scripts/ecr-utils.mjs`](../scripts/ecr-utils.mjs)
- **GitHub Workflow**: [`.github/workflows/cleanup-ecr-images.yml`](../.github/workflows/cleanup-ecr-images.yml)
- **Unit Tests**: [`scripts/__tests__/ecr-utils.test.mjs`](../scripts/__tests__/ecr-utils.test.mjs)

## Support

For issues or questions:

1. Check this documentation first
2. Review cleanup reports in GitHub Actions artifacts
3. Test in dry-run mode to diagnose issues
4. Adjust configuration parameters as needed
5. Contact team if problems persist
