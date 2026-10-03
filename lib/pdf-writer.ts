// A small, dependency-free PDF writer for text reports: pages, text, lines and filled rectangles, using the two
// standard fonts every PDF viewer has built in (Helvetica and Helvetica-Bold), so nothing is embedded or downloaded.
// Pure and client-safe (no Node APIs except Buffer in toBuffer). Covered by tests/results-pdf.test.ts.
//
// Coordinates are in points (1/72 inch) measured from the TOP-LEFT of the page, which is how layouts are written.
// Characters outside Latin-1 (for example Tamil or Chinese names) cannot be drawn with a built-in font and show as "?".

export type Rgb = [number, number, number];

export interface PdfPageSize {
  width: number;
  height: number;
}
export const A4_PORTRAIT: PdfPageSize = { width: 595.28, height: 841.89 };
export const A4_LANDSCAPE: PdfPageSize = { width: 841.89, height: 595.28 };

// Helvetica advance widths (per 1000 em) for ASCII 32 to 126, and the bold widths where they differ.
const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

const REPLACEMENTS: Record<string, string> = {
  '\u2013': '-', '\u2014': '-', '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"', '\u2026': '...', '\u2022': '*', '\u00A0': ' ', '\u2192': '->', '\u2713': 'v',
};

/** Makes text safe for a built-in font: Latin-1 only, no control characters. Unsupported characters become "?". */
export function toLatin1(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0) as number;
    if (REPLACEMENTS[ch] !== undefined) out += REPLACEMENTS[ch];
    else if (code < 0x20 || code === 0x7f) out += ' ';
    else if (code <= 0x7e || (code >= 0xa0 && code <= 0xff)) out += ch;
    else out += '?';
  }
  return out;
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

const n = (v: number) => (Math.round(v * 100) / 100).toString();

export interface TextStyle {
  size?: number;
  bold?: boolean;
  color?: Rgb;
}

export class PdfDocument {
  private pages: string[][] = [];
  private current = -1;
  readonly width: number;
  readonly height: number;

  constructor(size: PdfPageSize = A4_PORTRAIT) {
    this.width = size.width;
    this.height = size.height;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  addPage(): number {
    this.pages.push([]);
    this.current = this.pages.length - 1;
    return this.current;
  }

  /** Switches drawing to an existing page (used to add "Page x of y" once the total is known). */
  goToPage(index: number): void {
    if (index < 0 || index >= this.pages.length) throw new RangeError('No such page');
    this.current = index;
  }

  private ops(): string[] {
    if (this.current < 0) this.addPage();
    return this.pages[this.current];
  }

  textWidth(text: string, size = 10, bold = false): number {
    const table = bold ? BOLD : REGULAR;
    let units = 0;
    for (const ch of toLatin1(text)) {
      const code = ch.charCodeAt(0);
      units += code >= 32 && code <= 126 ? table[code - 32] : 556;
    }
    return (units * size) / 1000;
  }

  /** Shortens text with "..." so it fits in maxWidth. */
  fit(text: string, maxWidth: number, size = 10, bold = false): string {
    const clean = toLatin1(text);
    if (this.textWidth(clean, size, bold) <= maxWidth) return clean;
    let out = clean;
    while (out.length > 0 && this.textWidth(`${out}...`, size, bold) > maxWidth) out = out.slice(0, -1);
    return `${out.trimEnd()}...`;
  }

  /** Splits text into lines no wider than maxWidth. Words longer than a line are cut. */
  wrap(text: string, maxWidth: number, size = 10, bold = false): string[] {
    const lines: string[] = [];
    for (const paragraph of toLatin1(text).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        let w = word;
        while (this.textWidth(w, size, bold) > maxWidth && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && this.textWidth(w.slice(0, cut), size, bold) > maxWidth) cut -= 1;
          if (line) {
            lines.push(line);
            line = '';
          }
          lines.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        const next = line ? `${line} ${w}` : w;
        if (line && this.textWidth(next, size, bold) > maxWidth) {
          lines.push(line);
          line = w;
        } else line = next;
      }
      lines.push(line);
    }
    return lines;
  }

  /** Draws text with its baseline at y (from the top of the page). */
  text(x: number, y: number, text: string, style: TextStyle = {}): void {
    const { size = 10, bold = false, color = [0, 0, 0] } = style;
    const safe = escapeText(toLatin1(text));
    this.ops().push(`BT /${bold ? 'F2' : 'F1'} ${n(size)} Tf ${n(color[0])} ${n(color[1])} ${n(color[2])} rg ${n(x)} ${n(this.height - y)} Td (${safe}) Tj ET`);
  }

  textRight(xRight: number, y: number, text: string, style: TextStyle = {}): void {
    this.text(xRight - this.textWidth(text, style.size ?? 10, style.bold ?? false), y, text, style);
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, color: Rgb = [0.75, 0.75, 0.75]): void {
    this.ops().push(`${n(color[0])} ${n(color[1])} ${n(color[2])} RG ${n(width)} w ${n(x1)} ${n(this.height - y1)} m ${n(x2)} ${n(this.height - y2)} l S`);
  }

  /** A filled rectangle whose top-left corner is (x, y). */
  rect(x: number, y: number, w: number, h: number, fill: Rgb): void {
    this.ops().push(`${n(fill[0])} ${n(fill[1])} ${n(fill[2])} rg ${n(x)} ${n(this.height - y - h)} ${n(w)} ${n(h)} re f`);
  }

  toBuffer(meta: { title: string; author?: string; created?: Date } = { title: 'Document' }): Buffer {
    if (this.pages.length === 0) this.addPage();
    const objects: string[] = [];
    const pageObj = (i: number) => 6 + i * 2 + 1;
    const kids = this.pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ');
    const d = (meta.created ?? new Date()).toISOString().replace(/[-:T]/g, '').slice(0, 14);

    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${this.pages.length} >>`;
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    objects[5] = `<< /Title (${escapeText(toLatin1(meta.title))}) /Author (${escapeText(toLatin1(meta.author ?? 'Interview Platform'))}) /Producer (Interview Platform) /CreationDate (D:${d}Z) >>`;
    this.pages.forEach((ops, i) => {
      const stream = ops.join('\n');
      objects[6 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
      objects[pageObj(i)] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(this.width)} ${n(this.height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
    });

    let out = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (let i = 1; i < objects.length; i += 1) {
      offsets[i] = out.length;
      out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xref = out.length;
    out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objects.length; i += 1) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    // Every character is Latin-1 by construction (toLatin1), so one character is one byte and the offsets above are exact.
    return Buffer.from(out, 'latin1');
  }
}
