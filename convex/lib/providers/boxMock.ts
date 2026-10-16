import {
  FileSourceError,
  type FileDownload,
  type FileListPage,
  type FileMetadata,
  type FileSource,
} from "./fileSource";

const MOCK_LABEL = "MOCK — local Box fixture (no live Composio/Box call)";

/** Minimal one-page PDF with extractable text for local ingestion tests. */
export function buildMockPdfBytes(title = "Phase 3 Sample CIM"): Uint8Array {
  const stream = `BT /F1 18 Tf 72 720 Td (${title}) Tj T* /F1 12 Tf (Revenue 4.2M EBITDA 1.1M) Tj ET`;
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n",
    `4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(body.length);
    body += obj;
  }
  const xrefStart = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body +=
    xref +
    `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

const MOCK_FILES: Array<{
  id: string;
  name: string;
  type: "file" | "folder";
  size: number;
  bytes?: Uint8Array;
  /** Simulate fixture scenarios when listing/downloading this id. */
  scenario?: "denied_scope" | "expired_auth" | "scanned_empty";
}> = [
  {
    id: "mock-folder-deals",
    name: "Deals",
    type: "folder",
    size: 0,
  },
  {
    id: "mock-file-cim-1",
    name: "Midwest-Manufacturing-CIM.pdf",
    type: "file",
    size: 0,
    bytes: buildMockPdfBytes("Midwest Manufacturing CIM"),
  },
  {
    id: "mock-file-denied",
    name: "Restricted-Board-Minutes.pdf",
    type: "file",
    size: 1200,
    scenario: "denied_scope",
  },
  {
    id: "mock-file-expired",
    name: "Expired-Auth-Target.pdf",
    type: "file",
    size: 800,
    scenario: "expired_auth",
  },
  {
    id: "mock-file-scanned",
    name: "Scanned-Lease-No-Text.pdf",
    type: "file",
    size: 0,
    scenario: "scanned_empty",
    bytes: new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF\n",
    ),
  },
];

for (const f of MOCK_FILES) {
  if (f.bytes) f.size = f.bytes.byteLength;
}

export function createMockBoxFileSource(options?: {
  forceExpired?: boolean;
  forceDeniedScopes?: string[];
}): FileSource {
  return {
    provider: "box",
    mode: "mock",

    async listFolder(input) {
      if (options?.forceExpired) {
        throw new FileSourceError(
          "expired_auth",
          "MOCK: Box connection expired — reconnect required",
        );
      }
      if (options?.forceDeniedScopes?.includes("root_readwrite")) {
        throw new FileSourceError(
          "denied_scope",
          "MOCK: denied scope root_readwrite for folder listing",
        );
      }

      const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
      const offset = input.offset ?? 0;
      const all =
        input.folderId === "0" || input.folderId === "mock-root"
          ? MOCK_FILES
          : MOCK_FILES.filter((f) => f.type === "file");

      const page = all.slice(offset, offset + limit);
      const nextOffset =
        offset + limit < all.length ? offset + limit : undefined;

      return {
        items: page.map((f) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          size: f.size,
          modifiedAt: new Date().toISOString(),
        })),
        nextOffset,
        mode: "mock",
        mockLabel: MOCK_LABEL,
      } satisfies FileListPage;
    },

    async getMetadata(fileId) {
      const file = MOCK_FILES.find((f) => f.id === fileId && f.type === "file");
      if (!file) {
        throw new FileSourceError("not_found", `MOCK: file ${fileId} not found`);
      }
      if (file.scenario === "expired_auth" || options?.forceExpired) {
        throw new FileSourceError(
          "expired_auth",
          "MOCK: Box OAuth token expired",
        );
      }
      if (file.scenario === "denied_scope") {
        throw new FileSourceError(
          "denied_scope",
          "MOCK: insufficient scope to read this file",
        );
      }
      return {
        id: file.id,
        name: file.name,
        size: file.size,
        contentType: "application/pdf",
        mode: "mock",
        mockLabel: MOCK_LABEL,
      } satisfies FileMetadata;
    },

    async download(fileId) {
      const file = MOCK_FILES.find((f) => f.id === fileId && f.type === "file");
      if (!file) {
        throw new FileSourceError("not_found", `MOCK: file ${fileId} not found`);
      }
      if (file.scenario === "expired_auth" || options?.forceExpired) {
        throw new FileSourceError(
          "expired_auth",
          "MOCK: Box OAuth token expired on download",
        );
      }
      if (file.scenario === "denied_scope") {
        throw new FileSourceError(
          "denied_scope",
          "MOCK: denied scope item_download",
        );
      }
      const bytes = file.bytes ?? buildMockPdfBytes(file.name);
      return {
        fileId: file.id,
        name: file.name,
        contentType: "application/pdf",
        bytes,
        mode: "mock",
        mockLabel: MOCK_LABEL,
      } satisfies FileDownload;
    },
  };
}
