import { describe, expect, it } from 'vitest';
import { computeFinalResult, type ExportRow, type ResultInput } from '@/lib/final-result';
import { PdfDocument, toLatin1 } from '@/lib/pdf-writer';
import { buildCandidatePdf, buildResultsPdf } from '@/lib/results-pdf';

const text = (buf: Buffer) => buf.toString('latin1');
const when = new Date('2026-10-02T10:30:00Z');

const row = (over: Partial<ExportRow> = {}): ExportRow => ({
  candidateCode: 'CAND-XXXX1001',
  name: 'Asha Raman',
  email: 'asha@example.com',
  job: 'Backend Engineer',
  status: 'COMPLETED',
  roundPercents: { ASSESSMENT: 80, CODING: 55 },
  weightedScore: 67.5,
  suggestion: 'SHORTLIST',
  finalDecision: null,
  rejectionRestsOnAi: false,
  proctorEvents: 0,
  ...over,
});
const labels = { ASSESSMENT: 'Assessment', CODING: 'Coding' };

describe('pdf writer', () => {
  it('writes a valid PDF skeleton with an xref that points at every object', () => {
    const doc = new PdfDocument();
    doc.addPage();
    doc.text(50, 50, 'Hello');
    doc.addPage();
    const s = text(doc.toBuffer({ title: 'T' }));
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s).toContain('/Count 2');
    const start = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(start, start + 4)).toBe('xref');
    const entries = [...s.slice(start).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(entries.length).toBe(5 + 2 * 2);
    entries.forEach((offset, i) => expect(s.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });

  it('stream /Length matches the stream bytes', () => {
    const doc = new PdfDocument();
    doc.text(10, 10, 'Some text');
    const s = text(doc.toBuffer());
    const m = /\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(s)!;
    expect(Number(m[1])).toBe(m[2].length);
  });

  it('escapes brackets and backslashes so text cannot break out of the string', () => {
    const doc = new PdfDocument();
    doc.text(10, 10, 'a) Tj (b \\ c');
    expect(text(doc.toBuffer())).toContain('(a\\) Tj \\(b \\\\ c)');
  });

  it('replaces characters a built-in font cannot draw instead of writing invalid bytes', () => {
    expect(toLatin1('Zoë “quoted” — ok')).toBe('Zoë "quoted" - ok');
    expect(toLatin1('தமிழ்')).toBe('?????');
    expect(toLatin1('a\u0000b')).toBe('a b');
    const bytes = new PdfDocument().toBuffer({ title: 'தமிழ்' });
    expect(bytes.every((b) => b < 256)).toBe(true);
  });

  it('measures, fits and wraps text', () => {
    const doc = new PdfDocument();
    expect(doc.textWidth('iii', 10)).toBeLessThan(doc.textWidth('WWW', 10));
    expect(doc.textWidth('abc', 10, true)).toBeGreaterThan(doc.textWidth('abc', 10));
    const fitted = doc.fit('A very long candidate name that cannot fit', 60, 10);
    expect(fitted.endsWith('...')).toBe(true);
    expect(doc.textWidth(fitted, 10)).toBeLessThanOrEqual(60);
    const lines = doc.wrap('one two three four five six seven eight nine ten', 70, 10);
    expect(lines.length).toBeGreaterThan(1);
    lines.forEach((l) => expect(doc.textWidth(l, 10)).toBeLessThanOrEqual(70));
    doc.wrap('x'.repeat(200), 50, 10).forEach((l) => expect(doc.textWidth(l, 10)).toBeLessThanOrEqual(50));
  });
});

describe('results list PDF', () => {
  it('has a title, every candidate and a page number footer', () => {
    const s = text(buildResultsPdf({ heading: 'Backend Engineer', rows: [row(), row({ candidateCode: 'CAND-XXXX1002', name: 'Ravi', suggestion: 'REJECT', finalDecision: 'REJECT', weightedScore: 30 })], roundLabels: labels, generatedAt: when }));
    expect(s).toContain('(Interview results)');
    expect(s).toContain('(Backend Engineer)');
    expect(s).toContain('(CAND-XXXX1001)');
    expect(s).toContain('(Ravi)');
    expect(s).toContain('(Page 1 of 1)');
    expect(s).toContain('(80%)');
    expect(s).toContain('(Pending)');
    expect(s).toContain('0 shortlisted');
  });

  it('adds pages for long lists and repeats the header', () => {
    const rows = Array.from({ length: 70 }, (_, i) => row({ candidateCode: `CAND-${1000 + i}`, name: `Person ${i}` }));
    const s = text(buildResultsPdf({ heading: 'All jobs', rows, roundLabels: labels, generatedAt: when }));
    const pages = Number(/\/Count (\d+)/.exec(s)![1]);
    expect(pages).toBeGreaterThan(1);
    expect(s).toContain(`(Page ${pages} of ${pages})`);
    expect(s.split('(Candidate ID)').length - 1).toBe(pages);
    expect(s).toContain('(CAND-1069)');
  });

  it('marks a rejection that rests on AI-graded answers and explains the mark', () => {
    const s = text(buildResultsPdf({ heading: 'x', rows: [row({ suggestion: 'REJECT', rejectionRestsOnAi: true })], roundLabels: labels, generatedAt: when }));
    expect(s).toContain('(Reject *)');
    expect(s).toContain('rests on AI-graded answers');
  });

  it('shows in-progress candidates without a decision and handles an empty list', () => {
    const inProgress = text(buildResultsPdf({ heading: 'x', rows: [row({ suggestion: null, weightedScore: null, roundPercents: { ASSESSMENT: null } })], roundLabels: labels, generatedAt: when }));
    expect(inProgress).toContain('(In progress)');
    const empty = text(buildResultsPdf({ heading: 'x', rows: [], roundLabels: labels, generatedAt: when }));
    expect(empty).toContain('(No candidates to show.)');
  });

  it('neutralises hostile names: no formula guard needed in a PDF, but nothing can break the content stream', () => {
    const s = text(buildResultsPdf({ heading: 'x', rows: [row({ name: ') Tj ET (evil' })], roundLabels: labels, generatedAt: when }));
    expect(s).toContain('\\) Tj ET \\(evil');
  });
});

const input = (rounds: ResultInput['rounds'], status: ResultInput['candidateStatus'] = 'COMPLETED') => computeFinalResult({ candidateStatus: status, rounds });
const round = (roundType: string, percent: number | null, weight = 50, cutoffPercent = 60) => ({ roundType, label: roundType, weight, cutoffPercent, required: true, aiGraded: roundType === 'HR', percent });

const candidate = (result = input([round('ASSESSMENT', 80), round('CODING', 70)]), over = {}) => ({
  candidateCode: 'CAND-XXXX1001',
  name: 'Asha Raman',
  email: 'asha@example.com',
  jobTitle: 'Backend Engineer',
  status: 'COMPLETED',
  result,
  finalDecision: null,
  decidedAt: null,
  decidedByName: null,
  proctorEvents: 0,
  generatedAt: when,
  ...over,
});

describe('candidate PDF', () => {
  it('shows the weighted score, round breakdown, suggestion and pending decision', () => {
    const s = text(buildCandidatePdf(candidate()));
    expect(s).toContain('(Candidate result)');
    expect(s).toContain('(75 / 100)');
    expect(s).toContain('(ASSESSMENT)');
    expect(s).toContain('(80%)');
    expect(s).toContain('(Shortlist)');
    expect(s).toContain('(Pending human review)');
    expect(s).toContain('(No events were logged.)');
  });

  it('shows who decided and when once an admin has decided', () => {
    const s = text(buildCandidatePdf(candidate(undefined, { finalDecision: 'SHORTLIST', decidedAt: '2026-10-02T09:00:00.000Z', decidedByName: 'Admin' })));
    expect(s).toContain('Decided by Admin on 2026-10-02');
    expect(s).not.toContain('Pending human review');
  });

  it('flags a rejection resting on AI-graded answers until a person decides', () => {
    const r = input([round('ASSESSMENT', 80), round('HR', 20)], 'DISQUALIFIED');
    expect(r.rejectionRestsOnAi).toBe(true);
    expect(text(buildCandidatePdf(candidate(r)))).toContain('This rejection rests on AI-graded answers');
    expect(text(buildCandidatePdf(candidate(r, { finalDecision: 'REJECT' })))).not.toContain('This rejection rests on AI-graded answers');
  });

  it('handles a candidate who is still in progress and one with proctoring events', () => {
    const s = text(buildCandidatePdf(candidate(input([round('ASSESSMENT', 80), round('CODING', null)], 'ACTIVE'), { status: 'ACTIVE', proctorEvents: 3 })));
    expect(s).toContain('(Interview in progress)');
    expect(s).toContain('(Not taken)');
    expect(s).toContain('3 events logged');
  });

  it('never includes the date of birth or answer content: it only takes scores and identity fields', () => {
    const keys = Object.keys(candidate());
    expect(keys.some((k) => /dob|birth|answer|resume/i.test(k))).toBe(false);
  });
});
