export type PdfExtractionMode = "pdf-parse" | "mock-ocr";

export type PdfPageChunk = {
  pageNumber: number;
  text: string;
  sectionLabel?: string;
};

export type PdfExtractionResult = {
  pages: PdfPageChunk[];
  pageCount: number;
  provider: PdfExtractionMode;
  /** Present when OCR mock was used because no text layer / no OCR vendor. */
  mockLabel?: string;
  warnings: string[];
};

export interface PdfExtractor {
  readonly name: string;
  extract(bytes: Uint8Array): Promise<PdfExtractionResult>;
}
