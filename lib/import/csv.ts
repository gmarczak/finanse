/**
 * Parser CSV zgodny z RFC 4180: cudzysłowy, przecinki i nowe linie w polach, "" jako cudzysłów.
 * Separator wykrywany z pierwszej linii (, ; albo tabulator) — polskie banki często używają średnika.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? undefined : text.search(/\r?\n/));
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0]![0];
}

export function parseCsv(input: string, delimiter = detectDelimiter(input)): string[][] {
  const text = input.replace(/^﻿/, ""); // BOM z Excela
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

/** Wiersze jako obiekty kluczowane nagłówkiem (pierwszy wiersz). */
export function csvRecords(input: string): { header: string[]; records: Record<string, string>[] } {
  const [header = [], ...rest] = parseCsv(input);
  const clean = header.map((h) => h.trim());
  return { header: clean, records: rest.map((r) => Object.fromEntries(clean.map((h, i) => [h, (r[i] ?? "").trim()]))) };
}
