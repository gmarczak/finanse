-- Testy zachowania schematu finance: RLS, ograniczenia, RPC. Uruchamiane po auth_stub.sql i migracjach.
-- Linie z „ok_” mają zwrócić t; linie pod „oczekiwane bledy” mają się wywalić (ON_ERROR_STOP wyłączone).
\set ON_ERROR_STOP 0
insert into auth.users(id,email) values ('11111111-1111-1111-1111-111111111111','a@x'),('22222222-2222-2222-2222-222222222222','b@x');
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);

\echo '-- bootstrap: ustawienia + 12 kategorii, drugi raz nic nie dubluje'
select finance.bootstrap();
select finance.bootstrap();
select (select count(*) from finance.settings) = 1 as ok_settings, (select count(*) from finance.categories) = 12 as ok_categories;
select finance.today() is not null as ok_today;

insert into finance.accounts(name, kind, institution) values ('Revolut','bank','revolut'), ('Pekao','bank','pekao'), ('XTB','broker','xtb');
select id as rev from finance.accounts where name = 'Revolut' \gset
select id as pek from finance.accounts where name = 'Pekao' \gset
select id as xtb from finance.accounts where name = 'XTB' \gset
select id as food from finance.categories where name = 'Jedzenie' \gset
select id as salary from finance.categories where name = 'Wynagrodzenie' \gset

\echo '-- wydatek, powtórka z tym samym id nie dubluje'
select amount_minor = -3850 and amount_pln_minor = -3850 and source = 'manual' as ok_expense
  from finance.add_transaction('aaaaaaaa-0000-0000-0000-000000000001', :'rev', finance.today(), 'expense', -3850, :'food', ' Biedronka ');
select description = 'Biedronka' as ok_trimmed
  from finance.add_transaction('aaaaaaaa-0000-0000-0000-000000000001', :'rev', finance.today(), 'expense', -3850, :'food', 'Biedronka');
select count(*) = 1 as ok_idempotent from finance.transactions;
select amount_minor > 0 as ok_income from finance.add_transaction(gen_random_uuid(), :'pek', finance.today() - 2, 'income', 620000, :'salary', 'Wypłata');
select amount_pln_minor = -5120 and fx_rate = 4.267 as ok_fx
  from finance.add_transaction(gen_random_uuid(), :'rev', finance.today() - 1, 'expense', -1200, null, 'Lizbona', null, 'EUR', -5120, 4.267);

\echo '-- przelew: dwie nogi, nie wydatek; powtórka nie dubluje; usunięcie kasuje obie'
select finance.add_transfer('bbbbbbbb-0000-0000-0000-000000000001', :'pek', :'xtb', finance.today(), 50000, 'Na XTB');
select finance.add_transfer('bbbbbbbb-0000-0000-0000-000000000001', :'pek', :'xtb', finance.today(), 50000, 'Na XTB');
select count(*) = 2 and sum(amount_minor) = 0 as ok_transfer from finance.transactions where transfer_id = 'bbbbbbbb-0000-0000-0000-000000000001';
select finance.delete_transaction('bbbbbbbb-0000-0000-0000-000000000001');
select count(*) = 0 as ok_transfer_deleted from finance.transactions where transfer_id = 'bbbbbbbb-0000-0000-0000-000000000001';

\echo '-- limit: wersja od miesiąca, nadpisanie w tym samym miesiącu'
select finance.set_budget(:'food', finance.today(), 80000);
select finance.set_budget(:'food', finance.today(), 90000);
select count(*) = 1 and max(amount_minor) = 90000 and extract(day from max(valid_from)) = 1 as ok_budget from finance.budgets;

\echo '-- zwrot (np. Card Refund) to wydatek z dodatnią kwotą'
select amount_minor = 427 and kind = 'expense' as ok_refund from finance.add_transaction(gen_random_uuid(), :'rev', finance.today(), 'expense', 427, :'food', 'Zwrot');

\echo '-- oczekiwane bledy (9):'
select finance.add_transaction(gen_random_uuid(), :'rev', finance.today() + 1, 'expense', -100);          -- przyszłość
select finance.add_transaction(gen_random_uuid(), :'rev', finance.today(), 'income', 100, :'food');      -- przychód w kategorii wydatków
select finance.add_transaction(gen_random_uuid(), :'rev', finance.today(), 'expense', -100, :'salary');  -- wydatek w kategorii przychodów
select finance.add_transaction(gen_random_uuid(), :'rev', finance.today(), 'expense', -100, null, 'x', null, 'EUR'); -- waluta bez kursu
select finance.add_transaction(gen_random_uuid(), :'rev', finance.today(), 'transfer', -100);            -- przelew tylko przez add_transfer
select finance.add_transfer(gen_random_uuid(), :'rev', :'rev', finance.today(), 100);                    -- to samo konto
insert into finance.transactions(account_id, booked_on, kind, amount_minor, amount_pln_minor, source) values (:'rev', finance.today(), 'expense', -100, -100, 'import'); -- import bez odcisku
insert into finance.budgets(category_id, valid_from, amount_minor) values (:'food', '2026-10-15', 100);  -- nie pierwszy dzień
insert into finance.fx_rates(rate_date, currency, rate) values (current_date, 'EUR', 4.3);               -- kursy tylko service role

\echo '-- import: ten sam odcisk na tym samym koncie nie wchodzi drugi raz'
insert into finance.transactions(account_id, booked_on, kind, amount_minor, amount_pln_minor, source, fingerprint, bank_description)
values (:'rev', finance.today(), 'expense', -1499, -1499, 'import', 'fp-zabka-0001', 'ZABKA Z4521');
insert into finance.transactions(account_id, booked_on, kind, amount_minor, amount_pln_minor, source, fingerprint, bank_description)
values (:'rev', finance.today(), 'expense', -1499, -1499, 'import', 'fp-zabka-0001', 'ZABKA Z4521')
on conflict (account_id, fingerprint) do nothing;
select count(*) = 1 as ok_dedup from finance.transactions where fingerprint = 'fp-zabka-0001';

\echo '-- import: ręczny wpis łączy się z wierszem z banku, przelew wchodzi parą, drugi import nic nie dodaje'
select inserted_count = 3 and duplicate_count = 0 as ok_import_first from finance.import_batch(:'rev', 'revolut', 'a.csv', 3,
  jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'account_id', :'rev', 'booked_on', finance.today(), 'kind', 'expense', 'amount_minor', -500, 'description', 'Kino', 'bank_description', 'KINO 1', 'fingerprint', 'fp-kino-0001'),
    jsonb_build_object('id', 'cccccccc-0000-0000-0000-000000000001', 'account_id', :'rev', 'booked_on', finance.today(), 'kind', 'transfer', 'amount_minor', -1000, 'description', 'Na oszczędności', 'bank_description', 'To PLN Savings account', 'fingerprint', 'fp-sav-0001', 'transfer_id', 'cccccccc-0000-0000-0000-000000000001'),
    jsonb_build_object('id', gen_random_uuid(), 'account_id', :'pek', 'booked_on', finance.today(), 'kind', 'transfer', 'amount_minor', 1000, 'description', 'Na oszczędności', 'bank_description', 'To PLN Savings account', 'fingerprint', 'fp-sav-0001', 'transfer_id', 'cccccccc-0000-0000-0000-000000000001')),
  jsonb_build_array(jsonb_build_object('id', 'aaaaaaaa-0000-0000-0000-000000000001', 'fingerprint', 'fp-bied-0001', 'bank_description', 'BIEDRONKA 12', 'booked_on', finance.today())));
select inserted_count = 0 and duplicate_count = 3 as ok_import_again from finance.import_batch(:'rev', 'revolut', 'a.csv', 3,
  jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'account_id', :'rev', 'booked_on', finance.today(), 'kind', 'expense', 'amount_minor', -500, 'description', 'Kino', 'bank_description', 'KINO 1', 'fingerprint', 'fp-kino-0001'),
    jsonb_build_object('id', gen_random_uuid(), 'account_id', :'rev', 'booked_on', finance.today(), 'kind', 'transfer', 'amount_minor', -1000, 'description', 'Na oszczędności', 'bank_description', 'x', 'fingerprint', 'fp-sav-0001', 'transfer_id', 'dddddddd-0000-0000-0000-000000000001'),
    jsonb_build_object('id', gen_random_uuid(), 'account_id', :'pek', 'booked_on', finance.today(), 'kind', 'transfer', 'amount_minor', 1000, 'description', 'Na oszczędności', 'bank_description', 'x', 'fingerprint', 'fp-sav-0001', 'transfer_id', 'dddddddd-0000-0000-0000-000000000001')),
  jsonb_build_array(jsonb_build_object('id', 'aaaaaaaa-0000-0000-0000-000000000001', 'fingerprint', 'fp-bied-0001', 'bank_description', 'BIEDRONKA 12', 'booked_on', finance.today())));
select source = 'import' and fingerprint = 'fp-bied-0001' and description = 'Biedronka' and category_id is not null as ok_merged
  from finance.transactions where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select count(*) = 2 and sum(amount_minor) = 0 as ok_import_transfer from finance.transactions where fingerprint = 'fp-sav-0001';

\echo '-- usunięcie kategorii zostawia transakcje bez kategorii'
delete from finance.categories where id = :'food';
select count(*) = 1 as ok_uncategorized from finance.transactions where id = 'aaaaaaaa-0000-0000-0000-000000000001' and category_id is null;

\echo '-- RLS: użytkownik B nic nie widzi i nic nie zmieni'
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select (select count(*) from finance.transactions) = 0 and (select count(*) from finance.accounts) = 0 and (select count(*) from finance.categories) = 0 as ok_b_isolated;
select finance.bootstrap();
select (select count(*) from finance.categories) = 12 as ok_b_own_categories;
update finance.transactions set amount_minor = -1 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select finance.delete_transaction('aaaaaaaa-0000-0000-0000-000000000001');
\echo '-- oczekiwane bledy RLS (2):'
select finance.add_transaction(gen_random_uuid(), :'rev', finance.today(), 'expense', -100);             -- cudze konto (FK złożony)
insert into finance.accounts(user_id, name) values ('11111111-1111-1111-1111-111111111111', 'Podrzucone'); -- with check
reset role;
select amount_minor = -3850 as ok_untouched from finance.transactions where id = 'aaaaaaaa-0000-0000-0000-000000000001';

\echo '-- kasowanie konta użytkownika czyści wszystko kaskadowo'
delete from auth.users where email = 'a@x';
select (select count(*) from finance.transactions) = 0 and (select count(*) from finance.accounts) = 0
   and (select count(*) from finance.settings) = 1 and (select count(*) from finance.budgets) = 0 as ok_cascade;
