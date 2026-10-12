-- Odsetki z oszczędności: kategoria przychodu „Odsetki” i wiersze zbiorcze, które kolejny import aktualizuje.

-- 1. Nowa kategoria startowa
create or replace function finance.bootstrap() returns void
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
      ('income',  'Odsetki',             'piggy-bank',    'teal',   1),
      ('income',  'Inne przychody',      'plus',          'slate',  2);
  end if;
end $$;

-- Istniejący użytkownicy dostają „Odsetki” przed „Inne przychody” (jeśli nie mają już takiej kategorii)
update finance.categories c set sort_order = 2
where c.kind = 'income' and c.name = 'Inne przychody' and c.sort_order = 1
  and not exists (select 1 from finance.categories o where o.user_id = c.user_id and o.kind = 'income' and o.name = 'Odsetki');

insert into finance.categories (user_id, kind, name, icon, color, sort_order)
select s.user_id, 'income', 'Odsetki', 'piggy-bank', 'teal', 1
from finance.settings s
where not exists (select 1 from finance.categories o where o.user_id = s.user_id and o.kind = 'income' and o.name = 'Odsetki');

-- 2. import_batch: wiersz z "replace": true aktualizuje kwotę i datę istniejącego wiersza o tym samym odcisku
--    (odsetki za bieżący miesiąc rosną z każdym wyciągiem). Kategoria i opis zmienione ręcznie zostają.
create or replace function finance.import_batch(
  p_account_id uuid, p_format text, p_file_name text, p_row_count integer, p_rows jsonb, p_merges jsonb default '[]'::jsonb
) returns finance.imports
language plpgsql security invoker set search_path = '' as $$
declare
  v_import finance.imports;
  v_row jsonb;
  v_inserted integer := 0;
  v_duplicates integer := 0;
  v_count integer;
  v_transfer uuid;
begin
  insert into finance.imports (account_id, format, file_name, row_count)
  values (p_account_id, p_format, p_file_name, p_row_count)
  returning * into v_import;

  -- Połączenie z ręcznym wpisem: wiersz z banku „przejmuje” istniejącą transakcję (kategoria i opis zostają)
  for v_row in select * from jsonb_array_elements(p_merges) loop
    update finance.transactions t
    set source = 'import', fingerprint = v_row ->> 'fingerprint', bank_description = v_row ->> 'bank_description',
        booked_on = (v_row ->> 'booked_on')::date, import_id = v_import.id
    where t.id = (v_row ->> 'id')::uuid and t.source = 'manual'
      and not exists (select 1 from finance.transactions d where d.account_id = t.account_id and d.fingerprint = v_row ->> 'fingerprint');
    get diagnostics v_count = row_count;
    v_inserted := v_inserted + v_count;
    v_duplicates := v_duplicates + (1 - v_count);
  end loop;

  -- Przelewy: obie nogi albo żadna (gdy którakolwiek już jest, to duplikat)
  for v_transfer in select distinct (r ->> 'transfer_id')::uuid from jsonb_array_elements(p_rows) r where r ->> 'transfer_id' is not null loop
    if exists (
      select 1 from jsonb_array_elements(p_rows) r
      join finance.transactions t on t.account_id = (r ->> 'account_id')::uuid and t.fingerprint = r ->> 'fingerprint'
      where (r ->> 'transfer_id')::uuid = v_transfer
    ) then
      v_duplicates := v_duplicates + 1;
      continue;
    end if;
    insert into finance.transactions (id, account_id, booked_on, kind, amount_minor, amount_pln_minor, description, bank_description, source, fingerprint, transfer_id, import_id)
    select (r ->> 'id')::uuid, (r ->> 'account_id')::uuid, (r ->> 'booked_on')::date, 'transfer', (r ->> 'amount_minor')::bigint, (r ->> 'amount_minor')::bigint,
           r ->> 'description', r ->> 'bank_description', 'import', r ->> 'fingerprint', v_transfer, v_import.id
    from jsonb_array_elements(p_rows) r where (r ->> 'transfer_id')::uuid = v_transfer;
    v_inserted := v_inserted + 1;
  end loop;

  -- Wydatki i przychody
  for v_row in select * from jsonb_array_elements(p_rows) r where r ->> 'transfer_id' is null loop
    if coalesce((v_row ->> 'replace')::boolean, false) then
      insert into finance.transactions as t (id, account_id, booked_on, kind, amount_minor, amount_pln_minor, category_id, description, bank_description, source, fingerprint, import_id)
      values ((v_row ->> 'id')::uuid, (v_row ->> 'account_id')::uuid, (v_row ->> 'booked_on')::date, (v_row ->> 'kind')::finance.tx_kind,
              (v_row ->> 'amount_minor')::bigint, (v_row ->> 'amount_minor')::bigint, nullif(v_row ->> 'category_id', '')::uuid,
              v_row ->> 'description', v_row ->> 'bank_description', 'import', v_row ->> 'fingerprint', v_import.id)
      on conflict (account_id, fingerprint) do update
        set amount_minor = excluded.amount_minor, amount_pln_minor = excluded.amount_pln_minor, booked_on = excluded.booked_on, import_id = excluded.import_id
        where t.kind = excluded.kind and (t.amount_minor <> excluded.amount_minor or t.booked_on <> excluded.booked_on);
    else
      insert into finance.transactions (id, account_id, booked_on, kind, amount_minor, amount_pln_minor, category_id, description, bank_description, source, fingerprint, import_id)
      values ((v_row ->> 'id')::uuid, (v_row ->> 'account_id')::uuid, (v_row ->> 'booked_on')::date, (v_row ->> 'kind')::finance.tx_kind,
              (v_row ->> 'amount_minor')::bigint, (v_row ->> 'amount_minor')::bigint, nullif(v_row ->> 'category_id', '')::uuid,
              v_row ->> 'description', v_row ->> 'bank_description', 'import', v_row ->> 'fingerprint', v_import.id)
      on conflict (account_id, fingerprint) do nothing;
    end if;
    get diagnostics v_count = row_count;
    v_inserted := v_inserted + v_count;
    v_duplicates := v_duplicates + (1 - v_count);
  end loop;

  update finance.imports set inserted_count = v_inserted, duplicate_count = v_duplicates where id = v_import.id
  returning * into v_import;
  return v_import;
end $$;
