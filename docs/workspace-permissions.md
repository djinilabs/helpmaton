# Workspace Permissions

Helpmaton uses a permission-based system to control access to workspaces and their resources.

## Permission Levels

There are three permission levels:

### READ (Level 1)
- View workspace details
- View agents and their configurations
- View documents
- Cannot make changes

### WRITE (Level 2)
- All READ permissions
- Create and edit agents
- Upload, edit, and delete documents
- Modify workspace settings
- Cannot delete the workspace

### OWNER (Level 3)
- All WRITE permissions
- Delete the workspace
- Manage workspace members and permissions
- Full administrative control

## Managing Permissions

### As a Workspace Owner

1. Navigate to your workspace
2. Access the members/permissions section
3. Add users and assign permission levels
4. Modify or remove user permissions as needed

### Permission Inheritance

- Permissions apply to the entire workspace
- All agents and documents inherit workspace permissions
- Individual resource-level permissions may be added in the future

## Security Best Practices

1. **Principle of Least Privilege**: Grant minimum necessary permissions
2. **Regular Audits**: Review workspace members periodically
3. **Key Management**: Keep agent keys secure
4. **Document Access**: Be mindful of sensitive information in documents

## Common Scenarios

### Team Collaboration
- Grant WRITE access to team members who need to create content
- Use READ access for stakeholders who only need to view

### External Sharing
- Use READ access for external partners
- Consider creating separate workspaces for sensitive projects

### Administrative Access
- Only workspace owners can delete workspaces
- Owners should be trusted team members

