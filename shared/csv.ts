// Small, pure helpers used when exporting files.

// Spreadsheet apps execute cells that start with = + - or @ as formulas.
// A lead file is untrusted input, so we neutralise those cells on export.
// Plain phone numbers such as "+40 721 000 111" are left alone so the export stays loadable.
export function safeCell(value: string): string {
  if (/^[=@\t\r]/.test(value)) return `'${value}`;
  if (/^[+\-]/.test(value) && !/^[+\-][\d\s().\-]*$/.test(value)) return `'${value}`;
  return value;
}

export function safeRecord<T extends Record<string, string>>(record: T): T {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) out[key] = safeCell(value ?? "");
  return out as T;
}
