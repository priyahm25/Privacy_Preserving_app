import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

export type PdfTextExtraction = {
  text: string;
  pageCount: number;
};

/** A parsing/setup problem is distinct from a successfully parsed scanned PDF. */
export class PdfTextExtractionError extends Error {
  constructor() {
    super("PDF.js could not extract text from this PDF.");
    this.name = "PdfTextExtractionError";
  }
}

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 200;
const MAX_EXTRACTED_CHARACTERS = 8 * 1024 * 1024;

// PDF.js does not infer a worker URL when it is bundled by Expo/Metro. Metro
// only produces a worker bundle for the `new Worker(new URL(...))` form, so a
// small local worker entry imports PDF.js's worker module. This is still fully
// local: neither document bytes nor extracted text leave the browser.
const pdfWorker = new Worker(
  new URL("./pdfTextExtractorWorker.web.ts", window.location.href),
  { type: "module" },
);
GlobalWorkerOptions.workerPort = pdfWorker;

function normalizeExtractedPdfText(value: string): string {
  return value
    .replace(/\u00ad/g, "")
    .replace(/([\p{L}\p{N}])[-\u2010-\u2015]\s*\n\s*([\p{L}\p{N}])/gu, "$1$2")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Browser-only local extraction backed by PDF.js. `data` is a local byte
 * buffer and PDF.js receives no URL, so neither the PDF nor extracted text is
 * sent over the network. Native Expo resolves the bounded .ts fallback.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfTextExtraction> {
  if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES) return { text: "", pageCount: 0 };

  let task: ReturnType<typeof getDocument> | undefined;
  try {
    task = getDocument({
      data: bytes.slice(),
      // Keep parsing local to the browser bundle. PDF.js will not fetch a PDF
      // or CMap from a remote URL for this byte-buffer-only use case.
      useWorkerFetch: false,
      isEvalSupported: false,
      stopAtErrors: false,
    });
    const document = await task.promise;
    if (document.numPages > MAX_PDF_PAGES) return { text: "", pageCount: document.numPages };

    const pages: string[] = [];
    let characters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      let pageText = "";
      let previousItem: { x: number; y: number; width: number; height: number } | null = null;
      for (const item of textContent.items) {
        if (!("str" in item)) continue;
        const x = item.transform[4];
        const y = item.transform[5];
        const height = Math.abs(item.height);
        const hasPosition = [x, y, item.width, height].every(Number.isFinite);

        // PDF.js frequently returns one item per visual word, but it can also
        // split a word into adjacent glyph runs. Use the item's geometry to
        // retain word gaps without inserting spaces inside those split words.
        if (pageText && previousItem && hasPosition) {
          const sameLine = Math.abs(y - previousItem.y) <= Math.max(1, Math.max(height, previousItem.height) * 0.5);
          const gap = x - (previousItem.x + previousItem.width);
          if (!sameLine || gap > Math.max(0.5, Math.max(height, previousItem.height) * 0.12)) pageText += " ";
        } else if (pageText && !/\s$/.test(pageText) && !/^\s/.test(item.str)) {
          // Geometry is absent only for unusual text items. Prefer preserving
          // a token boundary to silently merging two searchable words.
          pageText += " ";
        }
        pageText += item.str;
        previousItem = hasPosition ? { x, y, width: item.width, height } : null;
        if (item.hasEOL) {
          pageText += "\n";
          previousItem = null;
        }
      }
      characters += pageText.length;
      if (characters > MAX_EXTRACTED_CHARACTERS) return { text: "", pageCount: document.numPages };
      pages.push(pageText);
    }

    return { text: normalizeExtractedPdfText(pages.join("\n")), pageCount: document.numPages };
  } catch (error) {
    // A PDF.js failure is not evidence that a PDF is image-only. Keep the
    // browser diagnostic count-only and let the upload UI report this as an
    // extraction failure rather than incorrectly requesting OCR.
    if (__DEV__) {
      console.warn("PDF.js extraction failed", {
        extractionMethod: "pdfjs",
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
    throw new PdfTextExtractionError();
  } finally {
    await task?.destroy().catch(() => undefined);
  }
}
