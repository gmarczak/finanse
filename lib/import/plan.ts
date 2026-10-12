import { diffDays, type LocalDate } from "@/lib/domain/dates";
import type { Account, Category, Transaction, TxKind } from "@/lib/domain/model";
import type { Minor } from "@/lib/domain/money";
import { suggestCategory, type CategoryRule } from "./categorize";
import type { ParsedStatement, StatementRow } from "./model";

export type ImportChoices = {
  accountId: string; // konto, którego dotyczy wyciąg
  savingsAccountId: string | null; // dokąd idą „To/From Savings” (null = pomiń te wiersze)
  brokerAccountIds: Record<string, string | null>; // np. { xtb: "<id XTB>" } (null = traktuj jako wydatek)
  topupFrom: string | "income"; // doładowania z innego banku: z którego konta, albo przychód
  rejectedMerges: string[]; // odciski wierszy, których NIE łączyć z ręcznym wpisem
};

export type PlannedRow = {
  id: string;
  accountId: string;
  bookedOn: LocalDate;
  kind: Exclude<TxKind, "transfer">;
  amountMinor: Minor;
  categoryId: string | null;
  categorySource: "rule" | "built-in" | null;
  description: string;
  bankDescription: string;
  fingerprint: string;
};

export type PlannedTransfer = {
  transferId: string;
  bookedOn: LocalDate;
  description: string;
  legs: { id: string; accountId: string; amountMinor: Minor; fingerprint: string; bankDescription: string }[];
};

export type PlannedMerge = { row: StatementRow; manual: Transaction };

export type ImportPlan = {
  rows: PlannedRow[];
  transfers: PlannedTransfer[];
  merges: PlannedMerge[];
  duplicates: number;
  skipped: { pending: number; otherCurrency: number; ownTransfersWithoutAccount: number };
  counts: { autoCategorized: number; uncategorized: number; topups: number; brokers: number; ownTransfers: number };
};

/** Czytelny opis z surowego opisu banku. */
export function cleanDescription(row: StatementRow): string {
  const d = row.description.trim();
  switch (row.hint.type) {
    case "atm":
      return `Bankomat${d.replace(/^cash withdrawal at\s*/i, "") ? ` (${d.replace(/^cash withdrawal at\s*/i, "")})` : ""}`;
    case "topup":
      return "Doładowanie z innego banku";
    case "own-transfer":
      return row.hint.direction === "out" ? "Na oszczędności" : "Z oszczędności";
    case "broker":
      return `Na ${row.hint.broker.toUpperCase()}`;
    default:
      return d.replace(/^(www\.)/i, "");
  }
}

export function buildImportPlan(input: {
  statement: ParsedStatement;
  choices: ImportChoices;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  rules: CategoryRule[];
  newId: () => string;
}): ImportPlan {
  const { statement, choices, categories, transactions, rules, newId } = input;
  const existing = new Set(transactions.filter((t) => t.accountId === choices.accountId && t.fingerprint).map((t) => t.fingerprint));
  const plan: ImportPlan = {
    rows: [],
    transfers: [],
    merges: [],
    duplicates: 0,
    skipped: { pending: statement.skippedPending, otherCurrency: statement.skippedOtherCurrency, ownTransfersWithoutAccount: 0 },
    counts: { autoCategorized: 0, uncategorized: 0, topups: 0, brokers: 0, ownTransfers: 0 },
  };

  // Ręczne wpisy z tego konta, które mogą być tym samym co wiersz z banku (ta sama kwota, ±2 dni)
  const manual = transactions.filter((t) => t.accountId === choices.accountId && t.source === "manual" && t.kind !== "transfer");
  const usedManual = new Set<string>();

  const transfer = (row: StatementRow, otherAccountId: string) => {
    const transferId = newId();
    plan.transfers.push({
      transferId,
      bookedOn: row.bookedOn,
      description: cleanDescription(row),
      legs: [
        { id: transferId, accountId: choices.accountId, amountMinor: row.amountMinor, fingerprint: row.fingerprint, bankDescription: row.description },
        { id: newId(), accountId: otherAccountId, amountMinor: -row.amountMinor, fingerprint: row.fingerprint, bankDescription: row.description },
      ],
    });
  };

  for (const row of statement.rows) {
    if (existing.has(row.fingerprint)) {
      plan.duplicates++;
      continue;
    }
    const hint = row.hint;
    if (hint.type === "own-transfer") {
      if (choices.savingsAccountId) {
        transfer(row, choices.savingsAccountId);
        plan.counts.ownTransfers++;
      } else plan.skipped.ownTransfersWithoutAccount++;
      continue;
    }
    if (hint.type === "broker" && choices.brokerAccountIds[hint.broker]) {
      transfer(row, choices.brokerAccountIds[hint.broker]!);
      plan.counts.brokers++;
      continue;
    }
    if (hint.type === "topup" && choices.topupFrom !== "income" && row.amountMinor > 0) {
      transfer(row, choices.topupFrom);
      plan.counts.topups++;
      continue;
    }

    // Wydatek (także zwrot: wydatek z dodatnią kwotą) albo przychód
    const kind: PlannedRow["kind"] = row.amountMinor < 0 || hint.type === "refund" ? "expense" : "income";

    if (!choices.rejectedMerges.includes(row.fingerprint)) {
      const match = manual.find(
        (m) => !usedManual.has(m.id) && m.amountPlnMinor === row.amountMinor && Math.abs(diffDays(m.bookedOn, row.bookedOn)) <= 2,
      );
      if (match) {
        usedManual.add(match.id);
        plan.merges.push({ row, manual: match });
        continue;
      }
    }

    const suggestion = hint.type === "atm" ? null : suggestCategory(row.description, kind, rules, categories);
    if (suggestion) plan.counts.autoCategorized++;
    else plan.counts.uncategorized++;
    plan.rows.push({
      id: newId(),
      accountId: choices.accountId,
      bookedOn: row.bookedOn,
      kind,
      amountMinor: row.amountMinor,
      categoryId: suggestion?.categoryId ?? null,
      categorySource: suggestion?.source ?? null,
      description: cleanDescription(row),
      bankDescription: row.description,
      fingerprint: row.fingerprint,
    });
  }
  return plan;
}

/** Ile wierszy faktycznie trafi do bazy (przelew liczony raz). */
export function plannedCount(plan: ImportPlan): number {
  return plan.rows.length + plan.transfers.length + plan.merges.length;
}
