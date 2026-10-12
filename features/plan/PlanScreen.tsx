"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { textOfMinor } from "@/features/add/amountInput";
import { useAction, useSnapshot, useToday } from "@/lib/data/hooks";
import { errorMessage, setBudget } from "@/lib/data/mutations";
import type { Snapshot } from "@/lib/data/snapshot";
import type { Category } from "@/lib/domain/model";
import { formatMoney, parseAmount, percent } from "@/lib/domain/money";
import { periodLabel, periodOf, type Period } from "@/lib/domain/period";
import { limitFor, limitState, monthSummary, WARN_RATIO } from "@/lib/domain/summary";
import { CategoryBadge } from "@/lib/ui/icons";

function LimitRow({ category, spent, limit, period }: { category: Category; spent: number; limit: number | null; period: Period }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(limit ? textOfMinor(limit) : "");
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();
  const save = useAction(setBudget, (s: Snapshot, input) => ({
    ...s,
    budgets: [...s.budgets.filter((b) => !(b.categoryId === input.categoryId && b.validFrom === input.month)), { categoryId: input.categoryId, validFrom: input.month, amountMinor: input.amountMinor }],
  }));
  const state = limitState(spent, limit);
  const color = state === "over" ? "var(--danger)" : state === "warn" ? "var(--warn)" : "var(--accent)";

  function submit() {
    const value = text.trim() === "" ? 0 : parseAmount(text);
    if (value === null || value < 0) return setProblem("Wpisz kwotę, np. 800.");
    save.mutate({ categoryId: category.id, month: `${period.key}-01`, amountMinor: value }, { onError: (e) => toast({ message: errorMessage(e) }) });
    setEditing(false);
    setProblem(null);
  }

  return (
    <li className="border-b border-border py-3">
      <div className="flex items-center gap-3.5">
        <CategoryBadge icon={category.icon} color={category.color} name={category.name} size="sm" />
        <span className="flex-1 font-semibold">{category.name}</span>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="flex h-11 items-center text-sm" aria-label={`Limit dla ${category.name}`}>
            {limit !== null ? (
              <span>
                {formatMoney(spent, { cents: "never" }).replace(/ zł$/, "")} <span className="text-muted">/ {formatMoney(limit, { cents: "never" })}</span>
              </span>
            ) : (
              <span className="font-semibold text-accent">Ustaw limit</span>
            )}
          </button>
        )}
      </div>
      {limit !== null && !editing && (
        <div className="ml-[46px] mt-1 h-1.5 overflow-hidden rounded-full bg-border" aria-hidden="true">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, percent(spent, limit))}%`, background: color }} />
        </div>
      )}
      {editing && (
        <form
          className="ml-[46px] mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="flex items-center gap-2">
            <span className="sr-only">Limit miesięczny w zł</span>
            <input autoFocus inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder="np. 800" className="h-11 w-28 rounded-xl border border-border bg-surface px-3 text-right" />
            <span className="text-sm text-muted">zł / mies.</span>
          </label>
          <button type="submit" className="h-11 rounded-full bg-accent px-4 text-sm font-semibold text-accent-contrast">
            Zapisz
          </button>
          <button type="button" onClick={() => setEditing(false)} className="h-11 px-2 text-sm text-muted">
            Anuluj
          </button>
        </form>
      )}
      {problem && <p className="ml-[46px] mt-1 text-sm text-danger">{problem}</p>}
    </li>
  );
}

export function PlanScreen() {
  const { data: snapshot } = useSnapshot();
  const today = useToday(snapshot);
  if (!snapshot || !today) return null;
  const startDay = snapshot.settings.monthStartDay;
  const period = periodOf(today, startDay);
  const summary = monthSummary({ ...snapshot, period, today, startDay });
  const spentOf = (id: string) => summary.lines.find((l) => l.category?.id === id)?.spentMinor ?? 0;
  const categories = snapshot.categories.filter((c) => c.kind === "expense" && c.archivedAt === null);

  return (
    <main className="flex flex-col gap-6 px-5 pt-6">
      <h1 className="font-serif text-[32px] font-semibold">Plan</h1>

      <section aria-labelledby="limits">
        <h2 id="limits" className="font-serif text-[22px] font-semibold">
          Limity · {periodLabel(period, startDay)}
        </h2>
        <p className="mt-1 text-sm text-muted">
          Limit obowiązuje od tego miesiąca w kolejnych, aż go zmienisz. Kolor ostrzega od {Math.round(WARN_RATIO * 100)}%. Puste pole = bez limitu.
        </p>
        <ul className="mt-2">
          {categories.map((c) => (
            <LimitRow key={c.id} category={c} spent={spentOf(c.id)} limit={limitFor(snapshot.budgets, c.id, period)} period={period} />
          ))}
        </ul>
      </section>

      <section className="rounded-2xl bg-surface px-4 py-4 text-sm">
        <h2 className="font-serif text-lg font-semibold">Subskrypcje i cele</h2>
        <p className="mt-1 text-muted">Lista subskrypcji z przypomnieniem przed opłatą i cele oszczędnościowe pojawią się w kolejnej wersji.</p>
      </section>
    </main>
  );
}
