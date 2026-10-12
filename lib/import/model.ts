import type { LocalDate } from "@/lib/domain/dates";
import type { Minor } from "@/lib/domain/money";

/**
 * Wiersz wyciągu po parsowaniu, wspólny dla wszystkich banków.
 * `counterpart` mówi, czy to ruch między własnymi kontami w tym samym banku (np. konto ↔ oszczędności).
 */
export type StatementRow = {
  bookedOn: LocalDate;
  amountMinor: Minor; // ze znakiem, po opłatach
  currency: string;
  description: string; // surowy opis z banku
  fingerprint: string; // stały dla tego samego wiersza przy każdym imporcie
  status: "completed" | "pending";
  hint: RowHint;
};

export type RowHint =
  | { type: "card" | "payment" | "refund" | "fee" | "other" }
  | { type: "atm" }
  | { type: "topup" } // doładowanie z innego banku
  | { type: "own-transfer"; product: "savings" | "current"; direction: "in" | "out" } // w obrębie banku
  | { type: "broker"; broker: string }; // np. wpłata na XTB

export type ParsedStatement = {
  format: string; // "revolut"
  label: string; // „Revolut”
  /** Wiersze rachunku głównego i oszczędności, gdy wyciąg je rozróżnia */
  rows: StatementRow[];
  skippedPending: number;
  skippedOtherCurrency: number;
};

/** Krótki, stały skrót tekstu (FNV-1a) do odcisków — nie kryptografia, tylko rozróżnianie wierszy. */
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
