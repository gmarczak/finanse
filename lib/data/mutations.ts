import type { Supabase } from "@/lib/db/client";
import type { AccountRow, ImportRow, TransactionRow } from "@/lib/db/database.types";
import type { ImportPlan } from "@/lib/import/plan";
import type { LocalDate } from "@/lib/domain/dates";
import type { Account, AccountKind, Transaction } from "@/lib/domain/model";
import type { Minor } from "@/lib/domain/money";
import type { Snapshot } from "./snapshot";
import { toAccount, toTransaction } from "./snapshot";

export function newId(): string {
  return crypto.randomUUID();
}

// ============ TRANSAKCJE ============

/** Nowy wydatek/przychód albo przelew. `id` nadaje klient, więc ponowienie offline nie dubluje. */
export type TxDraft =
  | {
      type: "expense" | "income";
      id: string;
      accountId: string;
      bookedOn: LocalDate;
      amountMinor: Minor; // dodatnie; znak wynika z typu
      categoryId: string | null;
      description: string | null;
      note: string | null;
    }
  | {
      type: "transfer";
      id: string;
      fromAccountId: string;
      toAccountId: string;
      bookedOn: LocalDate;
      amountMinor: Minor; // dodatnie
      description: string | null;
    };

export async function saveDraft(supabase: Supabase, draft: TxDraft): Promise<void> {
  if (draft.type === "transfer") {
    const { error } = await supabase.rpc("add_transfer", {
      p_id: draft.id,
      p_from_account_id: draft.fromAccountId,
      p_to_account_id: draft.toAccountId,
      p_booked_on: draft.bookedOn,
      p_amount_minor: draft.amountMinor,
      p_description: draft.description,
    });
    if (error) throw error;
    return;
  }
  const { error } = await supabase.rpc("add_transaction", {
    p_id: draft.id,
    p_account_id: draft.accountId,
    p_booked_on: draft.bookedOn,
    p_kind: draft.type,
    p_amount_minor: draft.type === "expense" ? -draft.amountMinor : draft.amountMinor,
    p_category_id: draft.categoryId,
    p_description: draft.description,
    p_note: draft.note,
  });
  if (error) throw error;
}

/** Wiersze, które szkic doda do cache przed potwierdzeniem serwera. */
export function draftToTransactions(draft: TxDraft): Transaction[] {
  const base = {
    bookedOn: draft.bookedOn,
    currency: "PLN",
    bankDescription: null,
    source: "manual" as const,
    fingerprint: null,
    createdAt: new Date().toISOString(), // eslint-disable-line no-restricted-syntax -- znacznik czasu, nie data dnia
  };
  if (draft.type === "transfer") {
    return [
      { ...base, id: draft.id, accountId: draft.fromAccountId, kind: "transfer", amountMinor: -draft.amountMinor, amountPlnMinor: -draft.amountMinor, categoryId: null, description: draft.description, note: null, transferId: draft.id },
      { ...base, id: `${draft.id}-in`, accountId: draft.toAccountId, kind: "transfer", amountMinor: draft.amountMinor, amountPlnMinor: draft.amountMinor, categoryId: null, description: draft.description, note: null, transferId: draft.id },
    ];
  }
  const signed = draft.type === "expense" ? -draft.amountMinor : draft.amountMinor;
  return [
    { ...base, id: draft.id, accountId: draft.accountId, kind: draft.type, amountMinor: signed, amountPlnMinor: signed, categoryId: draft.categoryId, description: draft.description, note: draft.note, transferId: null },
  ];
}

export function withDraft(snapshot: Snapshot, draft: TxDraft): Snapshot {
  const added = draftToTransactions(draft);
  const ids = new Set(added.map((t) => t.id));
  return { ...snapshot, transactions: [...added, ...snapshot.transactions.filter((t) => !ids.has(t.id))] };
}

export type TxPatch = {
  id: string;
  categoryId?: string | null;
  description?: string | null;
  note?: string | null;
  bookedOn?: LocalDate;
  /** Nowa kwota ze znakiem (tylko PLN, nie dla przelewów) */
  amountMinor?: Minor;
};

export async function updateTransaction(supabase: Supabase, patch: TxPatch): Promise<Transaction> {
  const row: Partial<TransactionRow> = {};
  if (patch.categoryId !== undefined) row.category_id = patch.categoryId;
  if (patch.description !== undefined) row.description = patch.description?.trim() || null;
  if (patch.note !== undefined) row.note = patch.note?.trim() || null;
  if (patch.bookedOn !== undefined) row.booked_on = patch.bookedOn;
  if (patch.amountMinor !== undefined) {
    row.amount_minor = patch.amountMinor;
    row.amount_pln_minor = patch.amountMinor;
  }
  const { data, error } = await supabase.from("transactions").update(row).eq("id", patch.id).select("*").single();
  if (error) throw error;
  return toTransaction(data as TransactionRow);
}

export function withPatch(snapshot: Snapshot, patch: TxPatch): Snapshot {
  return {
    ...snapshot,
    transactions: snapshot.transactions.map((t) =>
      t.id !== patch.id
        ? t
        : {
            ...t,
            ...(patch.categoryId !== undefined && { categoryId: patch.categoryId }),
            ...(patch.description !== undefined && { description: patch.description?.trim() || null }),
            ...(patch.note !== undefined && { note: patch.note?.trim() || null }),
            ...(patch.bookedOn !== undefined && { bookedOn: patch.bookedOn }),
            ...(patch.amountMinor !== undefined && { amountMinor: patch.amountMinor, amountPlnMinor: patch.amountMinor }),
          },
    ),
  };
}

export async function deleteTransaction(supabase: Supabase, id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_transaction", { p_id: id });
  if (error) throw error;
}

export function withoutTransaction(snapshot: Snapshot, id: string): Snapshot {
  const target = snapshot.transactions.find((t) => t.id === id);
  return {
    ...snapshot,
    transactions: snapshot.transactions.filter((t) => t.id !== id && !(target?.transferId && t.transferId === target.transferId)),
  };
}

// ============ KONTA ============

export type AccountForm = {
  name: string;
  kind: AccountKind;
  institution: string | null;
  /** Obecne saldo w groszach; null = nie śledzę salda */
  balanceMinor: Minor | null;
  balanceOn: LocalDate;
};

export async function addAccounts(supabase: Supabase, forms: AccountForm[], startOrder: number): Promise<Account[]> {
  const { data, error } = await supabase
    .from("accounts")
    .insert(
      forms.map((f, i) => ({
        name: f.name.trim(),
        kind: f.kind,
        institution: f.institution,
        anchor_balance_minor: f.balanceMinor,
        anchor_on: f.balanceMinor === null ? null : f.balanceOn,
        sort_order: startOrder + i,
      })),
    )
    .select("*");
  if (error) throw error;
  return (data as AccountRow[]).map(toAccount);
}

export async function updateAccount(supabase: Supabase, input: { id: string } & Partial<AccountForm> & { archived?: boolean }): Promise<void> {
  const row: Partial<AccountRow> = {};
  if (input.name !== undefined) row.name = input.name.trim();
  if (input.balanceMinor !== undefined) {
    row.anchor_balance_minor = input.balanceMinor;
    row.anchor_on = input.balanceMinor === null ? null : (input.balanceOn ?? null);
  }
  if (input.archived !== undefined) row.archived_at = input.archived ? new Date().toISOString() : null; // eslint-disable-line no-restricted-syntax -- znacznik czasu
  const { error } = await supabase.from("accounts").update(row).eq("id", input.id);
  if (error) throw error;
}

// ============ LIMITY I USTAWIENIA ============

export async function setBudget(supabase: Supabase, input: { categoryId: string; month: LocalDate; amountMinor: Minor }): Promise<void> {
  const { error } = await supabase.rpc("set_budget", { p_category_id: input.categoryId, p_month: input.month, p_amount_minor: input.amountMinor });
  if (error) throw error;
}

export async function saveSettings(supabase: Supabase, input: { monthStartDay?: number; timezone?: string }): Promise<void> {
  const row: { month_start_day?: number; timezone?: string } = {};
  if (input.monthStartDay !== undefined) row.month_start_day = input.monthStartDay;
  if (input.timezone !== undefined) row.timezone = input.timezone;
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("settings").update(row).eq("user_id", auth.user?.id ?? "");
  if (error) throw error;
}

/** Komunikat dla człowieka z błędu Supabase/RPC. */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : String(error);
  if (/future_date/.test(message)) return "Nie można zapisać transakcji z przyszłą datą.";
  if (/same_account/.test(message)) return "Przelew musi iść między dwoma różnymi kontami.";
  if (/accounts_user_id_name_key|duplicate key.*name/.test(message)) return "Masz już konto o tej nazwie.";
  if (/Failed to fetch|NetworkError|network/i.test(message)) return "Brak połączenia. Spróbuj, gdy wróci internet.";
  return message;
}

// ============ IMPORT I REGUŁY KATEGORII ============

export type ImportPayload = {
  accountId: string;
  format: string;
  fileName: string;
  rowCount: number;
  plan: ImportPlan;
};

export async function runImport(supabase: Supabase, p: ImportPayload): Promise<ImportRow> {
  const rows = [
    ...p.plan.rows.map((r) => ({
      id: r.id,
      account_id: r.accountId,
      booked_on: r.bookedOn,
      kind: r.kind,
      amount_minor: r.amountMinor,
      category_id: r.categoryId,
      description: r.description,
      bank_description: r.bankDescription,
      fingerprint: r.fingerprint,
      transfer_id: null,
      replace: r.replace,
    })),
    ...p.plan.transfers.flatMap((t) =>
      t.legs.map((l) => ({
        id: l.id,
        account_id: l.accountId,
        booked_on: t.bookedOn,
        kind: "transfer",
        amount_minor: l.amountMinor,
        category_id: null,
        description: t.description,
        bank_description: l.bankDescription,
        fingerprint: l.fingerprint,
        transfer_id: t.transferId,
      })),
    ),
  ];
  const merges = p.plan.merges.map((m) => ({ id: m.manual.id, fingerprint: m.row.fingerprint, bank_description: m.row.description, booked_on: m.row.bookedOn }));
  const { data, error } = await supabase.rpc("import_batch", {
    p_account_id: p.accountId,
    p_format: p.format,
    p_file_name: p.fileName,
    p_row_count: p.rowCount,
    p_rows: rows,
    p_merges: merges,
  });
  if (error) throw error;
  return data as ImportRow;
}

/**
 * Przypisanie kategorii; z „zapamiętaj” także reguła na przyszłe importy
 * i ta sama kategoria dla pozostałych nieskategoryzowanych z tym samym sklepem.
 */
export async function assignCategory(supabase: Supabase, input: { ids: string[]; categoryId: string; pattern: string | null }): Promise<void> {
  const { error } = await supabase.from("transactions").update({ category_id: input.categoryId }).in("id", input.ids);
  if (error) throw error;
  if (input.pattern && input.pattern.length >= 2) {
    const { error: ruleError } = await supabase
      .from("category_rules")
      .upsert({ pattern: input.pattern, category_id: input.categoryId }, { onConflict: "user_id,pattern" });
    if (ruleError) throw ruleError;
  }
}

export function withAssigned(snapshot: Snapshot, input: { ids: string[]; categoryId: string; pattern: string | null }): Snapshot {
  const ids = new Set(input.ids);
  return {
    ...snapshot,
    transactions: snapshot.transactions.map((t) => (ids.has(t.id) ? { ...t, categoryId: input.categoryId } : t)),
    rules: input.pattern ? [...snapshot.rules.filter((r) => r.pattern !== input.pattern), { pattern: input.pattern, categoryId: input.categoryId }] : snapshot.rules,
  };
}
