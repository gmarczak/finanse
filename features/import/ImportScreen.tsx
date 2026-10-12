"use client";

import Link from "next/link";
import { useMemo, useState, type ChangeEvent } from "react";
import { btnPrimary, btnSecondary, field, label, labelText } from "@/components/ui/styles";
import { useAction, useSnapshot, useToday } from "@/lib/data/hooks";
import { addAccounts, errorMessage, newId, runImport, updateAccount, type ImportPayload } from "@/lib/data/mutations";
import type { ImportRow } from "@/lib/db/database.types";
import type { Account } from "@/lib/domain/model";
import { formatMoney } from "@/lib/domain/money";
import { csvRecords } from "@/lib/import/csv";
import type { ParsedStatement } from "@/lib/import/model";
import { buildImportPlan, counterpartiesOf, plannedCount, type ImportChoices } from "@/lib/import/plan";
import { isRevolut, parseRevolut } from "@/lib/import/revolut";
import { isRevolutSavings, parseRevolutSavings } from "@/lib/import/revolutSavings";
import { formatShortDate, plural } from "@/lib/format";

type Loaded = { fileName: string; statement: ParsedStatement; rowCount: number };

function readStatement(fileName: string, text: string): Loaded {
  const { header, records } = csvRecords(text);
  if (isRevolut(header)) return { fileName, statement: parseRevolut(text), rowCount: records.length };
  if (isRevolutSavings(header)) return { fileName, statement: parseRevolutSavings(text), rowCount: records.length };
  throw new Error("Na razie obsługiwane są wyciągi CSV z Revoluta: konta (Konta → Więcej → Wyciąg) i oszczędności. Kolejne banki wkrótce.");
}

const pick = (accounts: Account[], test: (a: Account) => boolean) => accounts.find((a) => a.archivedAt === null && test(a))?.id ?? null;

// Zapamiętane przypisania osób z przelewów (np. „Grzegorz Marczak” → Pekao), tylko na tym urządzeniu
const PEOPLE_KEY = "finanse-import-people";
function readPeople(): Record<string, string | null> {
  try {
    return JSON.parse(localStorage.getItem(PEOPLE_KEY) ?? "{}") as Record<string, string | null>;
  } catch {
    return {};
  }
}
function savePeople(map: Record<string, string | null>) {
  try {
    localStorage.setItem(PEOPLE_KEY, JSON.stringify(map));
  } catch {
    // brak pamięci przeglądarki: wybór obowiązuje tylko w tym imporcie
  }
}

export function ImportScreen() {
  const { data: snapshot } = useSnapshot();
  const today = useToday(snapshot);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [choices, setChoices] = useState<ImportChoices | null>(null);
  const [setBalance, setSetBalance] = useState(false);
  const [result, setResult] = useState<ImportRow | null>(null);
  const importer = useAction((s, p: ImportPayload) => runImport(s, p));
  const anchor = useAction(updateAccount);
  const createAccount = useAction((s, name: string) => addAccounts(s, [{ name, kind: "savings", institution: "revolut", balanceMinor: null, balanceOn: today ?? "" }], snapshot?.accounts.length ?? 0));

  const accounts = useMemo(() => snapshot?.accounts.filter((a) => a.archivedAt === null) ?? [], [snapshot]);

  // Plan liczony na nowo przy każdej zmianie wyborów (identyfikatory nowych wierszy też)
  const plan = useMemo(
    () =>
      snapshot && loaded && choices && choices.accountId
        ? buildImportPlan({ statement: loaded.statement, choices, accounts: snapshot.accounts, categories: snapshot.categories, transactions: snapshot.transactions, rules: snapshot.rules, newId })
        : null,
    [snapshot, loaded, choices],
  );

  if (!snapshot || !today) return null;

  function defaults(statement: ParsedStatement): ImportChoices {
    const main = pick(accounts, (a) => a.institution === "revolut" && a.kind === "bank");
    const savings = pick(accounts, (a) => a.institution === "revolut" && a.kind === "savings");
    const isSavings = statement.accountKind === "savings";
    const accountId = (isSavings ? savings : main) ?? (isSavings ? "" : (accounts[0]?.id ?? ""));
    const otherBanks = accounts.filter((a) => a.kind === "bank" && a.id !== accountId);
    const remembered = readPeople();
    const people = Object.fromEntries(
      counterpartiesOf(statement).map(({ name }) => [name, remembered[name] && accounts.some((a) => a.id === remembered[name]) ? remembered[name]! : null]),
    );
    return {
      accountId,
      ownAccountId: isSavings ? main : savings,
      counterparties: people,
      includeExchange: false,
      brokerAccountIds: { xtb: pick(accounts, (a) => a.institution === "xtb") },
      topupFrom: otherBanks.length === 1 ? otherBanks[0]!.id : "income",
      rejectedMerges: [],
    };
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setProblem(null);
    setResult(null);
    try {
      const next = readStatement(file.name, await file.text());
      const initial = defaults(next.statement);
      setLoaded(next);
      setChoices(initial);
      const account = accounts.find((a) => a.id === initial.accountId);
      // Saldo z banku jest dokładniejsze niż wpisane ręcznie — chyba że wpisane jest nowsze niż koniec wyciągu
      const closing = next.statement.closingBalance;
      setSetBalance(closing !== null && (!account || account.anchorOn === null || closing.on >= account.anchorOn));
    } catch (err) {
      setLoaded(null);
      setProblem(err instanceof Error ? err.message : String(err));
    }
  }

  function submit() {
    if (!loaded || !choices || !plan) return;
    savePeople({ ...readPeople(), ...choices.counterparties });
    const closing = loaded.statement.closingBalance;
    importer.mutate(
      { accountId: choices.accountId, format: loaded.statement.format, fileName: loaded.fileName, rowCount: loaded.rowCount, plan },
      {
        onSuccess: (r) => {
          setResult(r);
          if (setBalance && closing) anchor.mutate({ id: choices.accountId, balanceMinor: closing.minor, balanceOn: closing.on });
        },
        onError: (e) => setProblem(errorMessage(e)),
      },
    );
  }

  const set = (patch: Partial<ImportChoices>) => setChoices((c) => (c ? { ...c, ...patch } : c));
  const hasHint = (type: string) => loaded?.statement.rows.some((r) => r.hint.type === type) ?? false;
  const accountOptions = (exclude?: string) =>
    accounts
      .filter((a) => a.id !== exclude)
      .map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ));
  const isSavings = loaded?.statement.accountKind === "savings";
  const people = loaded ? counterpartiesOf(loaded.statement) : [];
  const closing = loaded?.statement.closingBalance ?? null;

  const header = (
    <header className="flex items-center gap-1">
      <Link href="/transactions" aria-label="Wróć" className="-ml-3 flex h-11 w-11 items-center justify-center">
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </Link>
      <h1 className="font-serif text-[28px] font-semibold">Import wyciągu</h1>
    </header>
  );

  if (result) {
    const uncategorized = snapshot.transactions.filter((t) => t.kind !== "transfer" && t.categoryId === null).length;
    return (
      <main className="flex flex-col gap-5 px-5 pt-6">
        {header}
        <section className="flex flex-col gap-2 rounded-2xl bg-surface px-5 py-5">
          <h2 className="font-serif text-2xl font-semibold">Gotowe</h2>
          <p>
            Dodano <strong>{result.inserted_count}</strong> {plural(result.inserted_count, "pozycję", "pozycje", "pozycji")}
            {result.duplicate_count > 0 && `, pominięto ${result.duplicate_count} już zapisanych`}.
          </p>
        </section>
        {uncategorized > 0 && (
          <Link href="/transactions?category=none" className={btnPrimary}>
            Przypisz kategorie ({uncategorized})
          </Link>
        )}
        <button type="button" onClick={() => {
            setResult(null);
            setLoaded(null);
          }} className={btnSecondary}>
          Wczytaj kolejny plik
        </button>
        <Link href="/" className="text-center text-sm font-semibold text-accent">
          Zobacz miesiąc
        </Link>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-5 px-5 pt-6">
      {header}

      <label className={`${btnSecondary} relative cursor-pointer`}>
        {loaded ? `Inny plik (teraz: ${loaded.fileName})` : "Wybierz plik CSV z banku"}
        <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
      {!loaded && (
        <p className="text-sm text-muted">
          Revolut: <strong>Konta → Więcej → Wyciąg</strong> (konto główne i oszczędności osobno). Plik jest czytany w telefonie — do bazy trafiają tylko zatwierdzone
          transakcje. Ten sam plik możesz wczytać drugi raz: nic się nie zdubluje, a przelew między kontami nie wejdzie podwójnie.
        </p>
      )}
      {problem && <p className="text-sm text-danger">{problem}</p>}

      {loaded && choices && (
        <>
          <p className="text-sm text-muted">
            {loaded.statement.label} · {loaded.statement.rows.length} {plural(loaded.statement.rows.length, "pozycja", "pozycje", "pozycji")}
            {loaded.statement.rows.length > 0 && ` · ${formatShortDate(loaded.statement.rows[0]!.bookedOn, today)} – ${formatShortDate(loaded.statement.rows[loaded.statement.rows.length - 1]!.bookedOn, today)}`}
          </p>

          {isSavings && !choices.accountId ? (
            <section className="flex flex-col gap-3 rounded-2xl bg-surface px-4 py-4">
              <p className="text-sm">To wyciąg z oszczędności, a w aplikacji nie ma jeszcze takiego konta.</p>
              <button
                type="button"
                disabled={createAccount.isPending}
                onClick={() => createAccount.mutate("Revolut Oszczędności", { onSuccess: (created) => created[0] && set({ accountId: created[0].id }), onError: (e) => setProblem(errorMessage(e)) })}
                className={btnPrimary}
              >
                Utwórz konto „Revolut Oszczędności”
              </button>
            </section>
          ) : (
            <label className={label}>
              <span className={labelText}>Konto wyciągu</span>
              <select value={choices.accountId} onChange={(e) => set({ accountId: e.target.value })} className={field}>
                {accountOptions()}
              </select>
            </label>
          )}

          {plan && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col rounded-2xl bg-surface p-3">
                  <span className="font-serif text-[28px] font-semibold leading-tight text-accent">{plan.rows.length + plan.transfers.length}</span>
                  <span className="text-xs leading-snug text-muted">nowe pozycje</span>
                </div>
                <div className="flex flex-col rounded-2xl bg-surface p-3">
                  <span className="font-serif text-[28px] font-semibold leading-tight">{plan.duplicates}</span>
                  <span className="text-xs leading-snug text-muted">już są — pominięte</span>
                </div>
                <div className="flex flex-col rounded-2xl p-3" style={{ background: "var(--c-amber-bg)" }}>
                  <span className="font-serif text-[28px] font-semibold leading-tight" style={{ color: "var(--c-amber-fg)" }}>
                    {plan.merges.length}
                  </span>
                  <span className="text-xs leading-snug text-muted">połączone z wpisanymi ręcznie</span>
                </div>
              </div>

              {hasHint("own-transfer") && (
                <label className={label}>
                  <span className={labelText}>
                    {isSavings ? "Przelewy z/na konto główne" : "Przelewy z/na oszczędności"} ({plan.counts.ownTransfers + plan.skipped.ownTransfersWithoutAccount})
                  </span>
                  <select value={choices.ownAccountId ?? ""} onChange={(e) => set({ ownAccountId: e.target.value || null })} className={field}>
                    <option value="">Pomiń (nie mam tego konta w aplikacji)</option>
                    {accountOptions(choices.accountId)}
                  </select>
                  <span className="text-xs text-muted">Przelew między własnymi kontami nie liczy się do wydatków.</span>
                </label>
              )}

              {people.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h2 className={labelText}>Przelewy do i od osób</h2>
                  <p className="text-xs text-muted">Jeśli to Twoje konto w innym banku, wybierz je — wtedy to przelew, nie wydatek ani przychód.</p>
                  {people.map((p) => (
                    <label key={p.name} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm">
                        {p.name} <span className="text-muted">({p.count})</span>
                      </span>
                      <select
                        value={choices.counterparties[p.name] ?? ""}
                        onChange={(e) => set({ counterparties: { ...choices.counterparties, [p.name]: e.target.value || null } })}
                        className="h-11 max-w-[11rem] shrink-0 rounded-xl border border-border bg-surface px-2 text-sm"
                      >
                        <option value="">Wydatek / przychód</option>
                        {accountOptions(choices.accountId)}
                      </select>
                    </label>
                  ))}
                </section>
              )}

              {hasHint("broker") && (
                <label className={label}>
                  <span className={labelText}>Wpłaty na XTB</span>
                  <select value={choices.brokerAccountIds.xtb ?? ""} onChange={(e) => set({ brokerAccountIds: { ...choices.brokerAccountIds, xtb: e.target.value || null } })} className={field}>
                    <option value="">Licz jako wydatek</option>
                    {accountOptions(choices.accountId)}
                  </select>
                </label>
              )}

              {hasHint("topup") && (
                <label className={label}>
                  <span className={labelText}>Doładowania z innego banku lub karty</span>
                  <select value={choices.topupFrom} onChange={(e) => set({ topupFrom: e.target.value })} className={field}>
                    <option value="income">Licz jako przychód</option>
                    {accountOptions(choices.accountId)}
                  </select>
                </label>
              )}

              {hasHint("exchange") && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={choices.includeExchange} onChange={(e) => set({ includeExchange: e.target.checked })} className="h-[18px] w-[18px] accent-[var(--accent)]" />
                  Licz wymianę walut na złotówki jako przychód (domyślnie pomijana — to Twoje pieniądze z innej waluty)
                </label>
              )}

              {closing && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={setBalance} onChange={(e) => setSetBalance(e.target.checked)} className="h-[18px] w-[18px] accent-[var(--accent)]" />
                  Ustaw saldo konta z wyciągu: <strong>{formatMoney(closing.minor)}</strong> ({formatShortDate(closing.on, today)})
                </label>
              )}

              {plan.merges.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h2 className="font-serif text-xl font-semibold">To ten sam wydatek?</h2>
                  {plan.merges.map((m) => (
                    <div key={m.row.fingerprint} className="flex flex-col gap-2 rounded-2xl bg-surface px-4 py-3 text-sm">
                      <div className="flex justify-between gap-3">
                        <span>
                          <strong>{m.manual.description ?? "Bez opisu"}</strong> <span className="text-muted">· wpisane ręcznie, {formatShortDate(m.manual.bookedOn, today)}</span>
                        </span>
                        <strong className="shrink-0">{formatMoney(m.manual.amountMinor)}</strong>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>
                          <strong>{m.row.description}</strong> <span className="text-muted">· z banku, {formatShortDate(m.row.bookedOn, today)}</span>
                        </span>
                        <strong className="shrink-0">{formatMoney(m.row.amountMinor)}</strong>
                      </div>
                      <button type="button" onClick={() => set({ rejectedMerges: [...choices.rejectedMerges, m.row.fingerprint] })} className="self-start text-sm font-semibold text-accent">
                        To dwa różne — dodaj osobno
                      </button>
                    </div>
                  ))}
                </section>
              )}

              <ul className="flex flex-col text-sm">
                <li className="flex justify-between border-b border-border py-2.5">
                  <span>Kategoria nadana automatycznie</span>
                  <strong>{plan.counts.autoCategorized}</strong>
                </li>
                <li className="flex justify-between border-b border-border py-2.5">
                  <span>Bez kategorii — przypiszesz po imporcie</span>
                  <strong className="text-warn">{plan.counts.uncategorized}</strong>
                </li>
                {plan.counts.interestUpdated > 0 && (
                  <li className="flex justify-between border-b border-border py-2.5">
                    <span>Odsetki za miesiąc zaktualizowane</span>
                    <strong>{plan.counts.interestUpdated}</strong>
                  </li>
                )}
                {(plan.skipped.pending > 0 || plan.skipped.otherCurrency > 0 || plan.skipped.exchange > 0) && (
                  <li className="py-2.5 text-muted">
                    Pominięte:{" "}
                    {[
                      plan.skipped.pending > 0 && `${plan.skipped.pending} oczekujące (wejdą przy następnym imporcie)`,
                      plan.skipped.otherCurrency > 0 && `${plan.skipped.otherCurrency} w obcej walucie`,
                      plan.skipped.exchange > 0 && `${plan.skipped.exchange} wymiana walut`,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </li>
                )}
              </ul>

              <button type="button" onClick={submit} disabled={importer.isPending || plannedCount(plan) === 0} className={`${btnPrimary} mb-6`}>
                {importer.isPending ? "Importuję…" : plannedCount(plan) === 0 ? "Nic nowego w tym pliku" : `Zatwierdź import (${plannedCount(plan)})`}
              </button>
            </>
          )}
        </>
      )}
    </main>
  );
}
