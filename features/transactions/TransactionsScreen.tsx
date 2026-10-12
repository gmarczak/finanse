"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useAction, useSnapshot, useToday } from "@/lib/data/hooks";
import { updateTransaction, withPatch } from "@/lib/data/mutations";
import { txTitle, type Category, type Transaction } from "@/lib/domain/model";
import { formatMoney } from "@/lib/domain/money";
import { periodByKey, periodLabel, periodOf } from "@/lib/domain/period";
import { formatDayHeading } from "@/lib/format";
import { CategoryBadge, UncategorizedBadge } from "@/lib/ui/icons";
import { TransactionSheet } from "./TransactionSheet";
import { useDeleteWithUndo } from "./useDeleteWithUndo";

const filterClass = "h-9 max-w-[11rem] shrink-0 truncate rounded-full border border-border bg-transparent px-3 text-[13px] font-medium text-text";

function TransferBadge() {
  return (
    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--c-slate-bg)", color: "var(--c-slate-fg)" }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m16 3 4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16" />
      </svg>
    </span>
  );
}

export function TransactionsScreen() {
  const { data: snapshot } = useSnapshot();
  const today = useToday(snapshot);
  const params = useSearchParams();
  const router = useRouter();
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [query, setQuery] = useState("");
  const onDelete = useDeleteWithUndo();
  const assign = useAction(updateTransaction, withPatch);

  const startDay = snapshot?.settings.monthStartDay ?? 1;
  const periodKey = params.get("period") ?? (today ? periodOf(today, startDay).key : "");
  const accountId = params.get("account") ?? "";
  const categoryFilter = params.get("category") ?? "";

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/transactions?${next.toString()}`, { scroll: false });
  };

  // Okresy, w których są transakcje (+ bieżący), od najnowszego
  const periods = useMemo(() => {
    if (!snapshot || !today) return [];
    const keys = new Set([periodOf(today, startDay).key, ...snapshot.transactions.map((t) => periodOf(t.bookedOn, startDay).key)]);
    return [...keys].sort().reverse().map((k) => periodByKey(k, startDay));
  }, [snapshot, today, startDay]);

  const categoriesById = useMemo(() => new Map((snapshot?.categories ?? []).map((c) => [c.id, c])), [snapshot]);
  const accountsById = useMemo(() => new Map((snapshot?.accounts ?? []).map((a) => [a.id, a])), [snapshot]);

  // Najczęstsze kategorie wydatków: szybkie przyciski przy „do skategoryzowania”
  const quickCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of snapshot?.transactions ?? []) if (t.kind === "expense" && t.categoryId) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
    const expense = (snapshot?.categories ?? []).filter((c) => c.kind === "expense" && c.archivedAt === null);
    return [...expense].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.sortOrder - b.sortOrder).slice(0, 3);
  }, [snapshot]);

  if (!snapshot || !today) return null;

  const period = periodKey === "all" ? null : periodByKey(periodKey, startDay);
  const q = query.trim().toLowerCase();
  const visible = snapshot.transactions.filter((t) => {
    if (period && (t.bookedOn < period.from || t.bookedOn > period.to)) return false;
    if (accountId && t.accountId !== accountId) return false;
    // Bez filtra konta przelew to jeden wiersz (noga wychodząca), z filtrem — noga tego konta
    if (!accountId && t.kind === "transfer" && t.amountMinor > 0) return false;
    if (categoryFilter === "none" && (t.categoryId !== null || t.kind === "transfer")) return false;
    if (categoryFilter && categoryFilter !== "none" && t.categoryId !== categoryFilter) return false;
    if (q && !`${t.description ?? ""} ${t.bankDescription ?? ""} ${t.note ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const sorted = [...visible].sort((a, b) => (a.bookedOn === b.bookedOn ? (a.createdAt < b.createdAt ? 1 : -1) : a.bookedOn < b.bookedOn ? 1 : -1));
  const uncategorized = sorted.filter((t) => t.kind !== "transfer" && t.categoryId === null);
  const first = categoryFilter === "none" ? undefined : uncategorized[0];
  const spent = visible.reduce((s, t) => (t.kind === "expense" ? s - t.amountPlnMinor : s), 0);
  const income = visible.reduce((s, t) => (t.kind === "income" ? s + t.amountPlnMinor : s), 0);

  const days: { date: string; items: Transaction[] }[] = [];
  for (const t of sorted) {
    const last = days[days.length - 1];
    if (last && last.date === t.bookedOn) last.items.push(t);
    else days.push({ date: t.bookedOn, items: [t] });
  }

  const transferMeta = (t: Transaction) => {
    const other = snapshot.transactions.find((x) => x.transferId === t.transferId && x.id !== t.id);
    const from = accountsById.get(t.amountMinor < 0 ? t.accountId : (other?.accountId ?? ""))?.name ?? "?";
    const to = accountsById.get(t.amountMinor < 0 ? (other?.accountId ?? "") : t.accountId)?.name ?? "?";
    return `${from} → ${to} · nie liczy się do wydatków`;
  };

  const badge = (t: Transaction, c: Category | undefined) =>
    t.kind === "transfer" ? <TransferBadge /> : c ? <CategoryBadge icon={c.icon} color={c.color} name={c.name} /> : <UncategorizedBadge />;

  return (
    <main className="flex flex-col gap-4 px-5 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="font-serif text-[32px] font-semibold">Transakcje</h1>
      </header>

      <label className="block">
        <span className="sr-only">Szukaj</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Szukaj w opisach" className="h-11 w-full rounded-full border border-border bg-surface px-4 text-[15px] placeholder:text-muted" />
      </label>

      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
        <label>
          <span className="sr-only">Okres</span>
          <select value={periodKey} onChange={(e) => setParam("period", e.target.value)} className={filterClass}>
            {periods.map((p) => (
              <option key={p.key} value={p.key}>
                {periodLabel(p, startDay)}
              </option>
            ))}
            <option value="all">Wszystko</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Konto</span>
          <select value={accountId} onChange={(e) => setParam("account", e.target.value)} className={filterClass}>
            <option value="">Wszystkie konta</option>
            {snapshot.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Kategoria</span>
          <select value={categoryFilter} onChange={(e) => setParam("category", e.target.value)} className={filterClass}>
            <option value="">Wszystkie kategorie</option>
            <option value="none">Bez kategorii</option>
            {snapshot.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {first && (
        <section aria-label="Do skategoryzowania" className="flex flex-col gap-2.5 rounded-2xl px-4 py-3.5" style={{ background: "var(--c-amber-bg)" }}>
          <div className="flex justify-between text-[13px] font-semibold" style={{ color: "var(--c-amber-fg)" }}>
            <span>DO SKATEGORYZOWANIA · {uncategorized.length}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-semibold">{txTitle(first)}</div>
              <div className="text-[13px] text-muted">
                {accountsById.get(first.accountId)?.name} · {formatDayHeading(first.bookedOn, today)}
              </div>
            </div>
            <strong className="shrink-0">{formatMoney(first.amountPlnMinor)}</strong>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(first.kind === "income" ? snapshot.categories.filter((c) => c.kind === "income" && c.archivedAt === null).slice(0, 3) : quickCategories).map((c) => (
              <button key={c.id} type="button" onClick={() => assign.mutate({ id: first.id, categoryId: c.id })} className="h-9 rounded-full bg-bg px-3 text-[13px] font-medium">
                {c.name}
              </button>
            ))}
            <button type="button" onClick={() => setEditing(first)} className="h-9 rounded-full bg-bg px-3 text-[13px] font-medium">
              Inna…
            </button>
          </div>
        </section>
      )}

      {visible.length > 0 && (
        <p className="text-sm text-muted">
          Wydatki <strong className="text-text">{formatMoney(spent)}</strong>
          {income > 0 && (
            <>
              {" "}
              · wpływy <strong className="text-text">{formatMoney(income)}</strong>
            </>
          )}
        </p>
      )}

      {days.length === 0 ? (
        <p className="py-8 text-center text-muted">Brak transakcji dla tych filtrów.</p>
      ) : (
        <div>
          {days.map((day) => (
            <section key={day.date} aria-label={formatDayHeading(day.date, today)}>
              <h2 className="mb-0.5 mt-3 text-xs font-semibold uppercase tracking-[0.06em] text-muted">{formatDayHeading(day.date, today)}</h2>
              <ul>
                {day.items.map((t) => {
                  const c = t.categoryId ? categoriesById.get(t.categoryId) : undefined;
                  const account = accountsById.get(t.accountId);
                  const meta =
                    t.kind === "transfer"
                      ? transferMeta(t)
                      : [c?.name ?? "Bez kategorii", account?.name, t.source === "manual" ? null : "z importu"].filter(Boolean).join(" · ");
                  return (
                    <li key={t.id}>
                      <button type="button" onClick={() => setEditing(t)} className="flex w-full items-center gap-3.5 py-2.5 text-left">
                        {badge(t, c)}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{txTitle(t)}</span>
                          <span className="block truncate text-[13px] text-muted">{meta}</span>
                        </span>
                        <span className={`shrink-0 font-semibold ${t.kind === "income" ? "text-accent" : t.kind === "transfer" ? "text-muted" : ""}`}>
                          {formatMoney(t.kind === "transfer" ? Math.abs(t.amountMinor) : t.amountMinor, { plusSign: t.kind === "income", currency: t.currency })}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <TransactionSheet tx={editing} snapshot={snapshot} today={today} onClose={() => setEditing(null)} onDelete={onDelete} />
    </main>
  );
}
