// Typy schematu `finance` (projekt habit-tracker). Odpowiadają migracjom w supabase/migrations.
// Docelowo generowane: `npm run db:types` (wymaga Supabase CLI i schematu udostępnionego w API).
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Enums = {
  account_kind: "bank" | "savings" | "broker" | "cash";
  billing_cycle: "weekly" | "monthly" | "yearly";
  category_kind: "expense" | "income";
  tx_kind: "expense" | "income" | "transfer";
  tx_source: "manual" | "import";
};

type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>;
  Relationships: [];
};

export type SettingsRow = {
  user_id: string;
  timezone: string;
  month_start_day: number;
  base_currency: string;
  created_at: string;
  updated_at: string;
};

export type AccountRow = {
  id: string;
  user_id: string;
  name: string;
  kind: Enums["account_kind"];
  institution: string | null;
  currency: string;
  anchor_balance_minor: number | null;
  anchor_on: string | null;
  sort_order: number;
  archived_at: string | null;
  created_at: string;
};

export type CategoryRow = {
  id: string;
  user_id: string;
  kind: Enums["category_kind"];
  name: string;
  icon: string | null;
  color: string;
  sort_order: number;
  archived_at: string | null;
  created_at: string;
};

export type TransactionRow = {
  id: string;
  user_id: string;
  account_id: string;
  booked_on: string;
  kind: Enums["tx_kind"];
  amount_minor: number;
  currency: string;
  amount_pln_minor: number;
  fx_rate: number | null;
  category_id: string | null;
  category_kind: Enums["category_kind"];
  description: string | null;
  bank_description: string | null;
  note: string | null;
  source: Enums["tx_source"];
  import_id: string | null;
  fingerprint: string | null;
  transfer_id: string | null;
  created_at: string;
  updated_at: string;
};

export type BudgetRow = {
  id: string;
  user_id: string;
  category_id: string;
  valid_from: string;
  amount_minor: number;
  created_at: string;
};

export type SubscriptionRow = {
  id: string;
  user_id: string;
  name: string;
  amount_minor: number;
  currency: string;
  cycle: Enums["billing_cycle"];
  next_charge_on: string;
  account_id: string | null;
  category_id: string | null;
  remind_days_before: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type GoalRow = {
  id: string;
  user_id: string;
  name: string;
  target_minor: number;
  target_date: string | null;
  archived_at: string | null;
  created_at: string;
};

export type GoalContributionRow = {
  id: string;
  user_id: string;
  goal_id: string;
  contributed_on: string;
  amount_minor: number;
  note: string | null;
  created_at: string;
};

export type InvestmentSnapshotRow = {
  id: string;
  user_id: string;
  account_id: string;
  as_of: string;
  value_minor: number;
  created_at: string;
};

export type ImportRow = {
  id: string;
  user_id: string;
  account_id: string;
  format: string;
  file_name: string | null;
  row_count: number;
  inserted_count: number;
  duplicate_count: number;
  created_at: string;
};

export type CategoryRuleRow = { id: string; user_id: string; pattern: string; category_id: string; created_at: string };
export type ImportTemplateRow = { id: string; user_id: string; name: string; config: Json; created_at: string };
export type FxRateRow = { rate_date: string; currency: string; rate: number };

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.18" };
  finance: {
    Tables: {
      settings: Table<SettingsRow, never>;
      accounts: Table<AccountRow, "name">;
      categories: Table<CategoryRow, "name">;
      transactions: Table<TransactionRow, "account_id" | "booked_on" | "kind" | "amount_minor" | "amount_pln_minor">;
      budgets: Table<BudgetRow, "category_id" | "valid_from" | "amount_minor">;
      subscriptions: Table<SubscriptionRow, "name" | "amount_minor" | "next_charge_on">;
      goals: Table<GoalRow, "name" | "target_minor">;
      goal_contributions: Table<GoalContributionRow, "goal_id" | "contributed_on" | "amount_minor">;
      investment_snapshots: Table<InvestmentSnapshotRow, "account_id" | "as_of" | "value_minor">;
      imports: Table<ImportRow, "account_id" | "format">;
      category_rules: Table<CategoryRuleRow, "pattern" | "category_id">;
      import_templates: Table<ImportTemplateRow, "name" | "config">;
      fx_rates: Table<FxRateRow, "rate_date" | "currency" | "rate">;
    };
    Views: { [_ in never]: never };
    Functions: {
      today: { Args: never; Returns: string };
      bootstrap: { Args: never; Returns: undefined };
      add_transaction: {
        Args: {
          p_id: string;
          p_account_id: string;
          p_booked_on: string;
          p_kind: Enums["tx_kind"];
          p_amount_minor: number;
          p_category_id?: string | null;
          p_description?: string | null;
          p_note?: string | null;
          p_currency?: string;
          p_amount_pln_minor?: number | null;
          p_fx_rate?: number | null;
        };
        Returns: TransactionRow;
      };
      add_transfer: {
        Args: {
          p_id: string;
          p_from_account_id: string;
          p_to_account_id: string;
          p_booked_on: string;
          p_amount_minor: number;
          p_description?: string | null;
          p_currency?: string;
          p_amount_pln_minor?: number | null;
          p_fx_rate?: number | null;
        };
        Returns: string;
      };
      delete_transaction: { Args: { p_id: string }; Returns: undefined };
      set_budget: { Args: { p_category_id: string; p_month: string; p_amount_minor: number }; Returns: undefined };
      can_access: { Args: { p_user_id: string }; Returns: boolean };
      import_batch: {
        Args: { p_account_id: string; p_format: string; p_file_name: string; p_row_count: number; p_rows: Json; p_merges?: Json };
        Returns: ImportRow;
      };
    };
    Enums: Enums;
    CompositeTypes: { [_ in never]: never };
  };
};
