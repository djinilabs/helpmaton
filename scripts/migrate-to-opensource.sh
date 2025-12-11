#!/bin/bash

# Open Source Repository Migration Script
# This script creates a new repository with squashed commit history,
# migrates all GitHub secrets, and swaps repository names.
#
# Usage:
#   ./scripts/migrate-to-opensource.sh
#
# Prerequisites:
#   - GitHub CLI (gh) installed and authenticated
#   - No uncommitted changes in the repository
#   - Appropriate permissions on djinilabs organization
#
# What it does:
#   1. Creates an orphan branch with all files squashed into one commit
#   2. Creates a new temporary repository (helpmaton-new)
#   3. Pushes the squashed history to the new repo
#   4. Attempts to migrate secrets (may require manual completion)
#   5. Renames old repo to helpmaton-private
#   6. Renames new repo to helpmaton
#   7. Updates local git remote configuration
#
# Note: Secret migration may require manual steps since GitHub doesn't
#       allow reading secret values programmatically for security reasons.

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
OLD_REPO="djinilabs/helpmaton"
TEMP_REPO="djinilabs/helpmaton-new"
FINAL_OLD_REPO_NAME="helpmaton-private"
TEMP_REMOTE="temp-origin"
INITIAL_COMMIT_MSG="Initial commit"

echo -e "${GREEN}=== Open Source Repository Migration ===${NC}\n"

# Step 1: Verify prerequisites
echo -e "${YELLOW}Step 1: Verifying prerequisites...${NC}"
if ! command -v gh &> /dev/null; then
    echo -e "${RED}Error: GitHub CLI (gh) is not installed${NC}"
    exit 1
fi

if ! gh auth status &> /dev/null; then
    echo -e "${RED}Error: Not authenticated with GitHub CLI${NC}"
    exit 1
fi

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo -e "${RED}Error: Not in a git repository${NC}"
    exit 1
fi

# Check if there are uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo -e "${RED}Error: You have uncommitted changes. Please commit or stash them first.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Prerequisites verified${NC}\n"

# Step 2: Create orphan branch and squash commits
echo -e "${YELLOW}Step 2: Creating orphan branch and squashing commits...${NC}"

# Get current branch name
CURRENT_BRANCH=$(git branch --show-current)
echo "Current branch: $CURRENT_BRANCH"

# Create orphan branch
git checkout --orphan clean-main

# Add all files
git add .

# Create single commit
git commit -m "$INITIAL_COMMIT_MSG"

echo -e "${GREEN}✓ Created orphan branch with squashed commit${NC}\n"

# Step 3: Create new repository
echo -e "${YELLOW}Step 3: Creating new repository...${NC}"

# Check if temp repo already exists
if gh repo view "$TEMP_REPO" &> /dev/null; then
    echo -e "${YELLOW}Warning: Repository $TEMP_REPO already exists${NC}"
    read -p "Do you want to delete it and continue? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        gh repo delete "$TEMP_REPO" --yes
    else
        echo -e "${RED}Aborted${NC}"
        git checkout "$CURRENT_BRANCH"
        git branch -D clean-main
        exit 1
    fi
fi

# Create new repository
gh repo create "$TEMP_REPO" --private --source=. --remote="$TEMP_REMOTE"

echo -e "${GREEN}✓ Created repository: $TEMP_REPO${NC}\n"

# Step 4: Push squashed history
echo -e "${YELLOW}Step 4: Pushing squashed history...${NC}"

git push "$TEMP_REMOTE" clean-main:main --force

# Set main as default branch
gh repo edit "$TEMP_REPO" --default-branch main

echo -e "${GREEN}✓ Pushed squashed history${NC}\n"

# Step 5: Export and import secrets
echo -e "${YELLOW}Step 5: Migrating secrets...${NC}"

# Initialize variables
SECRET_COUNT=0
FAILED_SECRETS=()

# Get list of secrets from old repo
SECRETS=$(gh secret list --repo "$OLD_REPO" --json name -q '.[].name')

if [ -z "$SECRETS" ]; then
    echo -e "${YELLOW}Warning: No secrets found in old repository${NC}"
else
    SECRET_COUNT=0
    FAILED_SECRETS=()
    SECRET_NAMES_ARRAY=()
    
    # Convert to array
    while IFS= read -r line; do
        SECRET_NAMES_ARRAY+=("$line")
    done <<< "$SECRETS"
    
    echo -e "${YELLOW}Found ${#SECRET_NAMES_ARRAY[@]} secrets to migrate${NC}"
    echo -e "${YELLOW}Note: GitHub CLI cannot read secret values for security reasons.${NC}"
    echo -e "${YELLOW}Attempting to migrate using environment variables as fallback...${NC}\n"
    
    for SECRET_NAME in "${SECRET_NAMES_ARRAY[@]}"; do
        echo -n "Migrating $SECRET_NAME... "
        
        # Try to get secret value from environment variable first (if user exported them)
        # Format: SECRET_NAME should match the environment variable
        ENV_VAR_NAME=$(echo "$SECRET_NAME" | tr '[:lower:]' '[:upper:]' | tr '-' '_')
        SECRET_VALUE="${!ENV_VAR_NAME}"
        
        if [ -n "$SECRET_VALUE" ]; then
            # Set secret in new repo using environment variable
            echo "$SECRET_VALUE" | gh secret set "$SECRET_NAME" --repo "$TEMP_REPO"
            ((SECRET_COUNT++))
            echo -e "${GREEN}✓ (from env)${NC}"
        else
            # Cannot retrieve secret value - user needs to set manually
            echo -e "${YELLOW}⚠ (needs manual migration)${NC}"
            FAILED_SECRETS+=("$SECRET_NAME")
        fi
    done
    
    echo ""
    
    if [ ${#FAILED_SECRETS[@]} -gt 0 ]; then
        echo -e "${YELLOW}⚠ Could not automatically migrate ${#FAILED_SECRETS[@]} secrets${NC}"
        echo -e "${YELLOW}These secrets need to be migrated manually:${NC}\n"
        
        # Create a helper script for manual migration
        HELPER_SCRIPT="scripts/migrate-secrets-helper.sh"
        SECRETS_LIST_FILE="scripts/secrets-to-migrate.txt"
        
        # Save list of secrets to migrate
        printf '%s\n' "${FAILED_SECRETS[@]}" > "$SECRETS_LIST_FILE"
        
        # Create helper script
        cat > "$HELPER_SCRIPT" << HELPER_EOF
#!/bin/bash
# Helper script to migrate secrets manually
# This script provides commands to migrate each secret from the old repo to the new repo

set -e

OLD_REPO="djinilabs/helpmaton-private"
NEW_REPO="djinilabs/helpmaton-new"

echo "Manual Secret Migration Helper"
echo "==============================="
echo ""
echo "This script will help you migrate secrets from:"
echo "  Old: \$OLD_REPO"
echo "  New: \$NEW_REPO"
echo ""
echo "Since GitHub doesn't allow reading secret values programmatically,"
echo "you'll need to manually copy each secret value."
echo ""
echo "Option 1: Use GitHub UI"
echo "  1. Go to: https://github.com/\$OLD_REPO/settings/secrets/actions"
echo "  2. For each secret, click 'Update' to view the value"
echo "  3. Copy the value and run the command shown below"
echo ""
echo "Option 2: Use GitHub Actions (if you have access)"
echo "  Create a temporary workflow in the old repo that outputs secrets"
echo "  (Note: This is not recommended for security reasons)"
echo ""
echo "Secrets to migrate:"
echo ""

SECRETS=(
$(printf '    "%s"\n' "${FAILED_SECRETS[@]}")
)

for SECRET in "\${SECRETS[@]}"; do
    echo "  - \$SECRET"
    echo "    Command: gh secret set \$SECRET --repo \$NEW_REPO"
    echo ""
done

echo ""
echo "To migrate all secrets at once, you can use:"
echo "  while IFS= read -r secret; do"
echo "    echo \"Migrating \$secret...\""
echo "    read -sp \"Enter value for \$secret: \" value"
echo "    echo \"\$value\" | gh secret set \"\$secret\" --repo \$NEW_REPO"
echo "  done < $SECRETS_LIST_FILE"
echo ""
HELPER_EOF
        
        chmod +x "$HELPER_SCRIPT"
        
        echo -e "${YELLOW}Created helper files:${NC}"
        echo -e "  - ${YELLOW}$HELPER_SCRIPT${NC} - Interactive helper script"
        echo -e "  - ${YELLOW}$SECRETS_LIST_FILE${NC} - List of secrets to migrate"
        echo ""
        echo -e "${YELLOW}To migrate secrets manually, you can:${NC}"
        echo -e "  1. Run: ${YELLOW}./$HELPER_SCRIPT${NC}"
        echo -e "  2. Or use: ${YELLOW}gh secret set SECRET_NAME --repo $TEMP_REPO${NC}"
        echo ""
    fi
    
    if [ $SECRET_COUNT -gt 0 ]; then
        echo -e "${GREEN}✓ Migrated $SECRET_COUNT secrets automatically${NC}"
    fi
fi

echo ""

# Step 6: Rename old repository
echo -e "${YELLOW}Step 6: Renaming old repository...${NC}"

# Check if helpmaton-private already exists
if gh repo view "djinilabs/$FINAL_OLD_REPO_NAME" &> /dev/null; then
    echo -e "${YELLOW}Warning: Repository djinilabs/$FINAL_OLD_REPO_NAME already exists${NC}"
    read -p "Do you want to delete it and continue? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        gh repo delete "djinilabs/$FINAL_OLD_REPO_NAME" --yes
    else
        echo -e "${RED}Aborted${NC}"
        git checkout "$CURRENT_BRANCH"
        git branch -D clean-main
        exit 1
    fi
fi

gh repo rename "$FINAL_OLD_REPO_NAME" --repo "$OLD_REPO"

echo -e "${GREEN}✓ Renamed old repository to $FINAL_OLD_REPO_NAME${NC}\n"

# Step 7: Rename new repository
echo -e "${YELLOW}Step 7: Renaming new repository to helpmaton...${NC}"

gh repo rename helpmaton --repo "$TEMP_REPO"

# Update helper script with final repo name if it exists
if [ -f "scripts/migrate-secrets-helper.sh" ]; then
    sed -i.bak "s|NEW_REPO=\"djinilabs/helpmaton-new\"|NEW_REPO=\"djinilabs/helpmaton\"|g" "scripts/migrate-secrets-helper.sh"
    rm -f "scripts/migrate-secrets-helper.sh.bak" 2>/dev/null || true
fi

echo -e "${GREEN}✓ Renamed new repository to helpmaton${NC}\n"

# Step 8: Update local remote
echo -e "${YELLOW}Step 8: Updating local git remote...${NC}"

# Remove temp remote
git remote remove "$TEMP_REMOTE" 2>/dev/null || true

# Update origin to point to the new repo
git remote set-url origin "git@github.com:djinilabs/helpmaton.git"

# Switch back to main branch (which now exists in the new repo)
git fetch origin
git branch -D clean-main 2>/dev/null || true
git checkout -b main origin/main 2>/dev/null || git checkout main

echo -e "${GREEN}✓ Updated local git remote${NC}\n"

# Step 9: Verification
echo -e "${YELLOW}Step 9: Verification...${NC}"

# Check if new repo exists and is accessible
if gh repo view "djinilabs/helpmaton" &> /dev/null; then
    echo -e "${GREEN}✓ New repository is accessible at djinilabs/helpmaton${NC}"
else
    echo -e "${RED}✗ New repository is not accessible${NC}"
fi

# Check if old repo was renamed
if gh repo view "djinilabs/$FINAL_OLD_REPO_NAME" &> /dev/null; then
    echo -e "${GREEN}✓ Old repository renamed to djinilabs/$FINAL_OLD_REPO_NAME${NC}"
else
    echo -e "${RED}✗ Old repository rename verification failed${NC}"
fi

# Count secrets in new repo
NEW_SECRET_COUNT=$(gh secret list --repo "djinilabs/helpmaton" | wc -l | tr -d ' ')
echo -e "${GREEN}✓ New repository has $NEW_SECRET_COUNT secrets${NC}"

# Check commit count
COMMIT_COUNT=$(git rev-list --count HEAD 2>/dev/null || echo "0")
if [ "$COMMIT_COUNT" -eq 1 ]; then
    echo -e "${GREEN}✓ Repository has clean history (1 commit)${NC}"
else
    echo -e "${YELLOW}⚠ Repository has $COMMIT_COUNT commits (expected 1)${NC}"
fi

echo ""
echo -e "${GREEN}=== Migration Complete ===${NC}\n"
echo -e "Summary:"
echo -e "  - New repository: ${GREEN}djinilabs/helpmaton${NC}"
echo -e "  - Old repository: ${GREEN}djinilabs/$FINAL_OLD_REPO_NAME${NC}"
echo -e "  - Secrets migrated: ${GREEN}$SECRET_COUNT${NC}"
echo -e "  - Commit history: ${GREEN}Squashed to single commit${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Review the new repository to ensure everything is correct"
if [ ${#FAILED_SECRETS[@]} -gt 0 ]; then
    echo -e "  2. Complete secret migration:"
    echo -e "     - Run: ${YELLOW}./scripts/migrate-secrets-helper.sh${NC}"
    echo -e "     - Or manually set each secret using:"
    echo -e "       ${YELLOW}gh secret set SECRET_NAME --repo djinilabs/helpmaton${NC}"
    echo -e "  3. Make the repository public when ready:"
    echo -e "     ${YELLOW}gh repo edit djinilabs/helpmaton --visibility public${NC}"
else
    echo -e "  2. Make the repository public when ready:"
    echo -e "     ${YELLOW}gh repo edit djinilabs/helpmaton --visibility public${NC}"
fi
echo ""
