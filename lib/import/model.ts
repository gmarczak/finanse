import type { LocalDate } from "@/lib/domain/dates";
import type { Minor } from "@/lib/domain/money";

/** Wiersz wyciągu po parsowaniu, wspólny dla wszystkich banków. */
export type StatementRow = {
  bookedOn: LocalDate;
  amountMinor: Minor; // ze znakiem, po opłatach
  currency: string;
  description: string; // surowy opis z banku
  fingerprint: string; // stały dla tego samego wiersza przy każdym imporcie
  status: "completed" | "pending";
  hint: RowHint;
  /** Wiersz zbiorczy, który kolejny import może nadpisać (np. odsetki za bieżący miesiąc) */
  replace?: boolean;
};

export type RowHint =
  | { type: "card" | "payment" | "refund" | "fee" | "other" }
  | { type: "atm" }
  | { type: "topup" } // doładowanie z innego banku / karty
  | { type: "own-transfer"; product: "savings" | "current"; direction: "in" | "out" } // w obrębie banku (konto ↔ oszczędności)
  | { type: "broker"; broker: string } // np. wpłata na XTB
  | { type: "counterparty"; name: string } // przelew do/od osoby — może to być Twoje konto w innym banku
  | { type: "exchange" } // wymiana walut między własnymi portfelami
  | { type: "interest" }; // odsetki (wiersz zbiorczy za miesiąc)

export type ParsedStatement = {
  format: string; // "revolut" | "revolut-savings"
  label: string; // „Revolut”
  rows: StatementRow[];
  skippedPending: number;
  skippedOtherCurrency: number;
  /** Saldo z wyciągu na koniec ostatniego dnia (gdy bank je podaje) */
  closingBalance: { minor: Minor; on: LocalDate } | null;
  /** Rodzaj konta, którego dotyczy wyciąg */
  accountKind: "bank" | "savings";
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
