// Turns an uploaded candidate list into CSV text for `parseCandidateCsv`. Server only.
// Accepted: CSV, TSV or any delimited text (.txt), Excel .xlsx (first sheet) and JSON ([{name,email,dob}, ...]).
// Word, PDF, images and old .xls files are refused with a clear message.
// The format is detected from the file's content, not its name, so a renamed file still works or fails clearly.
import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/node';
import { MAX_IMPORT_ROWS } from '@/lib/csv';
import { AppError, err } from '@/lib/http';

export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

const UNSUPPORTED = 'This file type is not supported. Use a spreadsheet (.xlsx) or a text list (.csv, .tsv, .txt, .json) with the columns name, email and dob. Word, PDF and older .xls files are not accepted: save the list as .xlsx or .csv first.';

function isZip(b: Buffer): boolean {
  return b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

function isPdf(b: Buffer): boolean {
  return b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-';
}

/** Both Office formats are zip files; the entry names inside are stored in plain text, so look for the main part. */
function zipKind(b: Buffer): 'docx' | 'xlsx' | null {
  if (b.includes('word/document.xml')) return 'docx';
  if (b.includes('xl/workbook.xml')) return 'xlsx';
  return null;
}

/** Decodes text, honouring the byte-order marks Excel's "Unicode text" and "CSV UTF-8" exports add. */
export function decodeText(b: Buffer): string {
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return Buffer.from(b.subarray(2)).swap16().toString('utf16le');
  return b.toString('utf8').replace(/^\uFEFF/, '');
}

/** Binary data (images, PDFs, Word) shows up as NUL bytes or replacement characters in the first part of the file. */
function looksBinary(b: Buffer, text: string): boolean {
  if (b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))) return false; // UTF-16 text has NULs
  const head = text.slice(0, 4000);
  return head.includes('\u0000') || (head.match(/\uFFFD/g)?.length ?? 0) > 3;
}

/** One spreadsheet cell as the text the CSV parser expects. */
export function cellToText(value: unknown, column: string): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // Excel dates arrive as UTC midnight, so read them back in UTC or the day can shift.
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(value.getUTCDate())}-${p(value.getUTCMonth() + 1)}-${p(value.getUTCFullYear(), 4)}`;
  }
  if (typeof value === 'number') {
    // A DOB typed as 02032000 is stored by Excel as the number 2032000: put the lost leading zero back.
    if (column === 'dob' && Number.isInteger(value) && value > 0) return String(value).padStart(8, '0');
    return String(value);
  }
  return String(value);
}

function rowsToCsv(rows: unknown[][]): string {
  if (rows.length === 0) throw err.badRequest('The file is empty.', 'CSV_EMPTY');
  if (rows.length - 1 > MAX_IMPORT_ROWS + 50) throw err.badRequest(`A maximum of ${MAX_IMPORT_ROWS} rows can be imported at once.`, 'CSV_TOO_MANY_ROWS');
  const header = rows[0].map((h) => String(h ?? '').trim().toLowerCase());
  const body = rows.slice(1).map((r) => header.map((h, i) => cellToText(r[i], h)));
  return Papa.unparse([header, ...body], { newline: '\n' });
}

function jsonToCsv(text: string): string {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw err.badRequest('The JSON file could not be read.', 'CSV_UNREADABLE');
  }
  const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { candidates?: unknown }).candidates) ? (data as { candidates: unknown[] }).candidates : null;
  if (!list) throw err.badRequest('The JSON file must be a list of { "name", "email", "dob" } objects.', 'CSV_UNREADABLE');
  const rows: unknown[][] = [['name', 'email', 'dob']];
  for (const item of list) {
    const o = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const lower = Object.fromEntries(Object.entries(o).map(([k, v]) => [k.trim().toLowerCase(), v]));
    rows.push([lower.name, lower.email, lower.dob]);
  }
  return rowsToCsv(rows);
}

/** Reads any supported upload. Throws a 400 with a clear message for anything else. */
async function readCandidateFile(data: Buffer): Promise<string> {
  if (data.length === 0) throw err.badRequest('The file is empty.', 'CSV_EMPTY');

  if (isPdf(data)) throw err.badRequest(UNSUPPORTED, 'FILE_UNSUPPORTED');

  if (isZip(data)) {
    const kind = zipKind(data);
    if (kind === 'xlsx') {
      try {
        return rowsToCsv((await readSheet(data)) as unknown[][]);
      } catch (e) {
        if (e instanceof AppError) throw e; // already one of our messages (the library's own errors are not)
        throw err.badRequest('This file could not be read as an Excel (.xlsx) spreadsheet.', 'CSV_UNREADABLE');
      }
    }
    throw err.badRequest(kind === 'docx' ? UNSUPPORTED : 'This zip-based file is not an Excel (.xlsx) spreadsheet.', kind === 'docx' ? 'FILE_UNSUPPORTED' : 'CSV_UNREADABLE');
  }

  const text = decodeText(data);
  if (looksBinary(data, text)) throw err.badRequest(UNSUPPORTED, 'FILE_UNSUPPORTED');
  const trimmed = text.trimStart();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return jsonToCsv(text);
  return text; // CSV, TSV and other delimited text: the CSV parser detects the delimiter itself
}

/** CSV text for any supported upload. */
export async function candidateFileToCsv(data: Buffer): Promise<string> {
  return readCandidateFile(data);
}
