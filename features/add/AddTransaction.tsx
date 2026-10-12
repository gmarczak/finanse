"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { useToast } from "@/components/ui/Toast";
import { btnPrimary } from "@/components/ui/styles";
import { useAction, useDraftMutation } from "@/lib/data/hooks";
import { deleteTransaction, newId, withoutTransaction, type TxDraft } from "@/lib/data/mutations";
import type { Snapshot } from "@/lib/data/snapshot";
import type { LocalDate } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { formatPickerDate } from "@/lib/format";
import { CategoryGrid } from "./CategoryGrid";
import { amountMinorOf, displayAmount, pressKey } from "./amountInput";

export type AddType = "expense" | "income" | "transfer";
export type AddPreset = { type?: AddType; categoryId?: string };

const TYPES: { value: AddType; label: string }[] = [
  { value: "expense", label: "Wydatek" },
  { value: "income", label: "Przychód" },
  { value: "transfer", label: "Przelew" },
];

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "back"] as const;

type Props = { snapshot: Snapshot; today: LocalDate; preset?: AddPreset; onDone: () => void };

/** Dodanie transakcji w 3 sekundy: kwota z klawiatury, kategoria jednym kliknięciem, konto i data domyślnie ostatnie. */
export function AddTransaction({ snapshot, today, preset, onDone }: Props) {
  const accounts = useMemo(() => snapshot.accounts.filter((a) => a.archivedAt === null), [snapshot.accounts]);
  // Domyślne konto: to z ostatnio wpisanej ręcznie transakcji
  const lastAccountId = useMemo(() => {
    const last = [...snapshot.transactions].filter((t) => t.source === "manual" && t.kind !== "transfer").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    return last && accounts.some((a) => a.id === last.accountId) ? last.accountId : (accounts[0]?.id ?? "");
  }, [snapshot.transactions, accounts]);

  const [type, setType] = useState<AddType>(preset?.type ?? "expense");
  const [text, setText] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(preset?.categoryId ?? null);
  const [accountId, setAccountId] = useState(lastAccountId);
  const [toAccountId, setToAccountId] = useState(() => accounts.find((a) => a.id !== lastAccountId)?.id ?? "");
  const [date, setDate] = useState<LocalDate>(today);
  const [description, setDescription] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const mutation = useDraftMutation();
  const undo = useAction(deleteTransaction, withoutTransaction);
  const toast = useToast();
  const amount = amountMinorOf(text);

  function press(key: string) {
    setText((t) => pressKey(t, key));
    setProblem(null);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (/^\d$/.test(e.key) || e.key === "," || e.key === ".") press(e.key);
    else if (e.key === "Backspace") press("back");
    else return;
    e.preventDefault();
  }

  function switchType(next: AddType) {
    setType(next);
    setCategoryId(null);
    setProblem(null);
  }

  function save() {
    if (amount <= 0) return setProblem("Wpisz kwotę.");
    if (type === "transfer" && (!toAccountId || toAccountId === accountId)) return setProblem("Wybierz dwa różne konta.");
    const id = newId();
    const desc = description.trim() || null;
    const draft: TxDraft =
      type === "transfer"
        ? { type, id, fromAccountId: accountId, toAccountId, bookedOn: date, amountMinor: amount, description: desc }
        : { type, id, accountId, bookedOn: date, amountMinor: amount, categoryId, description: desc, note: null };
    mutation.mutate(draft);
    const label = type === "expense" ? formatMoney(-amount) : type === "income" ? formatMoney(amount, { plusSign: true }) : `Przelew ${formatMoney(amount)}`;
    toast({ message: `Zapisano: ${label}`, actionLabel: "Cofnij", onAction: () => undo.mutate(id) });
    onDone();
  }

  const select = "h-11 rounded-full border border-border bg-transparent px-3 text-sm font-medium text-text";

  return (
    <div onKeyDown={onKeyDown} className="flex flex-col gap-4">
      <div role="group" aria-label="Rodzaj" className="flex self-center rounded-full bg-surface p-1">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-pressed={type === t.value}
            onClick={() => switchType(t.value)}
            className={`h-9 rounded-full px-4 text-sm ${type === t.value ? "bg-bg font-semibold text-text" : "font-medium text-muted"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <output aria-live="polite" aria-label="Kwota" className="text-center font-serif text-5xl font-semibold leading-none">
        <span className={text === "" ? "text-muted" : ""}>{displayAmount(text)}</span> <span className="text-3xl text-muted">zł</span>
      </output>

      <label className="block">
        <span className="sr-only">Opis</span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={200}
          placeholder={type === "transfer" ? "Opis (opcjonalnie), np. Na XTB" : "Opis (opcjonalnie), np. Biedronka"}
          className="h-11 w-full border-0 border-b border-border bg-transparent text-center text-[15px] placeholder:text-muted"
        />
      </label>

      {type !== "transfer" && <CategoryGrid categories={snapshot.categories} kind={type} value={categoryId} onChange={setCategoryId} />}

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5">
          <span className="sr-only">{type === "transfer" ? "Z konta" : "Konto"}</span>
          {type === "transfer" && <span className="text-sm text-muted">z</span>}
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={select}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {type === "transfer" && (
          <label className="flex items-center gap-1.5">
            <span className="text-sm text-muted">na</span>
            <span className="sr-only">Na konto</span>
            <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} className={select}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="relative">
          <span className="sr-only">Data</span>
          <span aria-hidden="true" className={`${select} pointer-events-none inline-flex items-center`}>
            {formatPickerDate(date, today)}
          </span>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            aria-label={k === "back" ? "Usuń cyfrę" : k === "," ? "Przecinek" : undefined}
            className="h-[52px] rounded-2xl bg-surface text-[22px] font-medium active:opacity-70"
          >
            {k === "back" ? (
              <svg aria-hidden="true" className="mx-auto" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 5a2 2 0 0 0-1.3.5l-6.4 5.8a1 1 0 0 0 0 1.4l6.4 5.8A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" />
                <path d="m12 9 6 6M18 9l-6 6" />
              </svg>
            ) : (
              k
            )}
          </button>
        ))}
      </div>

      {problem && <p className="text-center text-sm text-danger">{problem}</p>}
      <button type="button" onClick={save} className={btnPrimary}>
        {amount > 0 ? `Zapisz ${formatMoney(amount)}` : "Zapisz"}
      </button>
    </div>
  );
}
