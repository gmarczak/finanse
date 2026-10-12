import type { LocalDate } from "./dates";
import type { Budget, Category, Transaction } from "./model";
import type { Minor } from "./money";
import { daysLeft, previousPeriod, sameDayInPrevious, type Period } from "./period";

export type LimitState = "none" | "ok" | "warn" | "over";

export type CategoryLine = {
  category: Category | null; // null = bez kategorii
  spentMinor: Minor; // dodatnie
  limitMinor: Minor | null;
  state: LimitState;
};

export type MonthSummary = {
  period: Period;
  spentMinor: Minor;
  incomeMinor: Minor;
  totalLimitMinor: Minor | null; // null, gdy żadna kategoria nie ma limitu
  remainingMinor: Minor | null;
  daysLeft: number;
  lines: CategoryLine[];
  /** Wydatki w poprzednim okresie do tego samego dnia; null, gdy brak danych z poprzedniego okresu. */
  previousToDateMinor: Minor | null;
  uncategorizedCount: number;
};

/** Próg ostrzeżenia o limicie (powiadomienie i kolor). */
export const WARN_RATIO = 0.8;

export function limitState(spent: Minor, limit: Minor | null): LimitState {
  if (limit === null || limit <= 0) return "none";
  if (spent > limit) return "over";
  if (spent >= limit * WARN_RATIO) return "warn";
  return "ok";
}

/** Limit kategorii obowiązujący w okresie: najnowsza wersja z `validFrom` ≤ początek okresu; 0 = brak. */
export function limitFor(budgets: Budget[], categoryId: string, period: Period): Minor | null {
  let best: Budget | null = null;
  for (const b of budgets) {
    if (b.categoryId !== categoryId || b.validFrom > period.from) continue;
    if (!best || b.validFrom > best.validFrom) best = b;
  }
  return best && best.amountMinor > 0 ? best.amountMinor : null;
}

function inRange(date: LocalDate, from: LocalDate, to: LocalDate): boolean {
  return date >= from && date <= to;
}

function spentBetween(transactions: Transaction[], from: LocalDate, to: LocalDate): Minor {
  let sum = 0;
  for (const t of transactions) if (t.kind === "expense" && inRange(t.bookedOn, from, to)) sum -= t.amountPlnMinor;
  return sum;
}

export function monthSummary(input: {
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
  period: Period;
  today: LocalDate;
  startDay?: number;
}): MonthSummary {
  const { transactions, categories, budgets, period, today, startDay = 1 } = input;
  const byCategory = new Map<string | null, Minor>();
  let spent = 0;
  let income = 0;
  let uncategorized = 0;

  for (const t of transactions) {
    if (!inRange(t.bookedOn, period.from, period.to)) continue;
    if (t.kind === "income") income += t.amountPlnMinor;
    if (t.kind === "expense") {
      spent -= t.amountPlnMinor;
      byCategory.set(t.categoryId, (byCategory.get(t.categoryId) ?? 0) - t.amountPlnMinor);
    }
    if (t.kind !== "transfer" && t.categoryId === null) uncategorized++;
  }

  const lines: CategoryLine[] = [];
  let totalLimit: Minor | null = null;
  for (const c of categories) {
    if (c.kind !== "expense") continue;
    const limit = limitFor(budgets, c.id, period);
    const catSpent = byCategory.get(c.id) ?? 0;
    if (limit !== null) totalLimit = (totalLimit ?? 0) + limit;
    if (catSpent > 0 || (limit !== null && c.archivedAt === null)) {
      lines.push({ category: c, spentMinor: catSpent, limitMinor: limit, state: limitState(catSpent, limit) });
    }
  }
  // Wydatki z kategorii usuniętej lub nieznanej trafiają do „bez kategorii”
  const known = new Set(categories.map((c) => c.id));
  let orphan = 0;
  for (const [id, sum] of byCategory) if (id === null || !known.has(id)) orphan += sum;
  if (orphan > 0) lines.push({ category: null, spentMinor: orphan, limitMinor: null, state: "none" });

  lines.sort((a, b) => b.spentMinor - a.spentMinor || (a.category?.sortOrder ?? 999) - (b.category?.sortOrder ?? 999));

  const prev = previousPeriod(period, startDay);
  const hasPrev = transactions.some((t) => inRange(t.bookedOn, prev.from, prev.to));
  const cutoff = today >= period.to ? prev.to : sameDayInPrevious(period, today, startDay);

  return {
    period,
    spentMinor: spent,
    incomeMinor: income,
    totalLimitMinor: totalLimit,
    remainingMinor: totalLimit === null ? null : totalLimit - spent,
    daysLeft: daysLeft(period, today),
    lines,
    previousToDateMinor: hasPrev ? spentBetween(transactions, prev.from, cutoff) : null,
    uncategorizedCount: uncategorized,
  };
}
