// PDF layouts for results. Pure and client-safe: they take plain data and return PDF bytes, so they are
// covered by tests/results-pdf.test.ts without a database. The data comes from lib/results.ts.
import { A4_LANDSCAPE, A4_PORTRAIT, PdfDocument, type Rgb } from '@/lib/pdf-writer';
import { SUGGESTION_LABEL, type Decision, type ExportRow, type FinalResult, type Suggestion } from '@/lib/final-result';

const INK: Rgb = [0.1, 0.1, 0.12];
const MUTED: Rgb = [0.4, 0.42, 0.46];
const HEAD_BG: Rgb = [0.93, 0.94, 0.96];
const ZEBRA: Rgb = [0.975, 0.978, 0.985];
const GOOD: Rgb = [0.09, 0.45, 0.2];
const BAD: Rgb = [0.7, 0.12, 0.12];
const WARN: Rgb = [0.65, 0.4, 0.02];
const NOTE_BG: Rgb = [0.996, 0.95, 0.82];

const suggestionLabel = (s: string | null) => (s ? SUGGESTION_LABEL[s as Suggestion] ?? s : '');
const decisionColor = (s: string | null): Rgb => (s === 'SHORTLIST' ? GOOD : s === 'REJECT' ? BAD : WARN);
const dateText = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const statusText = (s: string) => s.replace('_', ' ').toLowerCase();

function footers(doc: PdfDocument, margin: number, generatedAt: Date): void {
  const total = doc.pageCount;
  for (let i = 0; i < total; i += 1) {
    doc.goToPage(i);
    const y = doc.height - 22;
    doc.line(margin, y - 10, doc.width - margin, y - 10);
    doc.text(margin, y, `Confidential. Suggested decisions are not final until an admin confirms them. Generated ${dateText(generatedAt)}.`, { size: 7.5, color: MUTED });
    doc.textRight(doc.width - margin, y, `Page ${i + 1} of ${total}`, { size: 7.5, color: MUTED });
  }
}

// ───────────────────────── All candidates ─────────────────────────

export interface ResultsPdfInput {
  /** Shown as the report heading, for example the job title or "All jobs". */
  heading: string;
  rows: ExportRow[];
  roundLabels: Record<string, string>;
  generatedAt: Date;
}

/** One landscape table: a row per candidate with each round's percent, the weighted score and the decision. */
export function buildResultsPdf({ heading, rows, roundLabels, generatedAt }: ResultsPdfInput): Buffer {
  const doc = new PdfDocument(A4_LANDSCAPE);
  const margin = 36;
  const usable = doc.width - margin * 2;
  const types = Object.keys(roundLabels).filter((t) => rows.some((r) => r.roundPercents[t] !== undefined));

  const fixed = { id: 78, name: 132, weighted: 56, suggested: 92, decision: 78, proctor: 52 };
  const roundWidth = types.length > 0 ? Math.max(40, (usable - Object.values(fixed).reduce((a, b) => a + b, 0)) / types.length) : 0;
  const cols: { key: string; label: string; width: number; right?: boolean }[] = [
    { key: 'id', label: 'Candidate ID', width: fixed.id },
    { key: 'name', label: 'Name', width: fixed.name },
    ...types.map((t) => ({ key: `round:${t}`, label: roundLabels[t], width: roundWidth, right: true })),
    { key: 'weighted', label: 'Weighted', width: fixed.weighted, right: true },
    { key: 'suggested', label: 'Suggested', width: fixed.suggested },
    { key: 'decision', label: 'Decision', width: fixed.decision },
    { key: 'proctor', label: 'Proctoring', width: fixed.proctor, right: true },
  ];

  const rowH = 20;
  const bottom = doc.height - 46;
  let y = 0;

  const drawHead = () => {
    doc.rect(margin, y - 13, usable, 20, HEAD_BG);
    let x = margin;
    for (const c of cols) {
      const label = doc.fit(c.label, c.width - 8, 8.5, true);
      if (c.right) doc.textRight(x + c.width - 4, y, label, { size: 8.5, bold: true, color: INK });
      else doc.text(x + 4, y, label, { size: 8.5, bold: true, color: INK });
      x += c.width;
    }
    y += 14;
  };

  doc.addPage();
  doc.text(margin, 48, 'Interview results', { size: 18, bold: true, color: INK });
  doc.text(margin, 66, doc.fit(heading, usable, 11), { size: 11, color: MUTED });

  const count = (pred: (r: ExportRow) => boolean) => rows.filter(pred).length;
  const summary = [
    `${rows.length} candidate${rows.length === 1 ? '' : 's'}`,
    `${count((r) => r.finalDecision === 'SHORTLIST')} shortlisted`,
    `${count((r) => r.finalDecision === 'REJECT')} rejected`,
    `${count((r) => r.suggestion !== null && r.finalDecision === null)} waiting for a decision`,
    `${count((r) => r.suggestion === null)} still in progress`,
  ].join('   |   ');
  doc.text(margin, 84, summary, { size: 9, color: INK });

  y = 112;
  drawHead();

  if (rows.length === 0) doc.text(margin + 4, y + 8, 'No candidates to show.', { size: 10, color: MUTED });

  rows.forEach((r, i) => {
    if (y + rowH > bottom) {
      doc.addPage();
      y = 56;
      drawHead();
    }
    if (i % 2 === 1) doc.rect(margin, y - 13, usable, rowH, ZEBRA);
    let x = margin;
    const put = (c: (typeof cols)[number], text: string, color: Rgb = INK, bold = false) => {
      const t = doc.fit(text, c.width - 8, 8.5, bold);
      if (c.right) doc.textRight(x + c.width - 4, y, t, { size: 8.5, bold, color });
      else doc.text(x + 4, y, t, { size: 8.5, bold, color });
    };
    for (const c of cols) {
      if (c.key === 'id') put(c, r.candidateCode);
      else if (c.key === 'name') put(c, r.name);
      else if (c.key.startsWith('round:')) {
        const p = r.roundPercents[c.key.slice(6)];
        put(c, p === undefined || p === null ? '-' : `${p}%`, p === undefined || p === null ? MUTED : INK);
      } else if (c.key === 'weighted') put(c, r.weightedScore === null ? '-' : String(r.weightedScore), INK, true);
      else if (c.key === 'suggested') {
        const aiMark = r.suggestion === 'REJECT' && r.rejectionRestsOnAi ? ' *' : '';
        put(c, r.suggestion ? `${suggestionLabel(r.suggestion)}${aiMark}` : 'In progress', r.suggestion ? decisionColor(r.suggestion) : MUTED);
      } else if (c.key === 'decision') put(c, r.finalDecision ? suggestionLabel(r.finalDecision) : r.suggestion ? 'Pending' : '', r.finalDecision ? decisionColor(r.finalDecision) : WARN, Boolean(r.finalDecision));
      else if (c.key === 'proctor') put(c, r.proctorEvents === 0 ? 'none' : String(r.proctorEvents), r.proctorEvents === 0 ? MUTED : INK);
      x += c.width;
    }
    y += rowH;
  });

  if (rows.some((r) => r.suggestion === 'REJECT' && r.rejectionRestsOnAi)) {
    if (y + 30 > bottom) {
      doc.addPage();
      y = 56;
    }
    doc.text(margin, y + 10, '* A rejection that rests on AI-graded answers. Read the answers before confirming it.', { size: 8, color: MUTED });
    y += 14;
  }
  doc.text(margin, y + 10, 'Rounds a candidate has not finished count as 0 in the weighted score.', { size: 8, color: MUTED });

  footers(doc, margin, generatedAt);
  return doc.toBuffer({ title: `Interview results - ${heading}`, created: generatedAt });
}

// ───────────────────────── One candidate ─────────────────────────

export interface CandidatePdfInput {
  candidateCode: string;
  name: string;
  email: string;
  jobTitle: string;
  status: string;
  result: FinalResult;
  finalDecision: Decision | null;
  decidedAt: string | null;
  decidedByName: string | null;
  proctorEvents: number;
  generatedAt: Date;
}

/** A one-page result sheet for a single candidate: weighted score, round breakdown, suggestion and the admin's decision. */
export function buildCandidatePdf(input: CandidatePdfInput): Buffer {
  const doc = new PdfDocument(A4_PORTRAIT);
  const margin = 48;
  const usable = doc.width - margin * 2;
  const { result } = input;
  doc.addPage();

  doc.text(margin, 58, 'Candidate result', { size: 18, bold: true, color: INK });
  doc.text(margin, 82, doc.fit(input.name, usable, 14, true), { size: 14, bold: true, color: INK });
  doc.text(margin, 99, doc.fit(`${input.candidateCode}  |  ${input.email}  |  ${input.jobTitle}`, usable, 9.5), { size: 9.5, color: MUTED });
  doc.text(margin, 113, `Status: ${statusText(input.status)}`, { size: 9.5, color: MUTED });
  doc.line(margin, 124, margin + usable, 124);

  // Headline numbers
  doc.text(margin, 154, 'Weighted score', { size: 9, color: MUTED });
  doc.text(margin, 182, `${result.weightedScore} / 100`, { size: 24, bold: true, color: INK });
  const colX = margin + 200;
  doc.text(colX, 154, 'Suggested decision', { size: 9, color: MUTED });
  doc.text(colX, 176, result.suggestion ? suggestionLabel(result.suggestion) : 'Interview in progress', { size: 13, bold: true, color: result.suggestion ? decisionColor(result.suggestion) : MUTED });
  const col2X = margin + 370;
  doc.text(col2X, 154, 'Final decision', { size: 9, color: MUTED });
  doc.text(col2X, 176, input.finalDecision ? suggestionLabel(input.finalDecision) : result.suggestion ? 'Pending human review' : '-', { size: 13, bold: true, color: input.finalDecision ? decisionColor(input.finalDecision) : WARN });
  if (input.finalDecision && input.decidedAt) {
    const by = input.decidedByName ? ` by ${input.decidedByName}` : '';
    doc.text(col2X, 192, doc.fit(`Decided${by} on ${input.decidedAt.slice(0, 10)}`, usable - 370, 8), { size: 8, color: MUTED });
  }

  // Round breakdown
  let y = 232;
  doc.text(margin, y, 'Round breakdown', { size: 11, bold: true, color: INK });
  y += 14;
  const cols = [
    { label: 'Round', width: 150, right: false },
    { label: 'Weight', width: 60, right: true },
    { label: 'Score', width: 60, right: true },
    { label: 'Cutoff', width: 60, right: true },
    { label: 'Result', width: 70, right: false },
    { label: 'Points', width: usable - 400, right: true },
  ];
  doc.rect(margin, y - 12, usable, 20, HEAD_BG);
  let x = margin;
  for (const c of cols) {
    if (c.right) doc.textRight(x + c.width - 6, y, c.label, { size: 9, bold: true, color: INK });
    else doc.text(x + 6, y, c.label, { size: 9, bold: true, color: INK });
    x += c.width;
  }
  y += 20;
  result.rounds.forEach((r, i) => {
    if (i % 2 === 1) doc.rect(margin, y - 12, usable, 20, ZEBRA);
    const outcome = r.percent === null ? 'Not taken' : r.passed ? 'Passed' : 'Below cutoff';
    const outcomeColor = r.percent === null ? MUTED : r.passed ? GOOD : BAD;
    const cells = [
      { t: doc.fit(r.label, 138, 9.5), right: false, color: INK },
      { t: `${r.weightPercent}%`, right: true, color: INK },
      { t: r.percent === null ? '-' : `${r.percent}%`, right: true, color: r.percent === null ? MUTED : INK },
      { t: `${r.cutoffPercent}%`, right: true, color: INK },
      { t: outcome, right: false, color: outcomeColor },
      { t: r.counted ? String(r.contribution) : '-', right: true, color: INK },
    ];
    x = margin;
    cells.forEach((cell, k) => {
      if (cell.right) doc.textRight(x + cols[k].width - 6, y, cell.t, { size: 9.5, color: cell.color });
      else doc.text(x + 6, y, cell.t, { size: 9.5, color: cell.color });
      x += cols[k].width;
    });
    y += 20;
  });
  doc.line(margin, y - 8, margin + usable, y - 8);
  doc.textRight(margin + usable - 6, y + 6, `Weighted score ${result.weightedScore}`, { size: 9.5, bold: true, color: INK });
  y += 34;

  // Reasons
  if (result.reasons.length > 0) {
    doc.text(margin, y, 'Why this suggestion', { size: 11, bold: true, color: INK });
    y += 16;
    for (const reason of result.reasons) {
      for (const line of doc.wrap(reason, usable - 12, 10)) {
        doc.text(margin + 12, y, line, { size: 10, color: INK });
        y += 14;
      }
    }
    y += 10;
  }

  // Human-review notice: a rejection that rests on AI-graded answers is never silently final.
  if (result.suggestion === 'REJECT' && result.rejectionRestsOnAi && input.finalDecision === null) {
    const lines = doc.wrap('This rejection rests on AI-graded answers. It is a suggestion only and stays pending until an admin has read the answers and confirmed or overridden it.', usable - 20, 9.5);
    const h = lines.length * 13 + 16;
    doc.rect(margin, y - 4, usable, h, NOTE_BG);
    lines.forEach((l, k) => doc.text(margin + 10, y + 12 + k * 13, l, { size: 9.5, color: INK }));
    y += h + 12;
  }

  doc.text(margin, y + 4, 'Proctoring', { size: 11, bold: true, color: INK });
  doc.text(margin, y + 20, input.proctorEvents === 0 ? 'No events were logged.' : `${input.proctorEvents} event${input.proctorEvents === 1 ? '' : 's'} logged (tab switches, pastes, fullscreen exits). Events are signals for a person to look at, not a verdict.`, { size: 10, color: INK });

  footers(doc, margin, input.generatedAt);
  return doc.toBuffer({ title: `Candidate result - ${input.candidateCode}`, created: input.generatedAt });
}
