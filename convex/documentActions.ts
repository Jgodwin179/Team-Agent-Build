"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { PdfExtractionResult, PdfPageChunk } from "./lib/pdf/types";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  data: Buffer,
  options?: {
    pagerender?: (pageData: {
      getTextContent: () => Promise<{
        items: Array<{ str?: string }>;
      }>;
    }) => Promise<string>;
  },
) => Promise<{ text: string; numpages: number }>;

const MOCK_OCR_LABEL =
  "MOCK OCR — no OCR provider configured; placeholder page text for scanned/empty PDFs";

async function extractWithPdfParse(
  bytes: Uint8Array,
): Promise<PdfExtractionResult> {
  const pages: PdfPageChunk[] = [];
  const buffer = Buffer.from(bytes);

  await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const content = await pageData.getTextContent();
      const text = content.items
        .map((item) => item.str ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pages.push({
        pageNumber: pages.length + 1,
        text,
        sectionLabel: `page-${pages.length + 1}`,
      });
      return text;
    },
  });

  const nonEmpty = pages.filter((p) => p.text.length > 0);
  if (nonEmpty.length === 0) {
    const pageCount = Math.max(pages.length, 1);
    return {
      pages: Array.from({ length: pageCount }, (_, i) => ({
        pageNumber: i + 1,
        text: `[${MOCK_OCR_LABEL}] No extractable text layer on page ${i + 1}.`,
        sectionLabel: `page-${i + 1}`,
      })),
      pageCount,
      provider: "mock-ocr",
      mockLabel: MOCK_OCR_LABEL,
      warnings: [
        "PDF had no text layer. OCR vendor not configured — used labeled MOCK OCR placeholders.",
      ],
    };
  }

  return {
    pages: pages.map((p, i) =>
      p.text
        ? p
        : {
            ...p,
            text: `[empty page ${i + 1}]`,
          },
    ),
    pageCount: pages.length,
    provider: "pdf-parse",
    warnings: [],
  };
}

export const extractPdf = internalAction({
  args: {
    contentBase64: v.string(),
  },
  returns: v.object({
    pages: v.array(
      v.object({
        pageNumber: v.number(),
        text: v.string(),
        sectionLabel: v.optional(v.string()),
      }),
    ),
    pageCount: v.number(),
    provider: v.union(v.literal("pdf-parse"), v.literal("mock-ocr")),
    mockLabel: v.optional(v.string()),
    warnings: v.array(v.string()),
  }),
  handler: async (_ctx, args) => {
    const bytes = Uint8Array.from(Buffer.from(args.contentBase64, "base64"));
    try {
      return await extractWithPdfParse(bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        pages: [
          {
            pageNumber: 1,
            text: `[${MOCK_OCR_LABEL}] Extraction failed: ${message}`,
            sectionLabel: "page-1",
          },
        ],
        pageCount: 1,
        provider: "mock-ocr" as const,
        mockLabel: MOCK_OCR_LABEL,
        warnings: [`pdf-parse failed: ${message}`],
      };
    }
  },
});
