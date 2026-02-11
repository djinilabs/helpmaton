# Security Policy

## Supported versions

Security updates are provided for the current production deployment (the `main` branch and what is deployed from it). We do not maintain separate long-term support branches unless stated otherwise.

## How to report a vulnerability

**Please do not open public issues for security vulnerabilities.**

Report security issues by email to:

- **security@helpmaton.com**
- When reporting, please include: a short description of the issue, steps to reproduce, and the impact you believe it has.

We will acknowledge your report within 48–72 hours and aim to send a more detailed response within 7 days.

## Scope

- **In scope:** The Helpmaton application and APIs, including authentication, data handling, and backend/Lambda code we maintain.
- **Out of scope:** Third-party services we do not control; issues that require physical access or social engineering; theoretical issues with no practical exploit.

For security-relevant behaviour of the app (e.g. headers, auth), see [docs/security-headers.md](docs/security-headers.md) and [docs/authentication.md](docs/authentication.md).

## No bug bounty

We do not run a bug bounty or offer monetary rewards for vulnerability reports.

## Acknowledgments

We may credit reporters (with their permission) in release notes or similar; there is no obligation to do so.

## Safe harbor

Good-faith security research and reporting that follows this policy will not be met with legal action by us.

## Disclosure

We prefer coordinated disclosure: please do not make the vulnerability public before a fix is available (or we have agreed on a disclosure date).
