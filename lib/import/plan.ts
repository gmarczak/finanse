import { diffDays, type LocalDate } from "@/lib/domain/dates";
import type { Account, Category, Transaction, TxKind } from "@/lib/domain/model";
import type { Minor } from "@/lib/domain/money";
import { suggestCategory, type CategoryRule } from "./categorize";
import type { ParsedStatement, StatementRow } from "./model";

export type ImportChoices = {
  accountId: string; // konto, którego dotyczy wyciąg
  ownAccountId: string | null; // drugie konto w tym samym banku (konto ↔ oszczędności); null = pomiń te wiersze
  counterparties: Record<string, string | null>; // przelew do/od osoby: Twoje konto (przelew) albo null (wydatek/przychód)
  /** Wymiana walut na złotówki: "skip" (domyślnie — to Twoje pieniądze z innej waluty), "income" albo id konta, z którego przyszły (np. zamknięty robo-doradca) */
  exchangeFrom: string;
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
  categorySource: "rule" | "built-in" | "interest" | null;
  replace: boolean; // wiersz zbiorczy nadpisywany przy kolejnym imporcie (odsetki za miesiąc)
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
  skipped: { pending: number; otherCurrency: number; ownTransfersWithoutAccount: number; exchange: number };
  counts: { autoCategorized: number; uncategorized: number; topups: number; brokers: number; ownTransfers: number; counterparties: number; interestUpdated: number };
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
      if (row.hint.product === "current") return row.hint.direction === "out" ? "Na konto główne" : "Z konta głównego";
      return row.hint.direction === "out" ? "Na oszczędności" : "Z oszczędności";
    case "counterparty":
      return `${row.amountMinor < 0 ? "Przelew do" : "Przelew od"}: ${row.hint.name}`;
    case "exchange":
      return "Wymiana walut";
    case "broker":
      return `Na ${row.hint.broker.toUpperCase()}`;
    default:
      return d.replace(/^(www\.)/i, "");
  }
}

const MONTHS_NOM = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];

function monthName(date: LocalDate): string {
  return `${MONTHS_NOM[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

/** Nazwy osób z przelewów w wyciągu (z liczbą wierszy), do przypisania: Twoje konto czy wydatek/przychód. */
export function counterpartiesOf(statement: ParsedStatement): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of statement.rows) if (r.hint.type === "counterparty") counts.set(r.hint.name, (counts.get(r.hint.name) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
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
  const existing = new Map(transactions.filter((t) => t.accountId === choices.accountId && t.fingerprint).map((t) => [t.fingerprint!, t]));
  const interestCategory =
    categories.find((c) => c.kind === "income" && c.archivedAt === null && c.name === "Odsetki") ??
    categories.find((c) => c.kind === "income" && c.archivedAt === null && c.name === "Inne przychody");
  // Przelewy między własnymi kontami są w wyciągach obu kont. Jeśli noga już jest na tym koncie
  // (np. z importu drugiego konta), wiersz jest duplikatem: ta sama kwota, data ±1 dzień.
  const transferLegs = transactions.filter((t) => t.accountId === choices.accountId && t.kind === "transfer");
  const usedLegs = new Set<string>();
  const existingLeg = (row: StatementRow) => {
    const leg = transferLegs.find((t) => !usedLegs.has(t.id) && t.amountMinor === row.amountMinor && Math.abs(diffDays(t.bookedOn, row.bookedOn)) <= 1);
    if (leg) usedLegs.add(leg.id);
    return leg !== undefined;
  };
  const plan: ImportPlan = {
    rows: [],
    transfers: [],
    merges: [],
    duplicates: 0,
    skipped: { pending: statement.skippedPending, otherCurrency: statement.skippedOtherCurrency, ownTransfersWithoutAccount: 0, exchange: 0 },
    counts: { autoCategorized: 0, uncategorized: 0, topups: 0, brokers: 0, ownTransfers: 0, counterparties: 0, interestUpdated: 0 },
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
    const already = existing.get(row.fingerprint);
    if (already && !(row.replace && already.amountMinor !== row.amountMinor)) {
      plan.duplicates++;
      continue;
    }
    const hint = row.hint;
    if (hint.type === "exchange" && choices.exchangeFrom === "skip") {
      plan.skipped.exchange++;
      continue;
    }
    if (hint.type === "interest") {
      if (already) plan.counts.interestUpdated++;
      plan.rows.push({
        id: already?.id ?? newId(),
        accountId: choices.accountId,
        bookedOn: row.bookedOn,
        kind: row.amountMinor > 0 ? "income" : "expense",
        amountMinor: row.amountMinor,
        categoryId: row.amountMinor > 0 ? (interestCategory?.id ?? null) : null,
        categorySource: "interest",
        replace: true,
        description: `Odsetki ${monthName(row.bookedOn)}`,
        bankDescription: "Gross Interest",
        fingerprint: row.fingerprint,
      });
      continue;
    }
    const counterpartAccount = hint.type === "counterparty" ? (choices.counterparties[hint.name] ?? null) : null;
    const exchangeAccount = hint.type === "exchange" && choices.exchangeFrom !== "income" ? choices.exchangeFrom : null;
    const isTransferLike = hint.type === "own-transfer" || hint.type === "broker" || hint.type === "topup" || counterpartAccount !== null || exchangeAccount !== null;
    if (isTransferLike && existingLeg(row)) {
      plan.duplicates++;
      continue;
    }
    if (exchangeAccount) {
      transfer(row, exchangeAccount);
      plan.counts.counterparties++;
      continue;
    }
    if (counterpartAccount) {
      transfer(row, counterpartAccount);
      plan.counts.counterparties++;
      continue;
    }
    if (hint.type === "own-transfer") {
      if (choices.ownAccountId) {
        transfer(row, choices.ownAccountId);
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
      replace: false,
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
