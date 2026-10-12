"use client";

import Link from "next/link";
import { useMemo, useState, type ChangeEvent } from "react";
import { btnPrimary, btnSecondary, field, label, labelText } from "@/components/ui/styles";
import { useAction, useSnapshot, useToday } from "@/lib/data/hooks";
import { errorMessage, newId, runImport, type ImportPayload } from "@/lib/data/mutations";
import type { ImportRow } from "@/lib/db/database.types";
import type { Account } from "@/lib/domain/model";
import { formatMoney } from "@/lib/domain/money";
import { csvRecords } from "@/lib/import/csv";
import type { ParsedStatement } from "@/lib/import/model";
import { buildImportPlan, plannedCount, type ImportChoices } from "@/lib/import/plan";
import { isRevolut, parseRevolut } from "@/lib/import/revolut";
import { formatShortDate, plural } from "@/lib/format";

type Loaded = { fileName: string; statement: ParsedStatement; rowCount: number };

function readStatement(fileName: string, text: string): Loaded {
  const { header, records } = csvRecords(text);
  if (isRevolut(header)) return { fileName, statement: parseRevolut(text), rowCount: records.length };
  throw new Error("Na razie obsługiwany jest wyciąg CSV z Revoluta (Konta → Więcej → Wyciąg). Kolejne banki wkrótce.");
}

const pick = (accounts: Account[], test: (a: Account) => boolean) => accounts.find((a) => a.archivedAt === null && test(a))?.id ?? null;

export function ImportScreen() {
  const { data: snapshot } = useSnapshot();
  const today = useToday(snapshot);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [choices, setChoices] = useState<ImportChoices | null>(null);
  const [result, setResult] = useState<ImportRow | null>(null);
  const importer = useAction((s, p: ImportPayload) => runImport(s, p));

  const accounts = useMemo(() => snapshot?.accounts.filter((a) => a.archivedAt === null) ?? [], [snapshot]);

  // Plan liczony na nowo przy każdej zmianie wyborów (identyfikatory nowych wierszy też)
  const plan = useMemo(
    () =>
      snapshot && loaded && choices
        ? buildImportPlan({ statement: loaded.statement, choices, accounts: snapshot.accounts, categories: snapshot.categories, transactions: snapshot.transactions, rules: snapshot.rules, newId })
        : null,
    [snapshot, loaded, choices],
  );

  if (!snapshot || !today) return null;

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setProblem(null);
    setResult(null);
    try {
      const next = readStatement(file.name, await file.text());
      const revolut = pick(accounts, (a) => a.institution === "revolut" && a.kind === "bank") ?? accounts[0]?.id ?? "";
      const otherBanks = accounts.filter((a) => a.kind === "bank" && a.id !== revolut);
      setLoaded(next);
      setChoices({
        accountId: revolut,
        savingsAccountId: pick(accounts, (a) => a.institution === "revolut" && a.kind === "savings"),
        brokerAccountIds: { xtb: pick(accounts, (a) => a.institution === "xtb") },
        topupFrom: otherBanks.length === 1 ? otherBanks[0]!.id : "income",
        rejectedMerges: [],
      });
    } catch (err) {
      setLoaded(null);
      setProblem(err instanceof Error ? err.message : String(err));
    }
  }

  function submit() {
    if (!loaded || !choices || !plan) return;
    importer.mutate(
      { accountId: choices.accountId, format: loaded.statement.format, fileName: loaded.fileName, rowCount: loaded.rowCount, plan },
      { onSuccess: (r) => setResult(r), onError: (e) => setProblem(errorMessage(e)) },
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
        <Link href="/" className={btnSecondary}>
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
          Revolut: <strong>Konta → Więcej → Wyciąg</strong>, zakres dat i format, potem wybierz plik tutaj. Plik jest czytany w telefonie — do bazy trafiają tylko
          zatwierdzone transakcje. Ten sam plik możesz wczytać drugi raz: nic się nie zdubluje.
        </p>
      )}
      {problem && <p className="text-sm text-danger">{problem}</p>}

      {loaded && choices && plan && (
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

          <label className={label}>
            <span className={labelText}>Konto wyciągu</span>
            <select value={choices.accountId} onChange={(e) => set({ accountId: e.target.value })} className={field}>
              {accountOptions()}
            </select>
          </label>

          {hasHint("own-transfer") && (
            <label className={label}>
              <span className={labelText}>Przelewy z/na oszczędności ({plan.counts.ownTransfers + plan.skipped.ownTransfersWithoutAccount})</span>
              <select value={choices.savingsAccountId ?? ""} onChange={(e) => set({ savingsAccountId: e.target.value || null })} className={field}>
                <option value="">Pomiń (nie mam tego konta w aplikacji)</option>
                {accountOptions(choices.accountId)}
              </select>
              <span className="text-xs text-muted">Przelew między własnymi kontami nie liczy się do wydatków.</span>
            </label>
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
              <span className={labelText}>Doładowania z innego banku</span>
              <select value={choices.topupFrom} onChange={(e) => set({ topupFrom: e.target.value })} className={field}>
                <option value="income">Licz jako przychód</option>
                {accountOptions(choices.accountId)}
              </select>
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
            {(plan.skipped.pending > 0 || plan.skipped.otherCurrency > 0) && (
              <li className="flex justify-between py-2.5 text-muted">
                <span>
                  Pominięte: {plan.skipped.pending > 0 && `${plan.skipped.pending} oczekujące (wejdą przy następnym imporcie)`}
                  {plan.skipped.pending > 0 && plan.skipped.otherCurrency > 0 && ", "}
                  {plan.skipped.otherCurrency > 0 && `${plan.skipped.otherCurrency} w obcej walucie (wkrótce)`}
                </span>
              </li>
            )}
          </ul>

          <button type="button" onClick={submit} disabled={importer.isPending || plannedCount(plan) === 0} className={`${btnPrimary} mb-6`}>
            {importer.isPending ? "Importuję…" : plannedCount(plan) === 0 ? "Nic nowego w tym pliku" : `Zatwierdź import (${plannedCount(plan)})`}
          </button>
        </>
      )}
    </main>
  );
}
