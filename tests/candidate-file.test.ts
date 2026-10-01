import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { candidateFileToCsv, cellToText, decodeText } from '@/lib/candidate-file';
import { parseCandidateCsv } from '@/lib/csv';

const NOW = new Date('2026-10-01T00:00:00Z');
const parse = async (data: Buffer) => parseCandidateCsv(await candidateFileToCsv(data), NOW);
const fixture = (name: string) => readFileSync(path.join(__dirname, 'fixtures', name));

describe('candidateFileToCsv', () => {
  it('reads an .xlsx file: text, number and real date DOB cells, with the lost leading zero restored', async () => {
    const { valid, rejected } = await parse(fixture('candidates.xlsx'));
    expect(rejected).toEqual([]);
    expect(valid.map((r) => [r.name, r.email, r.dobPassword])).toEqual([
      ['Asha Verma', 'asha@example.com', '15082001'],
      ['Ravi Kumar', 'ravi@example.com', '15082001'],
      ['Meera Nair', 'meera@example.com', '02032000'],
      ['Karthik Raja', 'karthik@example.com', '09061996'],
    ]);
  });

  it('is detected by content, so a renamed file still works', async () => {
    expect((await parse(fixture('candidates.xlsx'))).valid).toHaveLength(4);
  });

  it('passes CSV through and accepts TSV and semicolon lists', async () => {
    const csv = Buffer.from('name,email,dob\nAsha,asha@example.com,15-08-2001\n');
    const tsv = Buffer.from('name\temail\tdob\nAsha\tasha@example.com\t15-08-2001\n');
    const semi = Buffer.from('name;email;dob\nAsha;asha@example.com;15-08-2001\n');
    for (const file of [csv, tsv, semi]) expect((await parse(file)).valid[0]).toMatchObject({ name: 'Asha', dobPassword: '15082001' });
  });

  it('reads UTF-16 text exported by Excel ("Unicode Text") and UTF-8 with a BOM', async () => {
    const text = 'name\temail\tdob\nÅsa\tasa@example.com\t15-08-2001\n';
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    const utf8bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]);
    expect((await parse(utf16)).valid[0].name).toBe('Åsa');
    expect((await parse(utf8bom)).valid[0].name).toBe('Åsa');
    expect(decodeText(utf16)).toBe(text);
  });

  it('reads JSON lists, with any key capitalisation, and { candidates: [...] }', async () => {
    const list = Buffer.from(JSON.stringify([{ Name: 'Asha', EMAIL: 'asha@example.com', dob: '1996-06-09' }]));
    const wrapped = Buffer.from(JSON.stringify({ candidates: [{ name: 'Ravi', email: 'ravi@example.com', dob: '09061996' }] }));
    expect((await parse(list)).valid[0]).toMatchObject({ name: 'Asha', dobPassword: '09061996' });
    expect((await parse(wrapped)).valid[0]).toMatchObject({ name: 'Ravi' });
  });

  it('rejects JSON that is not a list, and broken JSON', async () => {
    await expect(candidateFileToCsv(Buffer.from('{"a":1}'))).rejects.toMatchObject({ code: 'CSV_UNREADABLE' });
    await expect(candidateFileToCsv(Buffer.from('[{"name":'))).rejects.toMatchObject({ code: 'CSV_UNREADABLE' });
  });

  it('refuses images and other binary files with a clear message', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]), Buffer.alloc(50)]);
    await expect(candidateFileToCsv(png)).rejects.toMatchObject({ code: 'FILE_UNSUPPORTED' });
  });

  it('refuses PDF and Word files with a clear message, even a renamed one', async () => {
    for (const file of ['sample-resume.pdf', 'blank.pdf', 'sample-resume.docx']) {
      await expect(candidateFileToCsv(fixture(file))).rejects.toMatchObject({ code: 'FILE_UNSUPPORTED' });
    }
  });

  it('refuses a zip that is not an Excel file without crashing', async () => {
    await expect(candidateFileToCsv(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]))).rejects.toMatchObject({ code: 'CSV_UNREADABLE' });
  });

  it('refuses an empty file', async () => {
    await expect(candidateFileToCsv(Buffer.alloc(0))).rejects.toMatchObject({ code: 'CSV_EMPTY' });
  });

  it('still reports missing columns for a text file with the wrong header', async () => {
    await expect(parse(Buffer.from('full name,mail\nA,b\n'))).rejects.toMatchObject({ code: 'CSV_MISSING_COLUMNS' });
  });
});

describe('cellToText', () => {
  it('reads dates in UTC so the day never shifts with the server time zone', () => {
    expect(cellToText(new Date(Date.UTC(1996, 5, 9)), 'dob')).toBe('09-06-1996');
  });
  it('pads numeric DOBs to 8 digits but leaves other numbers alone', () => {
    expect(cellToText(2032000, 'dob')).toBe('02032000');
    expect(cellToText(15082001, 'dob')).toBe('15082001');
    expect(cellToText(7, 'name')).toBe('7');
    expect(cellToText(null, 'dob')).toBe('');
  });
});
