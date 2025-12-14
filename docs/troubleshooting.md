# Troubleshooting Guide

Common issues and solutions when using Helpmaton.

## Upload Issues

### File Upload Fails

**Problem**: Files won't upload or upload fails with an error.

**Solutions**:
- Check file size (max 10MB per file)
- Verify file type is supported (.md, .txt, .markdown)
- Ensure you have WRITE permission on the workspace
- Check your internet connection
- Try refreshing the page and uploading again

### Filename Conflicts

**Problem**: Uploaded file gets a different name than expected.

**Solution**: This is expected behavior. If a filename already exists in the destination folder, Helpmaton automatically appends a number (e.g., `document-1.md`, `document-2.md`) to prevent conflicts.

## Document Management

### Can't Edit Document

**Problem**: Document viewer doesn't allow editing.

**Solutions**:
- Verify you have WRITE permission on the workspace
- Check that the document loaded correctly
- Try refreshing the page

### Document Not Found

**Problem**: Document appears to be missing or can't be opened.

**Solutions**:
- Check that you're in the correct folder
- Verify the document wasn't deleted
- Ensure you have READ permission on the workspace
- Try navigating to the root folder and searching

### Folder Navigation Issues

**Problem**: Can't navigate to a folder or folder structure seems wrong.

**Solutions**:
- Use breadcrumbs to navigate back
- Check folder path format (use forward slashes for nesting)
- Ensure folder names don't contain invalid characters
- Try refreshing the page

## Agent Issues

### Agent Not Responding

**Problem**: Agent webhook or test endpoint doesn't return responses.

**Solutions**:
- Verify the agent key is correct
- Check that the agent exists and is properly configured
- Ensure the system prompt is valid
- Review server logs for errors

### Agent Responses Are Unexpected

**Problem**: Agent behavior doesn't match expectations.

**Solutions**:
- Review and refine the system prompt
- Upload relevant documents to provide context
- Test with different inputs to understand behavior
- Consider breaking complex prompts into simpler instructions

## Permission Issues

### Can't Create or Edit Resources

**Problem**: Buttons are disabled or actions fail with permission errors.

**Solutions**:
- Verify your permission level (need WRITE or OWNER)
- Contact workspace owner to request higher permissions
- Check that you're logged in with the correct account

### Can't Delete Workspace

**Problem**: Delete workspace button is missing or disabled.

**Solution**: Only workspace owners can delete workspaces. Contact the workspace owner if you need this action performed.

## General Issues

### Page Won't Load

**Problem**: Workspace or document page doesn't load.

**Solutions**:
- Check your internet connection
- Verify you're logged in
- Try refreshing the page
- Clear browser cache and cookies
- Check browser console for errors

### Changes Not Saving

**Problem**: Edits to documents or agents don't persist.

**Solutions**:
- Ensure you clicked "SAVE" button
- Check for error messages
- Verify you have WRITE permission
- Try refreshing and editing again

## Getting Help

If you continue to experience issues:

1. Check the browser console for error messages
2. Review server logs if you have access
3. Verify your permissions and workspace access
4. Try the action in a different browser
5. Contact your workspace administrator

