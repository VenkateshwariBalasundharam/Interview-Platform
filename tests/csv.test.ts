import { describe, expect, it } from 'vitest';
import { CsvFormatError, MAX_IMPORT_ROWS, parseCandidateCsv } from '@/lib/csv';
import { csvSafeCell } from '@/lib/csv-export';

const now = new Date('2026-06-01T00:00:00Z');

describe('parseCandidateCsv', () => {
  it('parses valid rows and normalises them', () => {
    const csv = 'name,email,dob\nAsha Verma, Asha@Example.com ,15-08-2001\nRavi,ravi@example.com,2000-03-02\n';
    const { valid, rejected } = parseCandidateCsv(csv, now);
    expect(rejected).toEqual([]);
    expect(valid).toEqual([
      { row: 2, name: 'Asha Verma', email: 'asha@example.com', dobPassword: '15082001' },
      { row: 3, name: 'Ravi', email: 'ravi@example.com', dobPassword: '02032000' },
    ]);
  });

  it('accepts a BOM, mixed-case headers and reordered columns', () => {
    const csv = '\uFEFFDOB,Email,NAME\n15-08-2001,a@example.com,Asha\n';
    expect(parseCandidateCsv(csv, now).valid).toHaveLength(1);
  });

  it('reports row-level problems without stopping the import', () => {
    const csv = [
      'name,email,dob',
      'Good One,good@example.com,15-08-2001',
      ',noname@example.com,15-08-2001',
      'Bad Email,not-an-email,15-08-2001',
      'Bad Dob,baddob@example.com,31-02-2000',
      'Everything Wrong,,',
    ].join('\n');
    const { valid, rejected } = parseCandidateCsv(csv, now);
    expect(valid.map((v) => v.row)).toEqual([2]);
    expect(rejected.map((r) => r.row)).toEqual([3, 4, 5, 6]);
    expect(rejected[0].errors).toContain('Name is required (max 120 characters)');
    expect(rejected[1].errors).toContain('Email is not valid');
    expect(rejected[2].errors[0]).toMatch(/calendar date/);
    expect(rejected[3].errors).toHaveLength(2);
  });

  it('never echoes a date of birth back in rejected rows', () => {
    const { rejected } = parseCandidateCsv('name,email,dob\nX,x@example.com,31-02-2000\n', now);
    expect(JSON.stringify(rejected)).not.toMatch(/2000|31-02/);
  });

  it('flags duplicate emails within the file, case-insensitively', () => {
    const csv = 'name,email,dob\nA,dup@example.com,15-08-2001\nB,DUP@example.com,16-08-2001\n';
    const { valid, rejected } = parseCandidateCsv(csv, now);
    expect(valid).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ row: 3, errors: ['Duplicate email in file (first seen on row 2)'] });
  });

  it('throws a format error for a missing column, empty file, header only, and too many rows', () => {
    const code = (fn: () => unknown) => {
      try { fn(); } catch (e) { return e instanceof CsvFormatError ? e.code : 'other'; }
      return 'none';
    };
    expect(code(() => parseCandidateCsv('name,email\nA,a@example.com\n', now))).toBe('CSV_MISSING_COLUMNS');
    expect(code(() => parseCandidateCsv('', now))).toBe('CSV_EMPTY');
    expect(code(() => parseCandidateCsv('name,email,dob\n', now))).toBe('CSV_EMPTY');
    const many = ['name,email,dob', ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `N${i},n${i}@example.com,15-08-2001`)].join('\n');
    expect(code(() => parseCandidateCsv(many, now))).toBe('CSV_TOO_MANY_ROWS');
  });

  it('skips blank lines', () => {
    const csv = 'name,email,dob\n\nA,a@example.com,15-08-2001\n\n';
    expect(parseCandidateCsv(csv, now).valid).toHaveLength(1);
  });
});

describe('csvSafeCell', () => {
  it('quotes values and escapes quotes', () => {
    expect(csvSafeCell('Jane "JJ" Doe')).toBe('"Jane ""JJ"" Doe"');
  });
  it('defuses spreadsheet formulas', () => {
    expect(csvSafeCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvSafeCell('+1')).toBe(`"'+1"`);
    expect(csvSafeCell('@cmd')).toBe(`"'@cmd"`);
  });
});
