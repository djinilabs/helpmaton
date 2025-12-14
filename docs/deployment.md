# Deployment Guide

This document describes the automated deployment process for Helpmaton, including required GitHub secrets, environment variables, and domain configuration.

## Overview

Helpmaton uses GitHub Actions to automatically deploy to production when tests pass on the main branch. The deployment workflow:

1. Triggers automatically when the "Tests" workflow completes successfully on main
2. Sets up AWS credentials
3. Installs dependencies
4. Configures environment variables
5. Builds the frontend
6. Deploys the backend using Architect Framework
7. Registers Discord slash commands (if Discord credentials are configured)

## Deployment Workflow

The deployment workflow (`.github/workflows/deploy-prod.yml`) runs automatically after successful tests on the main branch. It:

- Only runs when tests pass on the main branch
- Configures AWS credentials for deployment
- Sets all required environment variables using `arc env --add --env production`
- Builds the frontend application
- Deploys the backend using `arc deploy --production --no-hydrate --verbose`
- Registers Discord slash commands with Discord API (if credentials are provided)

## Required GitHub Secrets

The following secrets must be configured in your GitHub repository settings (Settings → Secrets and variables → Actions):

### AWS Credentials

- **`AWS_ACCESS_KEY_ID`**: AWS access key ID for deployment

  - Required permissions: CloudFormation, Lambda, API Gateway, DynamoDB, S3, Route53, ACM
  - How to create: AWS IAM → Users → Create user with programmatic access → Attach policies

- **`AWS_SECRET_ACCESS_KEY`**: AWS secret access key for deployment
  - Must be paired with the access key ID above

### Application Secrets

- **`AUTH_SECRET`**: JWT token signing secret

  - Generate using: `openssl rand -base64 32` or `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
  - Must be a cryptographically secure random string

- **`MAILGUN_KEY`**: Mailgun API key for sending authentication emails

  - Obtain from: https://www.mailgun.com → Domain settings → API keys

- **`MAILGUN_DOMAIN`**: (Optional) Mailgun domain for sending emails

  - Defaults to `helpmaton.com` if not set
  - Example: `mg.helpmaton.com` or `helpmaton.com`

- **`BASE_URL`**: Production base URL

  - Example: `https://app.helpmaton.com`
  - Used for generating magic link URLs in authentication emails

- **`GEMINI_API_KEY`**: Google Gemini API key for AI agent functionality
  - Obtain from: https://makersuite.google.com/app/apikey
  - Required for agent webhook functionality

### Lemon Squeezy (Payment Integration)

- **`LEMON_SQUEEZY_API_KEY`**: Lemon Squeezy API key for authenticating API requests

  - Obtain from: https://app.lemonsqueezy.com → Settings → API
  - Use test mode keys (`sk_test_`) for staging, production keys (`sk_live_`) for production
  - Required for subscription management and checkout creation

- **`LEMON_SQUEEZY_WEBHOOK_SECRET`**: Webhook signing secret for verifying webhook authenticity

  - Obtain from: https://app.lemonsqueezy.com → Settings → Webhooks
  - Create webhook endpoint: `https://app.helpmaton.com/api/webhooks/lemonsqueezy`
  - Copy the "Signing Secret" (starts with `whsec_`)
  - Required for webhook signature verification

- **`LEMON_SQUEEZY_STORE_ID`**: Your Lemon Squeezy store ID

  - Obtain from: https://app.lemonsqueezy.com → Settings → General
  - Copy your Store ID (numeric value)
  - Required for creating checkout sessions

- **`LEMON_SQUEEZY_STARTER_VARIANT_ID`**: Lemon Squeezy variant ID for Starter plan (29 EUR/month)

  - Obtain from: https://app.lemonsqueezy.com → Products
  - Create or select your Starter plan product
  - Create a variant with price: 29 EUR, billing period: Monthly
  - Copy the Variant ID (numeric value)
  - Required for Starter plan checkout

- **`LEMON_SQUEEZY_PRO_VARIANT_ID`**: Lemon Squeezy variant ID for Pro plan (99 EUR/month)

  - Obtain from: https://app.lemonsqueezy.com → Products
  - Create or select your Pro plan product
  - Create a variant with price: 99 EUR, billing period: Monthly
  - Copy the Variant ID (numeric value)
  - Required for Pro plan checkout

- **`LEMON_SQUEEZY_CREDIT_VARIANT_ID`**: Lemon Squeezy variant ID for credit purchases

  - Obtain from: https://app.lemonsqueezy.com → Products
  - Create a new product named "Credits" or "Workspace Credits"
  - Create a single variant with any price (e.g., 1 EUR) - the price will be overridden with custom_price during checkout
  - Copy the Variant ID (numeric value)
  - Required for credit purchase functionality
  - Note: Even with custom prices, a variant ID is required

- **`LEMON_SQUEEZY_CHECKOUT_SUCCESS_URL`**: (Optional) URL to redirect users after successful payment

  - Defaults to `{BASE_URL}/subscription?success=true`
  - Example: `https://app.helpmaton.com/subscription?success=true`

- **`LEMON_SQUEEZY_CHECKOUT_CANCEL_URL`**: (Optional) URL to redirect users if they cancel checkout
  - Defaults to `{BASE_URL}/subscription?cancelled=true`
  - Example: `https://app.helpmaton.com/subscription?cancelled=true`

### Discord Integration (Optional)

- **`DISCORD_APPLICATION_ID`**: Discord application ID for slash command registration

  - Obtain from: https://discord.com/developers/applications → Your Application → General Information
  - Required for Discord slash command registration

- **`DISCORD_CS_BOT_TOKEN`**: Discord bot token for command registration
  - Obtain from: https://discord.com/developers/applications → Your Application → Bot → Token
  - Required for Discord slash command registration
  - Note: This is different from the bot tokens used in workspace channels

### Domain Configuration

- **`HELPMATON_CUSTOM_DOMAIN`**: Custom domain name for the application

  - Example: `app.helpmaton.com`
  - This is the domain that will be configured in API Gateway and CloudFront

- **`AWS_CERTIFICATE_ARN`**: ACM certificate ARN for the domain

  - Must be in the `eu-west-2` region (same as API Gateway)
  - Must cover the custom domain (e.g., `app.helpmaton.com`)
  - How to create:
    1. Go to AWS Certificate Manager (ACM) in eu-west-2 region
    2. Request a public certificate
    3. Enter your domain name (e.g., `app.helpmaton.com`)
    4. Validate the certificate via DNS or email
    5. Copy the certificate ARN

- **`AWS_ZONE_ID`**: Route53 hosted zone ID for helpmaton.com
  - How to find:
    1. Go to Route53 → Hosted zones
    2. Find the hosted zone for `helpmaton.com`
    3. Copy the Hosted zone ID (starts with `Z`)

## Setting Up GitHub Secrets

1. Go to your GitHub repository
2. Navigate to **Settings → Secrets and variables → Actions**
3. Click **New repository secret**
4. Add each secret listed above with its corresponding value
5. Click **Add secret** to save

## Environment Variables in Production

The deployment workflow automatically sets the following environment variables in the production environment:

- `AUTH_SECRET` - JWT signing secret
- `MAILGUN_KEY` - Mailgun API key
- `MAILGUN_DOMAIN` - Mailgun domain (if provided)
- `BASE_URL` - Production base URL
- `GEMINI_API_KEY` - Google Gemini API key
- `HELPMATON_CUSTOM_DOMAIN` - Custom domain name
- `AWS_CERTIFICATE_ARN` - ACM certificate ARN
- `AWS_ZONE_ID` - Route53 hosted zone ID
- `LEMON_SQUEEZY_API_KEY` - Lemon Squeezy API key
- `LEMON_SQUEEZY_WEBHOOK_SECRET` - Lemon Squeezy webhook signing secret
- `LEMON_SQUEEZY_STORE_ID` - Lemon Squeezy store ID
- `LEMON_SQUEEZY_STARTER_VARIANT_ID` - Starter plan variant ID
- `LEMON_SQUEEZY_PRO_VARIANT_ID` - Pro plan variant ID
- `LEMON_SQUEEZY_CREDIT_VARIANT_ID` - Credit purchase variant ID
- `LEMON_SQUEEZY_CHECKOUT_SUCCESS_URL` - (Optional) Success redirect URL
- `LEMON_SQUEEZY_CHECKOUT_CANCEL_URL` - (Optional) Cancel redirect URL

These are set using `arc env --add --env production` during deployment.

## Domain and SSL Certificate Setup

### Prerequisites

1. **Domain**: You must own the `helpmaton.com` domain
2. **Route53**: The domain must be managed in AWS Route53
3. **SSL Certificate**: An ACM certificate must be created in the `eu-west-2` region

### Custom Domain Plugin

The deployment uses a custom domain plugin (`apps/backend/src/plugins/custom-domain/index.js`) that automatically configures:

- API Gateway custom domain
- CloudFront distribution with the custom domain
- Route53 DNS records
- SSL/TLS certificate association

The plugin reads the following environment variables:

- `HELPMATON_CUSTOM_DOMAIN` - The domain name to configure
- `AWS_CERTIFICATE_ARN` - The ACM certificate ARN
- `AWS_ZONE_ID` - The Route53 hosted zone ID

### Certificate Requirements

- **Region**: Must be in `eu-west-2` (same as API Gateway)
- **Domain**: Must cover `app.helpmaton.com` (or your chosen subdomain)
- **Status**: Must be validated and active before deployment
- **Type**: Public certificate (not private)

### Route53 Configuration

- The hosted zone for `helpmaton.com` must exist in Route53
- The deployment will automatically create DNS records for the custom domain
- Ensure the hosted zone ID is correct in the `AWS_ZONE_ID` secret

### CloudFront SPA Routing

The application uses a CloudFront function to handle SPA (Single Page Application) routing. This replaces the previous error page configuration (404/403 -> /index.html) with a more efficient solution that only applies to HTML document requests.

#### Setting Up CloudFront Function

1. **Create the CloudFront Function:**

   - Go to AWS Console → CloudFront → Functions
   - Click **Create function**
   - Enter a function name (e.g., `spa-routing`)
   - Copy the code from `apps/backend/cloudfront-spa-function.js` and paste it into the function editor
   - Click **Create function**

2. **Publish the Function:**

   - After creating the function, click **Publish** to make it available for use
   - Note the function ARN or name for the next step

3. **Associate Function with CloudFront Distribution:**

   - Go to CloudFront → Distributions
   - Select your distribution (the one serving your custom domain)
   - Go to the **Behaviors** tab
   - Select the default behavior (or the behavior serving your SPA)
   - Click **Edit**
   - Scroll down to **Function associations**
   - Under **Viewer request**, select **CloudFront Function** from the dropdown
   - Select your function from the list
   - Click **Save changes**

4. **Remove Error Page Configuration:**

   - In the same behavior settings, scroll to **Custom error responses**
   - Remove any custom error responses that redirect 404/403 to `/index.html`
   - These are no longer needed since the CloudFront function handles routing
   - Click **Save changes**

5. **Wait for Distribution Deployment:**
   - CloudFront distributions take 5-15 minutes to deploy changes
   - Monitor the distribution status until it shows "Deployed"

#### How It Works

The CloudFront function intercepts viewer requests before they reach the origin:

- **HTML Document Requests**: If the request Accept header includes `text/html` OR the URI has no file extension, the function rewrites the URI to `/index.html`
- **Static Assets**: Requests for files with extensions (`.js`, `.css`, `.png`, etc.) are passed through unchanged
- **Query Strings**: Query strings are preserved when rewriting to `/index.html`

This approach is more efficient than error pages because:

- It only applies to HTML document requests
- It rewrites the URI before querying the origin (no need to wait for a 404/403 response)
- Static assets are never affected

## Deployment Process

1. **Push to main**: When code is pushed to the main branch, the "Tests" workflow runs
2. **Tests pass**: If all tests pass (typecheck, lint, test), the "Deploy Prod" workflow is triggered
3. **Deployment**: The workflow:
   - Sets up AWS credentials
   - Installs dependencies
   - Configures environment variables
   - Builds the frontend
   - Deploys the backend with custom domain configuration
   - Registers Discord slash commands (if Discord credentials are provided)

## Manual Deployment

If you need to deploy manually (not recommended for production):

```bash
# Set environment variables
export AUTH_SECRET="your-secret"
export MAILGUN_KEY="your-key"
export BASE_URL="https://app.helpmaton.com"
export GEMINI_API_KEY="your-key"
export HELPMATON_CUSTOM_DOMAIN="app.helpmaton.com"
export AWS_CERTIFICATE_ARN="arn:aws:acm:eu-west-2:..."
export AWS_ZONE_ID="Z..."
export LEMON_SQUEEZY_API_KEY="sk_live_your_api_key"
export LEMON_SQUEEZY_WEBHOOK_SECRET="whsec_your_webhook_secret"
export LEMON_SQUEEZY_STORE_ID="12345"
export LEMON_SQUEEZY_STARTER_VARIANT_ID="67890"
export LEMON_SQUEEZY_PRO_VARIANT_ID="67891"
export LEMON_SQUEEZY_CREDIT_VARIANT_ID="123456"

# Build frontend
pnpm build

# Deploy backend
cd apps/backend
pnpm arc env --add --env production AUTH_SECRET "${AUTH_SECRET}"
pnpm arc env --add --env production MAILGUN_KEY "${MAILGUN_KEY}"
pnpm arc env --add --env production BASE_URL "${BASE_URL}"
pnpm arc env --add --env production GEMINI_API_KEY "${GEMINI_API_KEY}"
pnpm arc env --add --env production HELPMATON_CUSTOM_DOMAIN "${HELPMATON_CUSTOM_DOMAIN}"
pnpm arc env --add --env production AWS_CERTIFICATE_ARN "${AWS_CERTIFICATE_ARN}"
pnpm arc env --add --env production AWS_ZONE_ID "${AWS_ZONE_ID}"
pnpm arc env --add --env production LEMON_SQUEEZY_API_KEY "${LEMON_SQUEEZY_API_KEY}"
pnpm arc env --add --env production LEMON_SQUEEZY_WEBHOOK_SECRET "${LEMON_SQUEEZY_WEBHOOK_SECRET}"
pnpm arc env --add --env production LEMON_SQUEEZY_STORE_ID "${LEMON_SQUEEZY_STORE_ID}"
pnpm arc env --add --env production LEMON_SQUEEZY_STARTER_VARIANT_ID "${LEMON_SQUEEZY_STARTER_VARIANT_ID}"
pnpm arc env --add --env production LEMON_SQUEEZY_PRO_VARIANT_ID "${LEMON_SQUEEZY_PRO_VARIANT_ID}"
pnpm arc env --add --env production LEMON_SQUEEZY_CREDIT_VARIANT_ID "${LEMON_SQUEEZY_CREDIT_VARIANT_ID}"
pnpm arc deploy --production --no-hydrate --verbose
```

## Troubleshooting

### Deployment Fails

1. **Check AWS credentials**: Verify `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are correct
2. **Check permissions**: Ensure the AWS user has necessary permissions
3. **Check certificate**: Verify the ACM certificate exists in `eu-west-2` and is validated
4. **Check Route53**: Verify the hosted zone ID is correct

### Domain Not Working

1. **Check DNS propagation**: DNS changes can take up to 48 hours
2. **Verify certificate**: Ensure the certificate covers the domain
3. **Check CloudFormation**: Review the CloudFormation stack for errors
4. **Check API Gateway**: Verify the custom domain is configured in API Gateway

### Environment Variables Not Set

1. **Check secrets**: Verify all required secrets are set in GitHub
2. **Check workflow logs**: Review the deployment workflow logs for errors
3. **Verify arc env**: Check that `arc env --add` commands succeeded

## Security Best Practices

1. **Rotate secrets regularly**: Periodically rotate `AUTH_SECRET` and API keys
2. **Use different secrets per environment**: Never reuse production secrets in development
3. **Limit AWS permissions**: Use IAM policies with minimal required permissions
4. **Monitor deployments**: Review deployment logs for any suspicious activity
5. **Enable MFA**: Require multi-factor authentication for AWS accounts

## Containerized Lambda Functions

Helpmaton supports containerized Lambda functions using Docker images. This allows you to use custom base images with system libraries or native dependencies.

### Configuration

Containerized Lambda functions are configured in `app.arc` using the `@container-images` pragma:

```
@container-images
method route image-name
any /api/streams/:workspaceId/:agentId/:secret my-custom-image
```

Format: `{method} {route} {image-name}`

### Docker Images

Docker images are stored in `apps/backend/docker/`:

- `base/Dockerfile` - Base image with Node.js 20.x
- `{image-name}/Dockerfile` - Custom images extending base or using different base images

### Building Images

Images are automatically built and pushed to ECR during deployment. The build script:

1. Parses `@container-images` pragma from `app.arc`
2. Builds Docker images for each specified image name
3. Pushes images to ECR repository: `helpmaton-lambda-images`
4. Tags images with commit SHA and `latest`

### ECR Repository

The ECR repository is automatically created by the container-images plugin if it doesn't exist. The repository:

- Name: `helpmaton-lambda-images`
- Region: `eu-west-2`
- Image scanning: Enabled on push
- Lifecycle policy: Keeps last 10 images per tag

### Image URI Format

Images are tagged with the format: `{image-name}:{tag}` where:

- `image-name` is specified in the `@container-images` pragma
- `tag` is the commit SHA (for reproducibility) or `latest`

Full ECR URI: `{account-id}.dkr.ecr.{region}.amazonaws.com/{repository-name}:{image-name}-{tag}`

### Manual Build

To build images manually:

```bash
# Set environment variables
export AWS_REGION=eu-west-2
export LAMBDA_IMAGES_ECR_REPOSITORY=helpmaton-lambda-images
export LAMBDA_IMAGE_TAG=latest

# Build backend first
cd apps/backend
pnpm exec arc package --quiet

# Build and push images
cd ../..
bash scripts/build-and-push-lambda-images.sh
```

### Requirements

- Docker must be installed
- AWS credentials must be configured for ECR access
- The `dist/` directory must exist (built via `pnpm build` or `arc package`)

### Notes

- Functions not in `@container-images` continue using ZIP deployment
- Images should be kept small to reduce cold start times
- Use multi-stage builds if you need to compile dependencies
- The base image already includes Node.js 20.x and Lambda runtime interface client

## Additional Resources

- [Architect Framework Documentation](https://arc.codes/)
- [AWS Certificate Manager](https://aws.amazon.com/certificate-manager/)
- [Route53 Documentation](https://docs.aws.amazon.com/route53/)
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [AWS Lambda Container Images](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html)
- [Amazon ECR Documentation](https://docs.aws.amazon.com/ecr/)
