# Finanse

Osobista aplikacja do pieniędzy: w każdej chwili wiesz, ile wydałeś i na co, ile zostało w limitach i co zaraz pobierze subskrypcja. Siostrzana aplikacja [Nawyków](https://github.com/gmarczak/habit-tracker) — ten sam wygląd, ta sama baza i to samo konto.

Plan i decyzje: dokument „Finanse — plan aplikacji” (Claude).

## Stos

- Next.js 16 (App Router) + TypeScript strict, Tailwind CSS v4, PWA (instalacja na iPhonie z Safari)
- Supabase: Postgres + Auth + RLS; osobny schemat `finance` w projekcie `habit-tracker`
- TanStack Query z trwałym cache w IndexedDB: wydatek zapisuje się od razu, także bez sieci (kolejka offline)
- Vitest dla logiki domenowej, testy zachowania bazy w czystym Postgresie (CI)

## Struktura

```
app/                 trasy: / (Miesiąc), /transactions, /plan, /accounts (Majątek), /settings, /login
features/            ekrany i komponenty per funkcja (add, month, transactions, plan, accounts, onboarding)
lib/domain/          czysta logika: kwoty, okresy, podsumowanie miesiąca, limity, salda (+ testy)
lib/data/            pobieranie danych, zapisy, hooki
lib/db/              klienci Supabase i typy schematu finance
supabase/migrations  cały schemat finance
supabase/tests       testy zachowania bazy (RLS, ograniczenia, RPC)
```

## Zasady

- **Kwoty w groszach** (`bigint`, liczby całkowite), ze znakiem: wydatek < 0, przychód > 0. Nigdy ułamki.
- **Dzień = data lokalna** (`lib/domain/dates`), nie `toISOString()` (zabronione lintem).
- **Przelew między własnymi kontami** to dwie nogi ze wspólnym `transfer_id` — nie liczy się do wydatków.
- **Limity są wersjonowane** (`budgets.valid_from`): zmiana od tego miesiąca nie przepisuje historii.
- **Saldo konta** liczone od „kotwicy” (saldo wpisane w danym dniu) — import starszej historii nie zmienia dzisiejszego salda.
- **Rodzaj kategorii musi pasować do transakcji** (wydatek → kategoria wydatków) — pilnuje tego klucz obcy w bazie.
- Wszystkie sumy i limity liczy `lib/domain`; UI tylko wyświetla. Bez `alert()` / `confirm()` (usuwanie z „Cofnij”) i bez `any`.
- Dostęp do wierszy decyduje jedna funkcja `finance.can_access()` — pod przyszłe wspólne wydatki.

## Uruchomienie

```bash
cp .env.example .env.local   # uzupełnij klucz publishable z Supabase
npm install
npm run dev
```

Sprawdzenia: `npm run check` (typy, lint, testy).

## Baza

Migracje w `supabase/migrations` są źródłem prawdy. Schemat `finance` musi być dodany do **Exposed schemas** (Supabase → Integrations → Data API → Settings). Testy bazy lokalnie (Postgres 15+):

```bash
psql -f supabase/tests/auth_stub.sql
for f in supabase/migrations/*.sql; do psql -f "$f"; done
psql -f supabase/tests/behavior.sql   # każde ok_… = t, dokładnie 11 oczekiwanych błędów
```

## Wdrożenie

Produkcja: finanse.gmarczak.xyz (Vercel, automatycznie z gałęzi `main`). Adres musi być na liście **Redirect URLs** w Supabase Auth, żeby działały linki z maila.
