// Checks an uploaded resume file and pulls plain text out of it (server only). Never logs file contents.
import { err } from '@/lib/http';

/** Kept under 4.5 MB because serverless hosts such as Vercel reject larger request bodies. */
export const MAX_RESUME_BYTES = 4 * 1024 * 1024;
export const MAX_RESUME_CHARS = 20_000;
const MIN_USEFUL_CHARS = 50;
const MAX_PDF_PAGES = 15;

export type ResumeFormat = 'pdf' | 'docx';

/** The format comes from the file's first bytes, never from its name or the browser-reported type. */
export function detectResumeFormat(data: Buffer): ResumeFormat | null {
  if (data.length >= 5 && data.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04) return 'docx';
  return null;
}

export const RESUME_CONTENT_TYPE: Record<ResumeFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Rejects empty, oversized and unsupported files before anything is stored. */
export function validateResumeUpload(data: Buffer): ResumeFormat {
  if (data.length === 0) throw err.badRequest('The file is empty.', 'RESUME_EMPTY');
  if (data.length > MAX_RESUME_BYTES) throw err.tooLarge('The resume must be 4 MB or smaller.', 'RESUME_TOO_LARGE');
  const format = detectResumeFormat(data);
  if (!format) throw err.badRequest('Upload a PDF or Word (.docx) file.', 'RESUME_UNSUPPORTED_TYPE');
  return format;
}

/** Collapses whitespace, drops control characters and caps the length. */
export function normaliseResumeText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[ \t\u00A0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
    .slice(0, MAX_RESUME_CHARS);
}

/**
 * Removes emails, links and phone numbers before the text goes to the AI provider. This is best-effort: names and
 * other free text can remain, so it reduces what is shared but does not make the text anonymous.
 */
export function redactContactDetails(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email removed]')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[link removed]')
    .replace(/\b(?:linkedin|github)\.com\/\S+/gi, '[link removed]')
    .replace(/\+\d[\d\s().-]{8,}\d/g, '[phone removed]')
    .replace(/\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, '[phone removed]')
    .replace(/\b\d{5}[\s-]\d{5}\b/g, '[phone removed]')
    .replace(/\b\d{10}\b/g, '[phone removed]');
}

export async function extractResumeText(data: Buffer, format: ResumeFormat): Promise<string> {
  let raw = '';
  try {
    if (format === 'pdf') {
      const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
      // pdf.js reads the underlying ArrayBuffer, so a small Buffer taken from Node's shared pool is misread ("bad XRef
      // entry"). A plain Uint8Array copy has its own exact-size memory, and leaves the original bytes intact for storage.
      const copy = new Uint8Array(data) as unknown as Buffer;
      raw = (await pdfParse(copy, { max: MAX_PDF_PAGES })).text ?? '';
    } else {
      const mod = (await import('mammoth')) as typeof import('mammoth') & { default?: typeof import('mammoth') };
      const extract = mod.extractRawText ?? mod.default?.extractRawText;
      if (!extract) throw new Error('mammoth unavailable');
      raw = (await extract({ buffer: data })).value ?? '';
    }
  } catch {
    throw err.badRequest('The file could not be read. It may be damaged or password-protected.', 'RESUME_UNREADABLE');
  }
  const text = normaliseResumeText(raw);
  if (text.length < MIN_USEFUL_CHARS) {
    throw err.badRequest('No readable text was found. Scanned or image-only resumes are not supported; upload a text-based PDF or Word file.', 'RESUME_NO_TEXT');
  }
  return text;
}
