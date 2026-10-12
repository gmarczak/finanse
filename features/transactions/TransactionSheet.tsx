"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { btnDanger, btnPrimary, field, label, labelText } from "@/components/ui/styles";
import { CategoryGrid } from "@/features/add/CategoryGrid";
import { textOfMinor } from "@/features/add/amountInput";
import { useAction } from "@/lib/data/hooks";
import { errorMessage, updateTransaction, withPatch, type TxPatch } from "@/lib/data/mutations";
import type { Snapshot } from "@/lib/data/snapshot";
import type { LocalDate } from "@/lib/domain/dates";
import { txTitle, type Transaction } from "@/lib/domain/model";
import { formatMoney, parseAmount } from "@/lib/domain/money";
import { formatLongDate } from "@/lib/format";

type Props = { tx: Transaction | null; snapshot: Snapshot; today: LocalDate; onClose: () => void; onDelete: (tx: Transaction) => void };

export function TransactionSheet({ tx, snapshot, today, onClose, onDelete }: Props) {
  return (
    <Modal open={tx !== null} onClose={onClose} title={tx ? txTitle(tx) : ""} subtitle={tx ? formatLongDate(tx.bookedOn) : undefined}>
      {tx && <Editor key={tx.id} tx={tx} snapshot={snapshot} today={today} onClose={onClose} onDelete={onDelete} />}
    </Modal>
  );
}

function Editor({ tx, snapshot, today, onClose, onDelete }: Omit<Props, "tx"> & { tx: Transaction }) {
  const isTransfer = tx.kind === "transfer";
  const canEditAmount = !isTransfer && tx.currency === "PLN";
  const [categoryId, setCategoryId] = useState(tx.categoryId);
  const [description, setDescription] = useState(tx.description ?? "");
  const [note, setNote] = useState(tx.note ?? "");
  const [date, setDate] = useState(tx.bookedOn);
  const [amount, setAmount] = useState(textOfMinor(tx.amountMinor));
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();
  const update = useAction(updateTransaction, withPatch);
  const account = snapshot.accounts.find((a) => a.id === tx.accountId);
  const other = isTransfer ? snapshot.transactions.find((t) => t.transferId === tx.transferId && t.id !== tx.id) : undefined;
  const otherAccount = other && snapshot.accounts.find((a) => a.id === other.accountId);

  function save() {
    const patch: TxPatch = { id: tx.id };
    if (categoryId !== tx.categoryId) patch.categoryId = categoryId;
    if (description.trim() !== (tx.description ?? "")) patch.description = description;
    if (note.trim() !== (tx.note ?? "")) patch.note = note;
    if (date !== tx.bookedOn && !isTransfer) patch.bookedOn = date;
    if (canEditAmount) {
      const parsed = parseAmount(amount);
      if (parsed === null || parsed <= 0) return setProblem("Wpisz kwotę większą od zera, np. 38,50.");
      const signed = tx.kind === "expense" ? -parsed : parsed;
      if (signed !== tx.amountMinor) patch.amountMinor = signed;
    }
    if (Object.keys(patch).length > 1) update.mutate(patch, { onError: (e) => toast({ message: errorMessage(e) }) });
    onClose();
  }

  function destroy() {
    onDelete(tx);
    onClose();
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        {isTransfer
          ? `Przelew ${tx.amountMinor < 0 ? `z ${account?.name ?? "?"} na ${otherAccount?.name ?? "?"}` : `z ${otherAccount?.name ?? "?"} na ${account?.name ?? "?"}`} · nie liczy się do wydatków`
          : `${account?.name ?? "Konto"} · ${tx.source === "import" ? "z importu" : "wpisane ręcznie"}`}
        {tx.bankDescription && <span className="mt-1 block break-words text-xs">Opis z banku: {tx.bankDescription}</span>}
      </p>

      {canEditAmount ? (
        <label className={label}>
          <span className={labelText}>Kwota (zł)</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} />
        </label>
      ) : (
        <p className="font-serif text-3xl font-semibold">{formatMoney(tx.amountMinor, { currency: tx.currency, plusSign: true })}</p>
      )}

      {!isTransfer && (
        <div className="flex flex-col gap-2">
          <span className={labelText}>Kategoria</span>
          <CategoryGrid categories={snapshot.categories} kind={tx.kind === "income" ? "income" : "expense"} value={categoryId} onChange={setCategoryId} />
        </div>
      )}

      <label className={label}>
        <span className={labelText}>Opis</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder={tx.bankDescription ?? "np. Biedronka"} className={field} />
      </label>

      {!isTransfer && (
        <label className={label}>
          <span className={labelText}>Data</span>
          <input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className={field} />
        </label>
      )}

      <label className={label}>
        <span className={labelText}>Notatka</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} placeholder="opcjonalnie" className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base placeholder:text-muted" />
      </label>

      {problem && <p className="text-sm text-danger">{problem}</p>}
      <button type="button" onClick={save} className={btnPrimary}>
        Zapisz
      </button>
      <button type="button" onClick={destroy} className={btnDanger}>
        {isTransfer ? "Usuń przelew" : "Usuń transakcję"}
      </button>
    </div>
  );
}
