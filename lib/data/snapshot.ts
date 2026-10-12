import type { Supabase } from "@/lib/db/client";
import type { AccountRow, BudgetRow, CategoryRow, TransactionRow } from "@/lib/db/database.types";
import { COLORS, type Account, type Budget, type Category, type Color, type Settings, type Transaction } from "@/lib/domain/model";

/**
 * Wszystko, czego potrzebują ekrany, w jednym obiekcie trzymanym w cache (IndexedDB).
 * Kilka lat transakcji to kilka–kilkanaście tysięcy wierszy: mieści się w kliencie,
 * a sumy i limity liczy lib/domain.
 */
export type Snapshot = {
  userId: string;
  email: string | null;
  settings: Settings;
  accounts: Account[];
  categories: Category[];
  budgets: Budget[];
  transactions: Transaction[];
};

function toColor(value: string): Color {
  return (COLORS as readonly string[]).includes(value) ? (value as Color) : "slate";
}

export function toAccount(r: AccountRow): Account {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    institution: r.institution,
    currency: r.currency,
    anchorBalanceMinor: r.anchor_balance_minor === null ? null : Number(r.anchor_balance_minor),
    anchorOn: r.anchor_on,
    sortOrder: r.sort_order,
    archivedAt: r.archived_at,
  };
}

export function toCategory(r: CategoryRow): Category {
  return { id: r.id, kind: r.kind, name: r.name, icon: r.icon, color: toColor(r.color), sortOrder: r.sort_order, archivedAt: r.archived_at };
}

export function toBudget(r: BudgetRow): Budget {
  return { categoryId: r.category_id, validFrom: r.valid_from, amountMinor: Number(r.amount_minor) };
}

export function toTransaction(r: TransactionRow): Transaction {
  return {
    id: r.id,
    accountId: r.account_id,
    bookedOn: r.booked_on,
    kind: r.kind,
    amountMinor: Number(r.amount_minor),
    currency: r.currency,
    amountPlnMinor: Number(r.amount_pln_minor),
    categoryId: r.category_id,
    description: r.description,
    bankDescription: r.bank_description,
    note: r.note,
    source: r.source,
    transferId: r.transfer_id,
    createdAt: r.created_at,
  };
}

const PAGE = 1000;

/** PostgREST zwraca maks. 1000 wierszy na zapytanie, więc transakcje pobieramy stronami. */
async function allTransactions(supabase: Supabase): Promise<TransactionRow[]> {
  const out: TransactionRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .order("booked_on", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data as TransactionRow[]));
    if (data.length < PAGE) return out;
  }
}

export async function fetchSnapshot(supabase: Supabase): Promise<Snapshot> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw authError ?? new Error("Brak sesji");

  let { data: settings, error: settingsError } = await supabase.from("settings").select("*").maybeSingle();
  if (settingsError) throw settingsError;
  if (!settings) {
    // Pierwsze wejście: ustawienia i kategorie startowe (bezpieczne do powtórzenia)
    const { error } = await supabase.rpc("bootstrap");
    if (error) throw error;
    ({ data: settings, error: settingsError } = await supabase.from("settings").select("*").maybeSingle());
    if (settingsError || !settings) throw settingsError ?? new Error("Nie udało się przygotować konta");
  }

  const [accounts, categories, budgets, transactions] = await Promise.all([
    supabase.from("accounts").select("*").order("sort_order").order("created_at"),
    supabase.from("categories").select("*").order("kind").order("sort_order").order("name"),
    supabase.from("budgets").select("*"),
    allTransactions(supabase),
  ]);
  for (const r of [accounts, categories, budgets]) if (r.error) throw r.error;

  return {
    userId: auth.user.id,
    email: auth.user.email ?? null,
    settings: { timezone: settings.timezone, monthStartDay: settings.month_start_day },
    accounts: (accounts.data as AccountRow[]).map(toAccount),
    categories: (categories.data as CategoryRow[]).map(toCategory),
    budgets: (budgets.data as BudgetRow[]).map(toBudget),
    transactions: transactions.map(toTransaction),
  };
}
