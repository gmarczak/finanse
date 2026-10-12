-- Finanse: schemat bazowy w osobnym schemacie `finance` (ta sama baza i to samo konto co Nawyki).
-- Zasady: kwoty w groszach (bigint, ze znakiem: wydatek < 0, przychód > 0), data = dzień lokalny,
-- zapis przez RPC tam, gdzie trzeba pilnować niezmienników, RLS na każdej tabeli.

create schema if not exists finance;

-- ============ TYPY ============
create type finance.account_kind  as enum ('bank', 'broker', 'cash');
create type finance.category_kind as enum ('expense', 'income');
create type finance.tx_kind       as enum ('expense', 'income', 'transfer');
create type finance.tx_source     as enum ('manual', 'import');
create type finance.billing_cycle as enum ('weekly', 'monthly', 'yearly');

-- ============ TABELE ============
create table finance.settings (
  user_id          uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  timezone         text not null default 'Europe/Warsaw',
  month_start_day  smallint not null default 1 check (month_start_day between 1 and 28),
  base_currency    char(3) not null default 'PLN' check (base_currency ~ '^[A-Z]{3}$'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table finance.accounts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name                  text not null check (char_length(btrim(name)) between 1 and 40),
  kind                  finance.account_kind not null default 'bank',
  institution           text check (institution ~ '^[a-z0-9-]{1,32}$'),   -- np. revolut, pekao, xtb
  currency              char(3) not null default 'PLN' check (currency ~ '^[A-Z]{3}$'),
  -- Saldo znane w danym dniu (np. wpisane przy dodaniu konta); reszta liczona z transakcji w obie strony.
  anchor_balance_minor  bigint,
  anchor_on             date,
  sort_order            integer not null default 0,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, name),
  check ((anchor_balance_minor is null) = (anchor_on is null))
);

create table finance.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        finance.category_kind not null default 'expense',
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  icon        text check (icon ~ '^[a-z0-9-]{1,32}$'),
  color       text not null default 'slate' check (color in ('green', 'blue', 'violet', 'amber', 'rose', 'teal', 'slate')),
  sort_order  integer not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (id, user_id),
  unique (id, user_id, kind),
  unique (user_id, kind, name)
);

create table finance.imports (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id       uuid not null,
  format           text not null check (char_length(format) between 1 and 64),  -- revolut | pekao | xtb | template:<id>
  file_name        text check (char_length(file_name) <= 200),
  row_count        integer not null default 0 check (row_count >= 0),
  inserted_count   integer not null default 0 check (inserted_count >= 0),
  duplicate_count  integer not null default 0 check (duplicate_count >= 0),
  created_at       timestamptz not null default now(),
  unique (id, user_id),
  foreign key (account_id, user_id) references finance.accounts (id, user_id) on delete cascade
);

create table finance.transactions (
  id                uuid primary key default gen_random_uuid(),   -- nadawane przez klienta: ponowienie offline nie dubluje
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id        uuid not null,
  booked_on         date not null,                                -- dzień lokalny, nigdy timestamp
  kind              finance.tx_kind not null,
  amount_minor      bigint not null check (amount_minor <> 0),    -- w walucie transakcji, ze znakiem
  currency          char(3) not null default 'PLN' check (currency ~ '^[A-Z]{3}$'),
  amount_pln_minor  bigint not null,                              -- przeliczone na walutę bazową, ten sam znak
  fx_rate           numeric(14, 6) check (fx_rate > 0),           -- kurs NBP z dnia; null dla PLN
  category_id       uuid,
  category_kind     finance.category_kind not null default 'expense',   -- ustawiane triggerem z `kind`; pilnuje zgodności kategorii
  description       text check (char_length(description) <= 200),   -- czytelny opis (np. „Biedronka”)
  bank_description  text check (char_length(bank_description) <= 500), -- surowy opis z wyciągu
  note              text check (char_length(note) <= 1000),
  source            finance.tx_source not null default 'manual',
  import_id         uuid,
  fingerprint       text check (char_length(fingerprint) between 8 and 128), -- odcisk wiersza z wyciągu
  transfer_id       uuid,                                         -- wspólny dla obu nóg przelewu między kontami
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (account_id, user_id) references finance.accounts (id, user_id) on delete cascade,
  foreign key (category_id, user_id, category_kind) references finance.categories (id, user_id, kind) on delete set null (category_id),
  foreign key (import_id, user_id) references finance.imports (id, user_id) on delete set null (import_id),
  unique (account_id, fingerprint),
  check (kind <> 'expense'  or amount_minor < 0),
  check (kind <> 'income'   or amount_minor > 0),
  check (kind <> 'transfer' or (transfer_id is not null and category_id is null)),
  check (kind = 'transfer'  or transfer_id is null),
  check (category_kind = case when kind = 'income' then 'income'::finance.category_kind else 'expense'::finance.category_kind end),
  check (sign(amount_pln_minor) = sign(amount_minor)),
  check ((currency = 'PLN' and fx_rate is null and amount_pln_minor = amount_minor) or (currency <> 'PLN' and fx_rate is not null)),
  check ((source = 'import') = (fingerprint is not null))
);

-- Reguły kategorii przy imporcie: fragment opisu (małe litery) → kategoria
create table finance.category_rules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pattern      text not null check (pattern = lower(btrim(pattern)) and char_length(pattern) between 2 and 80),
  category_id  uuid not null,
  created_at   timestamptz not null default now(),
  foreign key (category_id, user_id) references finance.categories (id, user_id) on delete cascade,
  unique (user_id, pattern)
);

-- Limit miesięczny kategorii, wersjonowany: obowiązuje od miesiąca valid_from (pierwszy dzień), 0 = bez limitu
create table finance.budgets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id   uuid not null,
  valid_from    date not null check (extract(day from valid_from) = 1),
  amount_minor  bigint not null check (amount_minor >= 0),
  created_at    timestamptz not null default now(),
  foreign key (category_id, user_id) references finance.categories (id, user_id) on delete cascade,
  unique (category_id, valid_from)
);

create table finance.subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name                text not null check (char_length(btrim(name)) between 1 and 60),
  amount_minor        bigint not null check (amount_minor > 0),
  currency            char(3) not null default 'PLN' check (currency ~ '^[A-Z]{3}$'),
  cycle               finance.billing_cycle not null default 'monthly',
  next_charge_on      date not null,
  account_id          uuid,
  category_id         uuid,
  remind_days_before  smallint not null default 1 check (remind_days_before between 0 and 14),
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (account_id, user_id)  references finance.accounts (id, user_id)   on delete set null (account_id),
  foreign key (category_id, user_id) references finance.categories (id, user_id) on delete set null (category_id)
);

create table finance.goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  target_minor  bigint not null check (target_minor > 0),
  target_date   date,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (id, user_id)
);

-- Wpłata (> 0) albo wypłata (< 0) na cel
create table finance.goal_contributions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id         uuid not null,
  contributed_on  date not null,
  amount_minor    bigint not null check (amount_minor <> 0),
  note            text check (char_length(note) <= 200),
  created_at      timestamptz not null default now(),
  foreign key (goal_id, user_id) references finance.goals (id, user_id) on delete cascade
);

-- Wartość portfela (np. XTB) w czasie
create table finance.investment_snapshots (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id   uuid not null,
  as_of        date not null,
  value_minor  bigint not null check (value_minor >= 0),
  created_at   timestamptz not null default now(),
  foreign key (account_id, user_id) references finance.accounts (id, user_id) on delete cascade,
  unique (account_id, as_of)
);

-- Szablon kolumn dla banku bez gotowego parsera (uniwersalny import)
create table finance.import_templates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  config      jsonb not null check (jsonb_typeof(config) = 'object'),
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

-- Kursy średnie NBP (tabela A). Wspólne dla wszystkich; zapis tylko service role.
create table finance.fx_rates (
  rate_date  date not null,
  currency   char(3) not null check (currency ~ '^[A-Z]{3}$'),
  rate       numeric(14, 6) not null check (rate > 0),
  primary key (currency, rate_date)
);

-- ============ INDEKSY ============
create index transactions_user_date_idx     on finance.transactions (user_id, booked_on desc);
create index transactions_account_date_idx  on finance.transactions (account_id, booked_on);
create index transactions_category_idx      on finance.transactions (category_id);
create index transactions_import_idx        on finance.transactions (import_id);
create index transactions_transfer_idx      on finance.transactions (transfer_id) where transfer_id is not null;
create index transactions_uncategorized_idx on finance.transactions (user_id) where category_id is null and kind <> 'transfer';
create index imports_account_idx            on finance.imports (account_id);
create index category_rules_category_idx    on finance.category_rules (category_id);
create index budgets_category_idx           on finance.budgets (category_id);
create index subscriptions_user_next_idx    on finance.subscriptions (user_id, next_charge_on) where active;
create index subscriptions_account_idx      on finance.subscriptions (account_id);
create index subscriptions_category_idx     on finance.subscriptions (category_id);
create index goal_contributions_goal_idx    on finance.goal_contributions (goal_id);
create index investment_snapshots_acc_idx   on finance.investment_snapshots (account_id, as_of desc);

-- ============ TRIGGERY ============
create function finance.set_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

-- Rodzaj kategorii wynika z rodzaju transakcji (wydatek/przelew → kategoria wydatków, przychód → przychodów)
create function finance.derive_category_kind() returns trigger language plpgsql set search_path = '' as $$
begin
  new.category_kind = case when new.kind = 'income' then 'income'::finance.category_kind else 'expense'::finance.category_kind end;
  return new;
end $$;

create trigger transactions_category_kind before insert or update of kind on finance.transactions
  for each row execute function finance.derive_category_kind();
create trigger settings_updated_at     before update on finance.settings      for each row execute function finance.set_updated_at();
create trigger transactions_updated_at  before update on finance.transactions  for each row execute function finance.set_updated_at();
create trigger subscriptions_updated_at before update on finance.subscriptions for each row execute function finance.set_updated_at();

-- ============ RLS ============
alter table finance.settings             enable row level security;
alter table finance.accounts             enable row level security;
alter table finance.categories           enable row level security;
alter table finance.imports              enable row level security;
alter table finance.transactions         enable row level security;
alter table finance.category_rules       enable row level security;
alter table finance.budgets              enable row level security;
alter table finance.subscriptions        enable row level security;
alter table finance.goals                enable row level security;
alter table finance.goal_contributions   enable row level security;
alter table finance.investment_snapshots enable row level security;
alter table finance.import_templates     enable row level security;
alter table finance.fx_rates             enable row level security;

-- Jedno miejsce decyzji o dostępie: dziś „moje wiersze”, w przyszłości także grupy wspólnych wydatków.
create function finance.can_access(p_user_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select p_user_id = (select auth.uid())
$$;

create policy own_rows on finance.settings             for all to authenticated using (finance.can_access(user_id)) with check (finance.can_access(user_id));
create policy own_rows on finance.accounts             for all to authenticated using (finance.can_access(user_id)) with check (finance.can_access(user_id));
create policy own_rows on finance.categories           for all to authenticated using (finance.can_access(user_id)) with check (finance.can_access(user_id));
create policy own_rows on finance.imports              for all to authenticated using (finance.can_access(user_id)) with check (finance.can_access(user_id));
create policy own_rows on finance.transactions         for all to authenticated using (finance.can_access(user_id)) with check (finance.can_access(user_id));
create policy own_rows on finance.category_rules       for all to authenticated using (finance.can_access(user_id)) with check (finance.can_access(user_id));
create policy own_rows on finance.budgets              for all to authenticated using (finance.can_access(user_id)) with check (finance.can_access(user_id));
create policy own_rows on finance.subscriptions        for all to authenticated using (finance.can_access(user_id)) with check (finance.can_access(user_id));
create policy own_rows on finance.goals                for all to authenticated using (finance.can_access(user_id)) with check (finance.can_access(user_id));
create policy own_rows on finance.goal_contributions   for all to authenticated using (finance.can_access(user_id)) with check (finance.can_access(user_id));
create policy own_rows on finance.investment_snapshots for all to authenticated using (finance.can_access(user_id)) with check (finance.can_access(user_id));
create policy own_rows on finance.import_templates     for all to authenticated using (finance.can_access(user_id)) with check (finance.can_access(user_id));
create policy read_rates on finance.fx_rates for select to authenticated using (true);

-- ============ FUNKCJE (RPC) ============
-- Dzisiejsza data lokalna użytkownika według ustawień Finansów (domyślnie Europe/Warsaw)
create function finance.today() returns date
language sql stable security invoker set search_path = '' as $$
  select (now() at time zone coalesce(
    (select s.timezone from finance.settings s where s.user_id = (select auth.uid())),
    'Europe/Warsaw'))::date
$$;

-- Pierwsze uruchomienie: ustawienia + kategorie startowe. Bezpieczne do wywołania wiele razy.
create function finance.bootstrap() returns void
language plpgsql security invoker set search_path = '' as $$
begin
  insert into finance.settings (user_id) values ((select auth.uid())) on conflict (user_id) do nothing;
  if not exists (select 1 from finance.categories c where c.user_id = (select auth.uid())) then
    insert into finance.categories (kind, name, icon, color, sort_order) values
      ('expense', 'Jedzenie',            'shopping-cart', 'green',  0),
      ('expense', 'Jedzenie na mieście', 'utensils',      'amber',  1),
      ('expense', 'Transport',           'bus',           'blue',   2),
      ('expense', 'Mieszkanie',          'house',         'teal',   3),
      ('expense', 'Subskrypcje',         'repeat',        'violet', 4),
      ('expense', 'Zdrowie',             'heart',         'rose',   5),
      ('expense', 'Sport',               'dumbbell',      'blue',   6),
      ('expense', 'Rozrywka',            'ticket',        'rose',   7),
      ('expense', 'Ubrania',             'shirt',         'slate',  8),
      ('expense', 'Inne',                'ellipsis',      'slate',  9),
      ('income',  'Wynagrodzenie',       'banknote',      'green',  0),
      ('income',  'Inne przychody',      'plus',          'slate',  1);
  end if;
end $$;

-- Wydatek lub przychód wpisany ręcznie. p_id nadaje klient: powtórka (offline) zwraca ten sam wiersz.
create function finance.add_transaction(
  p_id uuid, p_account_id uuid, p_booked_on date, p_kind finance.tx_kind, p_amount_minor bigint,
  p_category_id uuid default null, p_description text default null, p_note text default null,
  p_currency char(3) default 'PLN', p_amount_pln_minor bigint default null, p_fx_rate numeric default null
) returns finance.transactions
language plpgsql security invoker set search_path = '' as $$
declare
  v_row finance.transactions;
begin
  if p_kind = 'transfer' then
    raise exception 'use_add_transfer' using errcode = '22023';
  end if;
  if p_booked_on > finance.today() then
    raise exception 'future_date' using errcode = '22023';
  end if;
  insert into finance.transactions (id, account_id, booked_on, kind, amount_minor, currency, amount_pln_minor, fx_rate,
                                    category_id, description, note, source)
  values (p_id, p_account_id, p_booked_on, p_kind, p_amount_minor, p_currency,
          case when p_currency = 'PLN' then p_amount_minor else p_amount_pln_minor end,
          case when p_currency = 'PLN' then null else p_fx_rate end,
          p_category_id, nullif(btrim(p_description), ''), nullif(btrim(p_note), ''), 'manual')
  on conflict (id) do nothing;
  select * into v_row from finance.transactions t where t.id = p_id;
  if v_row.id is null then
    raise exception 'transaction_not_found' using errcode = 'P0002';
  end if;
  return v_row;
end $$;

-- Przelew między własnymi kontami: dwie nogi ze wspólnym transfer_id = p_id. Nie liczy się do wydatków.
create function finance.add_transfer(
  p_id uuid, p_from_account_id uuid, p_to_account_id uuid, p_booked_on date, p_amount_minor bigint,
  p_description text default null, p_currency char(3) default 'PLN',
  p_amount_pln_minor bigint default null, p_fx_rate numeric default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_pln bigint := case when p_currency = 'PLN' then p_amount_minor else p_amount_pln_minor end;
  v_fx numeric := case when p_currency = 'PLN' then null else p_fx_rate end;
begin
  if p_amount_minor <= 0 then
    raise exception 'amount_must_be_positive' using errcode = '22023';
  end if;
  if p_from_account_id = p_to_account_id then
    raise exception 'same_account' using errcode = '22023';
  end if;
  if p_booked_on > finance.today() then
    raise exception 'future_date' using errcode = '22023';
  end if;
  if exists (select 1 from finance.transactions t where t.transfer_id = p_id) then
    return p_id;
  end if;
  insert into finance.transactions (id, account_id, booked_on, kind, amount_minor, currency, amount_pln_minor, fx_rate, description, transfer_id)
  values (p_id, p_from_account_id, p_booked_on, 'transfer', -p_amount_minor, p_currency, -v_pln, v_fx, nullif(btrim(p_description), ''), p_id),
         (gen_random_uuid(), p_to_account_id, p_booked_on, 'transfer', p_amount_minor, p_currency, v_pln, v_fx, nullif(btrim(p_description), ''), p_id);
  return p_id;
end $$;

-- Usunięcie transakcji; przelew znika w całości (obie nogi)
create function finance.delete_transaction(p_id uuid) returns void
language sql security invoker set search_path = '' as $$
  delete from finance.transactions t
  where t.id = p_id
     or (t.transfer_id is not null and t.transfer_id = (select x.transfer_id from finance.transactions x where x.id = p_id));
$$;

-- Limit kategorii od danego miesiąca (nadpisuje wersję z tego samego miesiąca)
create function finance.set_budget(p_category_id uuid, p_month date, p_amount_minor bigint) returns void
language sql security invoker set search_path = '' as $$
  insert into finance.budgets (category_id, valid_from, amount_minor)
  values (p_category_id, date_trunc('month', p_month)::date, p_amount_minor)
  on conflict (category_id, valid_from) do update set amount_minor = excluded.amount_minor;
$$;

-- ============ UPRAWNIENIA ============
grant usage on schema finance to authenticated, service_role;
grant select, insert, update, delete on all tables in schema finance to authenticated;
revoke insert, update, delete on finance.fx_rates from authenticated;
grant all on all tables in schema finance to service_role;
grant execute on all functions in schema finance to authenticated, service_role;
