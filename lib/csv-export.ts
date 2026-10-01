/** Quotes a CSV cell and neutralises spreadsheet formula injection (=, +, -, @ at the start). */
export function csvSafeCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}
