# Document Management

Helpmaton allows you to upload, organize, and manage documents that can inform your agents' behavior.

## Supported File Types

- Markdown files (`.md`, `.markdown`)
- Plain text files (`.txt`)

Maximum file size: 10MB per file

## Uploading Documents

### Method 1: Drag and Drop

1. Navigate to your workspace
2. Find the document upload area
3. Drag files from your computer into the upload zone
4. Select a destination folder (optional)

### Method 2: File Selection

1. Click "SELECT FILES" in the upload area
2. Choose one or more files from your computer
3. Select a destination folder (optional)

### Method 3: Create from Text

1. Use the "CREATE TEXT DOCUMENT" section
2. Enter a document name
3. Type or paste your content
4. Click "CREATE DOCUMENT"

## Organizing Documents

### Folders

Documents can be organized into folders:

- Create folders by typing a new folder name when uploading
- Select existing folders from the dropdown
- Navigate folders using breadcrumbs
- Documents are stored in S3 with folder structure preserved

### Folder Structure

Folders can be nested using forward slashes:

- `docs/getting-started` creates a nested structure
- Empty folder name represents the root folder

## Managing Documents

### Viewing and Editing

1. Click on any document name to open the viewer
2. Edit the document name, content, or folder location
3. Save changes to update the document

### Renaming Documents

- Click on a document to open the viewer
- Edit the name field
- Save to rename the file in S3

### Moving Documents

- Open the document viewer
- Select a different folder from the dropdown
- Save to move the document

### Deleting Documents

- Open the document viewer
- Click the "DELETE" button
- Confirm deletion

## Best Practices

1. **Organize Early**: Set up folder structure before uploading many documents
2. **Descriptive Names**: Use clear, descriptive document names
3. **Regular Updates**: Keep documents current and relevant
4. **Version Control**: Consider keeping important versions of documents
