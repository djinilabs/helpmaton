# Security headers for app.helpmaton.com

The front-end app at **app.helpmaton.com** is served by **AWS CloudFront** (origin: S3). Response headers are determined by CloudFront and the origin; they are **not** set by the React app itself.

## Current headers (as of 2026-02-09)

A request to `https://app.helpmaton.com/` currently returns:

| Header | Present |
|--------|--------|
| `content-type` | Yes (e.g. `text/html`) |
| `content-length` | Yes |
| `cache-control` | Yes (no-cache, no-store, etc.) |
| `date`, `last-modified`, `etag` | Yes |
| `server` | Yes (`AmazonS3`) |
| `x-cache`, `via`, `x-amz-cf-*` | Yes (CloudFront) |
| **`X-Frame-Options`** | **No** |
| **`Content-Security-Policy`** | **No** |
| **`X-Content-Type-Options`** | **No** |
| **`Referrer-Policy`** | **No** |
| **`Strict-Transport-Security`** | **No** |

So the app is **currently embeddable in iframes** and has no explicit security headers from CloudFront.

## Making the app not embeddable

To prevent the app from being embedded in a frame (clickjacking protection), add a **CloudFront response headers policy** that sets:

- **`X-Frame-Options: DENY`** (or use **Content-Security-Policy: frame-ancestors 'none'**)

Use the script below so that changes are repeatable and not done by hand in the AWS console.

## Script: configure CloudFront security headers

Run from the repo root:

```bash
./scripts/configure-cloudfront-security-headers.sh <DISTRIBUTION_ID> [--dry-run]
```

- **DISTRIBUTION_ID**: The CloudFront distribution ID that serves app.helpmaton.com (same as used for `configure-cloudfront-cache-behavior.sh`).
- **--dry-run**: Print what would be done without updating the distribution.

The script:

1. Resolves the AWS managed **Managed-SecurityHeadersPolicy** (includes `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, `Referrer-Policy`).
2. Attaches that policy to the distribution’s **default cache behavior** and to any **custom cache behaviors** (e.g. `/assets/*`) that don’t already have a response headers policy.
3. Updates the CloudFront distribution (deployment can take 5–15 minutes).

After deployment, responses from app.helpmaton.com will include the security headers and the app will **not** be embeddable in a frame.

## Prerequisites

- AWS CLI configured with permissions to read/update the CloudFront distribution and to list response headers policies.
- `jq` installed.

## Verifying

After the distribution has finished deploying:

```bash
curl -sI "https://app.helpmaton.com/"
```

You should see headers such as:

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security: max-age=...`
- `Referrer-Policy: ...`
