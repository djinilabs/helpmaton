/**
 * Google Drive API file representation
 */
export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  createdTime: string;
  size?: string;
  webViewLink?: string;
  parents?: string[];
}

/**
 * Google Drive API file list response
 */
export interface GoogleDriveFileListResponse {
  files: GoogleDriveFile[];
  nextPageToken?: string;
}

/**
 * Google Drive API error response
 */
export interface GoogleDriveErrorResponse {
  error: {
    code: number;
    message: string;
    errors?: Array<{
      domain?: string;
      reason?: string;
      message?: string;
    }>;
  };
}
