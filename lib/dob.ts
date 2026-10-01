// Date-of-birth handling. The DOB is the candidate's password (DDMMYYYY) and is never logged or stored
// in clear text; only its bcrypt hash is persisted.

export type DobResult = { ok: true; password: string } | { ok: false; reason: string };

const MIN_YEAR = 1900;

function build(day: number, month: number, year: number, now: Date): DobResult {
  if (year < MIN_YEAR) return { ok: false, reason: 'Date of birth is out of range' };
  const d = new Date(Date.UTC(year, month - 1, day));
  const real = d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  if (!real) return { ok: false, reason: 'Date of birth is not a real calendar date' };
  if (d.getTime() > now.getTime()) return { ok: false, reason: 'Date of birth is in the future' };
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return { ok: true, password: `${pad(day, 2)}${pad(month, 2)}${pad(year, 4)}` };
}

/**
 * Parses admin-supplied DOB values. Accepted: DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, DDMMYYYY, YYYY-MM-DD.
 * Returns the DDMMYYYY password on success.
 */
export function parseDob(input: string, now: Date = new Date()): DobResult {
  const value = input.trim();
  if (!value) return { ok: false, reason: 'Date of birth is required' };

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (m) return build(Number(m[3]), Number(m[2]), Number(m[1]), now);

  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(value);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]), now);

  m = /^(\d{2})(\d{2})(\d{4})$/.exec(value);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]), now);

  return { ok: false, reason: 'Date of birth must look like DD-MM-YYYY' };
}

/** Normalises what a candidate types at login: strips separators and requires exactly 8 digits. */
export function normalizeLoginDob(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  return /^\d{8}$/.test(digits) ? digits : null;
}
