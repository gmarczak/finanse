import type { LocalDate } from "./dates";
import type { Account, Transaction } from "./model";
import type { Minor } from "./money";

/**
 * Saldo konta w dniu `on` (włącznie), liczone od salda znanego w dniu `anchorOn`:
 * transakcje po dniu kotwicy dodajemy, transakcje między `on` a kotwicą odejmujemy.
 * Dzięki temu import starszej historii nie zmienia dzisiejszego salda.
 * null, gdy saldo konta nie jest śledzone.
 */
export function balanceOn(account: Account, transactions: Transaction[], on: LocalDate): Minor | null {
  if (account.anchorBalanceMinor === null || account.anchorOn === null) return null;
  let balance = account.anchorBalanceMinor;
  for (const t of transactions) {
    if (t.accountId !== account.id) continue;
    if (t.bookedOn > account.anchorOn && t.bookedOn <= on) balance += t.amountPlnMinor;
    else if (t.bookedOn <= account.anchorOn && t.bookedOn > on) balance -= t.amountPlnMinor;
  }
  return balance;
}

export type NetWorth = { totalMinor: Minor; tracked: number; untracked: number };

export function netWorth(accounts: Account[], transactions: Transaction[], on: LocalDate): NetWorth {
  let total = 0;
  let tracked = 0;
  let untracked = 0;
  for (const a of accounts) {
    if (a.archivedAt !== null) continue;
    const b = balanceOn(a, transactions, on);
    if (b === null) untracked++;
    else {
      total += b;
      tracked++;
    }
  }
  return { totalMinor: total, tracked, untracked };
}
