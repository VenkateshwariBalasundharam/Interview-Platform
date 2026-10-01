import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_RESUME_BYTES, detectResumeFormat, extractResumeText, normaliseResumeText, redactContactDetails, validateResumeUpload } from '@/lib/resume-file';

const fixture = (name: string) => readFileSync(path.join(__dirname, 'fixtures', name));

describe('detectResumeFormat', () => {
  it('goes by the first bytes, not the name', () => {
    expect(detectResumeFormat(Buffer.from('%PDF-1.7 ...'))).toBe('pdf');
    expect(detectResumeFormat(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14]))).toBe('docx');
    expect(detectResumeFormat(Buffer.from('MZ\x90\x00 an exe'))).toBeNull();
    expect(detectResumeFormat(Buffer.from('<html>'))).toBeNull();
    expect(detectResumeFormat(Buffer.alloc(0))).toBeNull();
  });
});

describe('validateResumeUpload', () => {
  it('accepts a PDF and rejects empty, oversized and unsupported files', () => {
    expect(validateResumeUpload(Buffer.from('%PDF-1.4 x'))).toBe('pdf');
    expect(() => validateResumeUpload(Buffer.alloc(0))).toThrowError(expect.objectContaining({ code: 'RESUME_EMPTY', status: 400 }));
    expect(() => validateResumeUpload(Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(MAX_RESUME_BYTES)]))).toThrowError(expect.objectContaining({ code: 'RESUME_TOO_LARGE', status: 413 }));
    expect(() => validateResumeUpload(Buffer.from('hello world'))).toThrowError(expect.objectContaining({ code: 'RESUME_UNSUPPORTED_TYPE' }));
  });
});

describe('normaliseResumeText', () => {
  it('removes control characters, tidies whitespace and caps length', () => {
    expect(normaliseResumeText('a\u0000b   c\n\n\n\nd \t e')).toBe('a b c\nd e');
    expect(normaliseResumeText('x'.repeat(50_000))).toHaveLength(20_000);
  });
});

describe('redactContactDetails', () => {
  it('removes emails, links and phone numbers', () => {
    const out = redactContactDetails('Mail a.b+c@mail.example.co.in, call +91 98765 43210 or 9876543210 or (415) 555-2671, see https://x.dev/me and linkedin.com/in/asha');
    expect(out).not.toMatch(/@|98765|9876543210|555-2671|x\.dev|linkedin/);
  });

  it('keeps date ranges and years intact', () => {
    const text = 'Engineer 2019 - 2022, then 2022-2025. Team of 12 people, 3.5 years.';
    expect(redactContactDetails(text)).toBe(text);
  });
});

describe('extractResumeText', () => {
  it('reads text from a PDF', async () => {
    const text = await extractResumeText(fixture('sample-resume.pdf'), 'pdf');
    expect(text).toContain('Frontend Developer');
    expect(text).toContain('TypeScript');
  });

  it('leaves the uploaded bytes untouched so the stored file stays valid', async () => {
    const original = fixture('sample-resume.pdf');
    const before = Buffer.from(original);
    await extractResumeText(original, 'pdf');
    await extractResumeText(original, 'pdf');
    expect(original.equals(before)).toBe(true);
  });

  it('reads text from a Word document', async () => {
    const text = await extractResumeText(fixture('sample-resume.docx'), 'docx');
    expect(text).toContain('Frontend Developer');
    expect(text).toContain('Sample Shop');
  });

  it('recognises both fixtures by their first bytes', () => {
    expect(detectResumeFormat(fixture('sample-resume.pdf'))).toBe('pdf');
    expect(detectResumeFormat(fixture('sample-resume.docx'))).toBe('docx');
  });

  it('reports a damaged file as unreadable', async () => {
    await expect(extractResumeText(Buffer.from('%PDF-1.4 this is not a real pdf'), 'pdf')).rejects.toMatchObject({ code: 'RESUME_UNREADABLE' });
    await expect(extractResumeText(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), 'docx')).rejects.toMatchObject({ code: 'RESUME_UNREADABLE' });
  });

  it('reports a PDF without text as needing a text-based file', async () => {
    await expect(extractResumeText(fixture('blank.pdf'), 'pdf')).rejects.toMatchObject({ code: 'RESUME_NO_TEXT' });
  });
});
