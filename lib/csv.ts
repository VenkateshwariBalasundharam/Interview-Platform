import Papa from 'papaparse';
import { z } from 'zod';
import { parseDob } from '@/lib/dob';

export const MAX_IMPORT_ROWS = 200;
export const MAX_IMPORT_BYTES = 512 * 1024;

export interface ValidCandidateRow {
  row: number; // 1-based line number in the file (header = 1)
  name: string;
  email: string;
  dobPassword: string; // DDMMYYYY, only ever hashed by the caller
}

export interface RejectedRow {
  row: number;
  name?: string;
  email?: string;
  errors: string[];
}

export interface ParsedCandidateCsv {
  valid: ValidCandidateRow[];
  rejected: RejectedRow[];
}

export class CsvFormatError extends Error {
  constructor(public code: 'CSV_EMPTY' | 'CSV_MISSING_COLUMNS' | 'CSV_TOO_MANY_ROWS' | 'CSV_UNREADABLE', message: string) {
    super(message);
  }
}

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const nameSchema = z.string().trim().min(1).max(120);

export function parseCandidateCsv(text: string, now: Date = new Date()): ParsedCandidateCsv {
  const clean = text.replace(/^\uFEFF/, '');
  const result = Papa.parse<Record<string, string>>(clean, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const fields = result.meta.fields ?? [];
  if (result.data.length === 0 && fields.length === 0) throw new CsvFormatError('CSV_EMPTY', 'The file is empty.');

  const missing = ['name', 'email', 'dob'].filter((c) => !fields.includes(c));
  if (missing.length > 0) {
    throw new CsvFormatError('CSV_MISSING_COLUMNS', `Missing required column(s): ${missing.join(', ')}. Expected header: name,email,dob`);
  }
  if (result.data.length === 0) throw new CsvFormatError('CSV_EMPTY', 'The file has a header but no candidate rows.');
  if (result.data.length > MAX_IMPORT_ROWS) {
    throw new CsvFormatError('CSV_TOO_MANY_ROWS', `A maximum of ${MAX_IMPORT_ROWS} rows can be imported at once.`);
  }

  const valid: ValidCandidateRow[] = [];
  const rejected: RejectedRow[] = [];
  const seenEmails = new Map<string, number>();

  result.data.forEach((record, index) => {
    const row = index + 2; // header is line 1
    const errors: string[] = [];

    const name = nameSchema.safeParse(record.name ?? '');
    if (!name.success) errors.push('Name is required (max 120 characters)');

    const email = emailSchema.safeParse(record.email ?? '');
    if (!email.success) errors.push('Email is not valid');

    const dob = parseDob(record.dob ?? '', now);
    if (!dob.ok) errors.push(dob.reason);

    if (email.success) {
      const first = seenEmails.get(email.data);
      if (first !== undefined) errors.push(`Duplicate email in file (first seen on row ${first})`);
      else seenEmails.set(email.data, row);
    }

    if (errors.length > 0 || !name.success || !email.success || !dob.ok) {
      rejected.push({
        row,
        name: name.success ? name.data : undefined,
        email: email.success ? email.data : undefined,
        errors,
      });
      return;
    }
    valid.push({ row, name: name.data, email: email.data, dobPassword: dob.password });
  });

  return { valid, rejected };
}

export { csvSafeCell } from '@/lib/csv-export';
