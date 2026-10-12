import { isLocalDate, type LocalDate } from "@/lib/domain/dates";
import { parseAmount } from "@/lib/domain/money";
import { csvRecords } from "./csv";
import type { ParsedStatement, StatementRow } from "./model";

/**
 * Wyciąg CSV z konta oszczędnościowego Revolut:
 * Date,Description,Money out,Money in,Balance
 * "Jan 1, 2026",Gross Interest,,31.08 PLN,"252,097.40 PLN"
 * Bez godzin, kwoty z walutą i przecinkiem tysięcy. Odsetki są naliczane codziennie —
 * zapisujemy je jednym wierszem za miesiąc, który kolejny import nadpisuje aktualną sumą.
 */
export const REVOLUT_SAVINGS_HEADER = ["Date", "Description", "Money out", "Money in", "Balance"];

export function isRevolutSavings(header: string[]): boolean {
  return REVOLUT_SAVINGS_HEADER.every((h) => header.includes(h)) && !header.includes("Type");
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** „Jan 1, 2026” → „2026-01-01” */
export function parseEnglishDate(text: string): LocalDate | null {
  const m = text.trim().match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[1]!.toLowerCase()];
  if (!month) return null;
  const date = `${m[3]}-${String(month).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  return isLocalDate(date) ? date : null;
}

/** „7,100.00 PLN” → grosze i waluta */
function money(text: string): { minor: number; currency: string } | null {
  const t = text.trim();
  if (!t) return null;
  const currency = t.match(/[A-Z]{3}$/)?.[0] ?? "PLN";
  const minor = parseAmount(t.replace(/[A-Z]{3}$/, "").replace(/,/g, ""));
  return minor === null ? null : { minor, currency };
}

export function parseRevolutSavings(text: string, baseCurrency = "PLN"): ParsedStatement {
  const { header, records } = csvRecords(text);
  if (!isRevolutSavings(header)) throw new Error("To nie wygląda na wyciąg z oszczędności Revoluta.");
  const rows: StatementRow[] = [];
  const interest = new Map<string, { minor: number; last: LocalDate }>();
  const seen = new Map<string, number>();
  let skippedOtherCurrency = 0;
  let closingBalance: ParsedStatement["closingBalance"] = null;

  for (const r of records) {
    const date = parseEnglishDate(r["Date"] ?? "");
    const description = (r["Description"] ?? "").trim();
    const out = money(r["Money out"] ?? "");
    const inn = money(r["Money in"] ?? "");
    const value = out ? { minor: -out.minor, currency: out.currency } : inn;
    if (!date || !value) throw new Error(`Nie rozumiem wiersza: ${r["Date"] ?? "?"} ${description}`);
    if (value.currency !== baseCurrency) {
      skippedOtherCurrency++;
      continue;
    }
    const balance = money(r["Balance"] ?? "");
    if (balance && (!closingBalance || date >= closingBalance.on)) closingBalance = { minor: balance.minor, on: date };
    if (value.minor === 0) continue;

    const kind = description.toLowerCase();
    if (kind.includes("interest")) {
      const month = date.slice(0, 7);
      const acc = interest.get(month) ?? { minor: 0, last: date };
      interest.set(month, { minor: acc.minor + value.minor, last: date > acc.last ? date : acc.last });
      continue;
    }
    // Bez godzin w pliku: odcisk z daty, opisu, kwoty i numeru kolejnego takiego samego wiersza tego dnia
    const key = `${date}:${kind}:${value.minor}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    const isWithdrawal = kind === "withdrawal" || value.minor < 0;
    rows.push({
      bookedOn: date,
      amountMinor: value.minor,
      currency: value.currency,
      description,
      fingerprint: `revolut-savings:${key}:${n}`,
      status: "completed",
      hint: { type: "own-transfer", product: "current", direction: isWithdrawal ? "out" : "in" },
    });
  }

  for (const [month, sum] of interest) {
    if (sum.minor === 0) continue;
    rows.push({
      bookedOn: sum.last,
      amountMinor: sum.minor,
      currency: baseCurrency,
      description: "Odsetki",
      fingerprint: `revolut-savings:interest:${month}`,
      status: "completed",
      hint: { type: "interest" },
      replace: true,
    });
  }
  rows.sort((a, b) => (a.bookedOn < b.bookedOn ? -1 : a.bookedOn > b.bookedOn ? 1 : 0));
  return { format: "revolut-savings", label: "Revolut — oszczędności", rows, skippedPending: 0, skippedOtherCurrency, closingBalance, accountKind: "savings" };
}
