"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/Toast";
import { snapshotKey, useAction } from "@/lib/data/hooks";
import { deleteTransaction, errorMessage, withoutTransaction } from "@/lib/data/mutations";
import type { Snapshot } from "@/lib/data/snapshot";
import { txTitle, type Transaction } from "@/lib/domain/model";

/**
 * Usuwanie bez confirm(): transakcja znika od razu, a z serwera dopiero gdy minie toast.
 * „Cofnij” przywraca ją bez żadnego zapisu w bazie.
 */
export function useDeleteWithUndo() {
  const qc = useQueryClient();
  const toast = useToast();
  const remove = useAction(deleteTransaction);

  return (tx: Transaction) => {
    const before = qc.getQueryData<Snapshot>(snapshotKey);
    if (before) qc.setQueryData<Snapshot>(snapshotKey, withoutTransaction(before, tx.id));
    toast({
      message: tx.kind === "transfer" ? "Usunięto przelew (obie strony)" : `Usunięto: ${txTitle(tx)}`,
      actionLabel: "Cofnij",
      onAction: () => {
        const now = qc.getQueryData<Snapshot>(snapshotKey);
        const restored = before?.transactions.filter((t) => t.id === tx.id || (tx.transferId !== null && t.transferId === tx.transferId)) ?? [];
        if (now) qc.setQueryData<Snapshot>(snapshotKey, { ...now, transactions: [...restored, ...now.transactions] });
      },
      onExpire: () => remove.mutate(tx.id, { onError: (e) => toast({ message: errorMessage(e) }) }),
    });
  };
}
