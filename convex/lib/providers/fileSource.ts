/**
 * Typed file-source wrappers. Provider-specific logic stays in adapters.
 * Composio Box slugs verified against docs.composio.dev/toolkits/box (20260826_00):
 * - BOX_LIST_ITEMS_IN_FOLDER (folder_id, limit, offset/marker, usemarker)
 * - BOX_DOWNLOAD_FILE (file_id)
 * - BOX_GET_FILE_INFORMATION (file_id)
 */

export type FileSourceMode = "mock" | "live";

export type FileSourceErrorCode =
  | "expired_auth"
  | "denied_scope"
  | "not_found"
  | "rate_limited"
  | "invalid_argument"
  | "provider_error";

export class FileSourceError extends Error {
  readonly code: FileSourceErrorCode;
  readonly retryable: boolean;

  constructor(
    code: FileSourceErrorCode,
    message: string,
    options?: { retryable?: boolean },
  ) {
    super(message);
    this.name = "FileSourceError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

export type FileListItem = {
  id: string;
  name: string;
  type: "file" | "folder" | "web_link";
  size?: number;
  modifiedAt?: string;
};

export type FileListPage = {
  items: FileListItem[];
  nextOffset?: number;
  nextMarker?: string;
  mode: FileSourceMode;
  /** Explicit label when results are synthetic. */
  mockLabel?: string;
};

export type FileDownload = {
  fileId: string;
  name: string;
  contentType: string;
  bytes: Uint8Array;
  mode: FileSourceMode;
  mockLabel?: string;
};

export type FileMetadata = {
  id: string;
  name: string;
  size?: number;
  contentType?: string;
  sha1?: string;
  modifiedAt?: string;
  mode: FileSourceMode;
  mockLabel?: string;
};

export interface FileSource {
  readonly provider: "box" | "google_drive";
  readonly mode: FileSourceMode;
  listFolder(input: {
    folderId: string;
    limit?: number;
    offset?: number;
    marker?: string;
    useMarker?: boolean;
  }): Promise<FileListPage>;
  getMetadata(fileId: string): Promise<FileMetadata>;
  download(fileId: string): Promise<FileDownload>;
}

/** Verified Composio Box toolkit version (docs, toolkit page 20260826_00). */
export const COMPOSIO_BOX_TOOLKIT_VERSION = "20260826_00";

export const BOX_TOOL_SLUGS = {
  listItems: "BOX_LIST_ITEMS_IN_FOLDER",
  download: "BOX_DOWNLOAD_FILE",
  getInfo: "BOX_GET_FILE_INFORMATION",
} as const;
