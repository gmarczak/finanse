import type { LocalDate } from "./dates";
import type { Minor } from "./money";

/** Kolory jak w Nawykach (tokeny --c-<kolor>-bg / -fg w globals.css). */
export const COLORS = ["green", "blue", "violet", "amber", "rose", "teal", "slate"] as const;
export type Color = (typeof COLORS)[number];

export type AccountKind = "bank" | "broker" | "cash";
export type CategoryKind = "expense" | "income";
export type TxKind = "expense" | "income" | "transfer";

export type Settings = {
  timezone: string;
  monthStartDay: number; // 1–28
};

export type Account = {
  id: string;
  name: string;
  kind: AccountKind;
  institution: string | null;
  currency: string;
  anchorBalanceMinor: Minor | null;
  anchorOn: LocalDate | null;
  sortOrder: number;
  archivedAt: string | null;
};

export type Category = {
  id: string;
  kind: CategoryKind;
  name: string;
  icon: string | null;
  color: Color;
  sortOrder: number;
  archivedAt: string | null;
};

export type Transaction = {
  id: string;
  accountId: string;
  bookedOn: LocalDate;
  kind: TxKind;
  amountMinor: Minor; // ze znakiem, w walucie transakcji
  currency: string;
  amountPlnMinor: Minor; // ze znakiem, w PLN
  categoryId: string | null;
  description: string | null;
  bankDescription: string | null;
  note: string | null;
  source: "manual" | "import";
  transferId: string | null;
  createdAt: string;
};

export type Budget = {
  categoryId: string;
  validFrom: LocalDate; // pierwszy dzień miesiąca
  amountMinor: Minor; // 0 = bez limitu
};

/** Czytelna nazwa transakcji: opis, a gdy go brak — surowy opis z banku. */
export function txTitle(tx: Pick<Transaction, "description" | "bankDescription">): string {
  return tx.description ?? tx.bankDescription ?? "Bez opisu";
}
