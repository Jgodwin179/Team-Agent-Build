declare module "pdf-parse" {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    text: string;
    info: unknown;
    metadata: unknown;
    version: string;
  }

  interface PdfParseOptions {
    pagerender?: (pageData: {
      getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
    }) => Promise<string>;
  }

  function pdfParse(
    data: Buffer,
    options?: PdfParseOptions,
  ): Promise<PdfParseResult>;

  export default pdfParse;
}

declare module "pdf-parse/lib/pdf-parse.js" {
  import type pdfParse from "pdf-parse";
  const mod: typeof pdfParse;
  export default mod;
}
