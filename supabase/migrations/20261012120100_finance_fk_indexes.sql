-- Indeksy pokrywające złożone klucze obce (zalecenie doradcy wydajności Supabase).
-- Kasowanie konta lub kategorii nie skanuje wtedy całych tabel.
-- Tylko dodawanie: starsze jednokolumnowe indeksy zostają (na małych tabelach koszt jest pomijalny).

create index budgets_category_fk_idx              on finance.budgets (category_id, user_id);
create index budgets_user_idx                     on finance.budgets (user_id);
create index category_rules_category_fk_idx       on finance.category_rules (category_id, user_id);
create index goal_contributions_goal_fk_idx       on finance.goal_contributions (goal_id, user_id);
create index goal_contributions_user_idx          on finance.goal_contributions (user_id);
create index goals_user_idx                       on finance.goals (user_id);
create index imports_account_fk_idx               on finance.imports (account_id, user_id);
create index imports_user_idx                     on finance.imports (user_id);
create index investment_snapshots_account_fk_idx  on finance.investment_snapshots (account_id, user_id);
create index investment_snapshots_user_idx        on finance.investment_snapshots (user_id);
create index subscriptions_account_fk_idx         on finance.subscriptions (account_id, user_id);
create index subscriptions_category_fk_idx        on finance.subscriptions (category_id, user_id);
create index transactions_account_fk_idx          on finance.transactions (account_id, user_id, booked_on);
create index transactions_category_fk_idx         on finance.transactions (category_id, user_id, category_kind);
create index transactions_import_fk_idx           on finance.transactions (import_id, user_id);
