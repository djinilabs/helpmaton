# Helpmaton Documentation

Welcome to the Helpmaton documentation! This folder contains comprehensive guides for using the platform.

## Documentation Index

### Getting Started
- **[Getting Started Guide](./getting-started.md)** - New to Helpmaton? Start here for a quick introduction and basic setup.

### Core Features
- **[Agent Configuration](./agent-configuration.md)** - Learn how to create, configure, and manage AI agents.
- **[Document Management](./document-management.md)** - Guide to uploading, organizing, and managing documents.
- **[Workspace Permissions](./workspace-permissions.md)** - Understanding the permission system and access control.

### Reference
- **[API Reference](./api-reference.md)** - Complete API endpoint documentation.
- **[Pricing Calculation](./pricing-calculation.md)** - How token usage costs are calculated.
- **[Troubleshooting](./troubleshooting.md)** - Common issues and their solutions.

## Quick Links

- **Create Your First Workspace**: See [Getting Started](./getting-started.md#quick-start)
- **Set Up an Agent**: Read [Agent Configuration](./agent-configuration.md#creating-an-agent)
- **Upload Documents**: Follow [Document Management](./document-management.md#uploading-documents)
- **Understand Permissions**: Review [Workspace Permissions](./workspace-permissions.md#permission-levels)

## Document Organization

This documentation is organized into folders for easy navigation:

- `docs/` - Main documentation (this folder)
- Additional folders can be created as needed

## Internal docs (workspace / meta-agent)

A subset of these docs is bundled for the **workspace assistant** and **Configure with AI (meta-agent)** so they can answer product and support questions. The list is kept in `scripts/generate-internal-docs.mjs` (whitelist). To add a doc there:

1. Add its id (filename without `.md`) to the `WHITELIST` in that script.
2. Run `pnpm generate:internal-docs` (or start the backend sandbox; it regenerates when the script or any `docs/*.md` changes).

Generated output is `apps/backend/src/utils/internalDocs.ts`. Do not edit that file by hand.

## Contributing to Documentation

When adding new documentation:

1. Use clear, descriptive filenames
2. Follow markdown formatting conventions
3. Include examples where helpful
4. Keep content up-to-date with platform changes
5. Organize related content into appropriate folders

## Need Help?

If you can't find what you're looking for:

1. Check the [Troubleshooting Guide](./troubleshooting.md)
2. Review the [API Reference](./api-reference.md) for technical details
3. Contact your workspace administrator

