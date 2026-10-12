"use client";

import Link from "next/link";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { btnPrimary, btnSecondary, field, label, labelText } from "@/components/ui/styles";
import { textOfMinor } from "@/features/add/amountInput";
import { useAction, useSnapshot, useToday } from "@/lib/data/hooks";
import { addAccounts, errorMessage, updateAccount } from "@/lib/data/mutations";
import { balanceOn, netWorth } from "@/lib/domain/balance";
import type { LocalDate } from "@/lib/domain/dates";
import type { Account, AccountKind } from "@/lib/domain/model";
import { formatMoney, parseAmount } from "@/lib/domain/money";
import { AccountBadge } from "@/lib/ui/icons";

const KIND_LABEL: Record<AccountKind, string> = { bank: "konto bankowe", broker: "konto maklerskie", cash: "gotówka" };

type Editing = { mode: "new" } | { mode: "edit"; account: Account };

function AccountEditor({ editing, current, today, nextOrder, onClose }: { editing: Editing; current: number | null; today: LocalDate; nextOrder: number; onClose: () => void }) {
  const account = editing.mode === "edit" ? editing.account : null;
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? "bank");
  const [balance, setBalance] = useState(current === null ? "" : (current < 0 ? "-" : "") + textOfMinor(current));
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();
  const create = useAction((s, input: Parameters<typeof addAccounts>[1]) => addAccounts(s, input, nextOrder));
  const update = useAction(updateAccount);

  function save() {
    if (!name.trim()) return setProblem("Podaj nazwę konta.");
    const parsed = balance.trim() === "" ? null : parseAmount(balance);
    if (balance.trim() !== "" && parsed === null) return setProblem("Nie rozumiem salda. Wpisz np. 1 250,00.");
    const onError = (e: Error) => toast({ message: errorMessage(e) });
    if (account) {
      update.mutate(
        {
          id: account.id,
          name,
          // Zmienione saldo = nowa kotwica z dzisiejszą datą
          ...(parsed !== current && { balanceMinor: parsed, balanceOn: today }),
        },
        { onError },
      );
    } else {
      create.mutate([{ name, kind, institution: null, balanceMinor: parsed, balanceOn: today }], { onError });
    }
    onClose();
  }

  return (
    <div className="flex flex-col gap-5">
      <label className={label}>
        <span className={labelText}>Nazwa</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="np. Santander" className={field} />
      </label>
      {!account && (
        <label className={label}>
          <span className={labelText}>Rodzaj</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)} className={field}>
            <option value="bank">Konto bankowe</option>
            <option value="broker">Konto maklerskie</option>
            <option value="cash">Gotówka</option>
          </select>
        </label>
      )}
      <label className={label}>
        <span className={labelText}>Saldo dziś (zł)</span>
        <input inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="puste = nie śledzę salda" className={field} />
        <span className="text-xs text-muted">Wpisz to, co widzisz teraz w banku. Kolejne transakcje będą je aktualizować.</span>
      </label>
      {problem && <p className="text-sm text-danger">{problem}</p>}
      <button type="button" onClick={save} className={btnPrimary}>
        Zapisz
      </button>
      {account && (
        <button
          type="button"
          onClick={() => {
            update.mutate({ id: account.id, archived: account.archivedAt === null }, { onError: (e) => toast({ message: errorMessage(e) }) });
            onClose();
          }}
          className={btnSecondary}
        >
          {account.archivedAt === null ? "Ukryj konto (zamknięte)" : "Przywróć konto"}
        </button>
      )}
    </div>
  );
}

export function AccountsScreen() {
  const { data: snapshot } = useSnapshot();
  const today = useToday(snapshot);
  const [editing, setEditing] = useState<Editing | null>(null);
  if (!snapshot || !today) return null;

  const worth = netWorth(snapshot.accounts, snapshot.transactions, today);
  const active = snapshot.accounts.filter((a) => a.archivedAt === null);
  const archived = snapshot.accounts.filter((a) => a.archivedAt !== null);
  const currentOf = (a: Account) => balanceOn(a, snapshot.transactions, today);

  const row = (a: Account) => {
    const b = currentOf(a);
    return (
      <li key={a.id}>
        <button type="button" onClick={() => setEditing({ mode: "edit", account: a })} className="flex w-full items-center gap-3.5 border-b border-border py-3 text-left">
          <AccountBadge name={a.name} institution={a.institution} />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{a.name}</span>
            <span className="block text-[13px] text-muted">{KIND_LABEL[a.kind]}</span>
          </span>
          <span className={b === null ? "text-sm font-semibold text-accent" : "font-semibold"}>{b === null ? "Wpisz saldo" : formatMoney(b)}</span>
        </button>
      </li>
    );
  };

  return (
    <main className="flex flex-col gap-5 px-5 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="font-serif text-[32px] font-semibold">Majątek</h1>
        <Link href="/settings" aria-label="Ustawienia" className="flex h-11 w-11 items-center justify-center">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
          </svg>
        </Link>
      </header>

      <section className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Razem</p>
        <p className="font-serif text-[44px] font-semibold leading-[1.05]">{formatMoney(worth.totalMinor, { cents: "never" })}</p>
        {worth.untracked > 0 && (
          <p className="text-sm text-muted">
            Bez {worth.untracked === 1 ? "1 konta" : `${worth.untracked} kont`}, dla których nie wpisano salda.
          </p>
        )}
      </section>

      <ul>{active.map(row)}</ul>

      <button type="button" onClick={() => setEditing({ mode: "new" })} className={btnSecondary}>
        Dodaj konto
      </button>

      {archived.length > 0 && (
        <details>
          <summary className="cursor-pointer py-2 text-sm text-muted">Ukryte konta ({archived.length})</summary>
          <ul>{archived.map(row)}</ul>
        </details>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing?.mode === "edit" ? editing.account.name : "Nowe konto"}>
        {editing && (
          <AccountEditor
            key={editing.mode === "edit" ? editing.account.id : "new"}
            editing={editing}
            current={editing.mode === "edit" ? currentOf(editing.account) : null}
            today={today}
            nextOrder={snapshot.accounts.length}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>
    </main>
  );
}
