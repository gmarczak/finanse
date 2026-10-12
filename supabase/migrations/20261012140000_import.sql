-- Import wyciągów: jedna transakcja bazy na cały plik, duplikaty pomijane po odcisku,
-- przelewy między własnymi kontami wchodzą parami albo wcale, ręczne wpisy mogą zostać połączone z wierszem z banku.

-- Zwrot za zakup (np. „Card Refund”) to wydatek z dodatnią kwotą: zmniejsza wydatki w swojej kategorii,
-- zamiast udawać przychód. Przychód nadal musi być dodatni.
alter table finance.transactions drop constraint transactions_check;

-- p_rows: [{id, account_id, booked_on, kind, amount_minor, category_id, description, bank_description, fingerprint, transfer_id}]
-- p_merges: [{id (ręczna transakcja), fingerprint, bank_description, booked_on}]
create function finance.import_batch(
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
    insert into finance.transactions (id, account_id, booked_on, kind, amount_minor, amount_pln_minor, category_id, description, bank_description, source, fingerprint, import_id)
    values ((v_row ->> 'id')::uuid, (v_row ->> 'account_id')::uuid, (v_row ->> 'booked_on')::date, (v_row ->> 'kind')::finance.tx_kind,
            (v_row ->> 'amount_minor')::bigint, (v_row ->> 'amount_minor')::bigint, nullif(v_row ->> 'category_id', '')::uuid,
            v_row ->> 'description', v_row ->> 'bank_description', 'import', v_row ->> 'fingerprint', v_import.id)
    on conflict (account_id, fingerprint) do nothing;
    get diagnostics v_count = row_count;
    v_inserted := v_inserted + v_count;
    v_duplicates := v_duplicates + (1 - v_count);
  end loop;

  update finance.imports set inserted_count = v_inserted, duplicate_count = v_duplicates where id = v_import.id
  returning * into v_import;
  return v_import;
end $$;

grant execute on function finance.import_batch(uuid, text, text, integer, jsonb, jsonb) to authenticated, service_role;
