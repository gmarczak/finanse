"use client";

import Link from "next/link";
import { useState } from "react";
import { useOpenAdd } from "@/features/shell/AppShell";
import { useSnapshot, useToday } from "@/lib/data/hooks";
import { formatMoney, percent } from "@/lib/domain/money";
import { nextPeriod, periodLabel, periodOf, previousPeriod, type Period } from "@/lib/domain/period";
import { monthSummary, type CategoryLine, type LimitState } from "@/lib/domain/summary";
import { plural } from "@/lib/format";
import { CategoryBadge, UncategorizedBadge } from "@/lib/ui/icons";

const BAR: Record<LimitState, string> = {
  none: "var(--accent)",
  ok: "var(--accent)",
  warn: "var(--warn)",
  over: "var(--danger)",
};

function Line({ line, periodKey }: { line: CategoryLine; periodKey: string }) {
  const name = line.category?.name ?? "Bez kategorii";
  const ratio = line.limitMinor ? Math.min(1, line.spentMinor / line.limitMinor) : null;
  const tone = line.state === "warn" ? "text-warn" : line.state === "over" ? "text-danger" : "";
  const href = `/transactions?period=${periodKey}&category=${line.category?.id ?? "none"}`;
  return (
    <li>
      <Link href={href} className="flex items-center gap-3.5 py-2.5">
        {line.category ? <CategoryBadge icon={line.category.icon} color={line.category.color} name={name} /> : <UncategorizedBadge />}
        <span className="flex flex-1 flex-col gap-1.5">
          <span className="flex items-baseline justify-between gap-3">
            <span className="font-semibold">{name}</span>
            <span className={tone}>
              <strong>{formatMoney(line.spentMinor, { cents: "never" })}</strong>
              {line.limitMinor !== null && (
                <span className={`text-[13px] ${tone || "text-muted"}`}>
                  {" "}
                  z {formatMoney(line.limitMinor, { cents: "never" }).replace(/ zł$/, "")}
                  {line.state === "warn" || line.state === "over" ? ` · ${percent(line.spentMinor, line.limitMinor)}%` : ""}
                </span>
              )}
            </span>
          </span>
          {ratio !== null && (
            <span className="block h-1.5 overflow-hidden rounded-full bg-border" aria-hidden="true">
              <span className="block h-full rounded-full" style={{ width: `${ratio * 100}%`, background: BAR[line.state] }} />
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

export function MonthScreen() {
  const { data: snapshot } = useSnapshot();
  const today = useToday(snapshot);
  const openAdd = useOpenAdd();
  const [shown, setShown] = useState<Period | null>(null);
  if (!snapshot || !today) return null;

  const startDay = snapshot.settings.monthStartDay;
  const current = periodOf(today, startDay);
  const period = shown ?? current;
  const isCurrent = period.key === current.key;
  const s = monthSummary({ ...snapshot, period, today, startDay });
  const usedRatio = s.totalLimitMinor ? Math.min(1, s.spentMinor / s.totalLimitMinor) : null;
  const diff = s.previousToDateMinor === null ? null : s.spentMinor - s.previousToDateMinor;
  const empty = s.spentMinor === 0 && s.incomeMinor === 0;

  return (
    <main className="flex flex-col gap-5 px-5 pt-7">
      <header className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{periodLabel(period, startDay)}</p>
          <h1 className="font-serif text-[44px] font-semibold leading-[1.05]">{formatMoney(s.spentMinor, { cents: "never" })}</h1>
          <p className="text-sm text-muted">
            {s.totalLimitMinor !== null ? `wydane z ${formatMoney(s.totalLimitMinor, { cents: "never" })} limitów` : "wydane"}
            {s.incomeMinor > 0 && ` · wpływy ${formatMoney(s.incomeMinor, { cents: "never" })}`}
          </p>
        </div>
        <div className="flex">
          <button type="button" aria-label="Poprzedni miesiąc" onClick={() => setShown(previousPeriod(period, startDay))} className="flex h-11 w-11 items-center justify-center">
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Następny miesiąc"
            disabled={isCurrent}
            onClick={() => setShown(nextPeriod(period, startDay))}
            className="flex h-11 w-11 items-center justify-center disabled:text-control"
          >
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
      </header>

      {usedRatio !== null && s.remainingMinor !== null && (
        <section className="flex flex-col gap-2" aria-label="Wykorzystanie limitów">
          <div className="h-2.5 overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full" style={{ width: `${usedRatio * 100}%`, background: s.remainingMinor < 0 ? "var(--danger)" : "var(--accent)" }} />
          </div>
          <div className="flex justify-between text-sm text-muted">
            <span>
              {s.remainingMinor >= 0
                ? `Zostało ${formatMoney(s.remainingMinor, { cents: "never" })}`
                : `Ponad limit o ${formatMoney(-s.remainingMinor, { cents: "never" })}`}
              {isCurrent && s.daysLeft > 0 && ` na ${s.daysLeft} ${plural(s.daysLeft, "dzień", "dni", "dni")}`}
            </span>
            <span className="font-semibold text-text">{percent(s.spentMinor, s.totalLimitMinor ?? 0)}%</span>
          </div>
        </section>
      )}

      {isCurrent && diff !== null && diff !== 0 && (
        <p className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 text-sm">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={diff > 0 ? "rotate-180" : ""}>
            <path d="M12 5v14M19 12l-7 7-7-7" />
          </svg>
          <span>
            O <strong>{formatMoney(Math.abs(diff), { cents: "never" })} {diff < 0 ? "mniej" : "więcej"}</strong> niż w poprzednim miesiącu do tego dnia.
          </span>
        </p>
      )}

      {s.uncategorizedCount > 0 && isCurrent && (
        <Link href="/transactions?category=none" className="rounded-2xl px-4 py-3 text-sm font-semibold" style={{ background: "var(--c-amber-bg)", color: "var(--c-amber-fg)" }}>
          {s.uncategorizedCount} {plural(s.uncategorizedCount, "transakcja czeka", "transakcje czekają", "transakcji czeka")} na kategorię →
        </Link>
      )}

      {empty ? (
        <section className="flex flex-col items-start gap-3 rounded-2xl bg-surface px-5 py-5">
          <h2 className="font-serif text-xl font-semibold">{isCurrent ? "Pusto w tym miesiącu" : "Brak transakcji w tym miesiącu"}</h2>
          {isCurrent && (
            <>
              <p className="text-sm text-muted">Dodaj pierwszy wydatek przyciskiem „+” na dole — zajmie to 3 sekundy.</p>
              <button type="button" onClick={() => openAdd()} className="h-11 rounded-full bg-accent px-5 font-semibold text-accent-contrast">
                Dodaj wydatek
              </button>
            </>
          )}
        </section>
      ) : (
        <section aria-labelledby="cats" className="flex flex-col">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 id="cats" className="font-serif text-[22px] font-semibold">
              Kategorie
            </h2>
            <Link href={`/transactions?period=${period.key}`} className="text-sm font-semibold text-accent">
              Wszystkie
            </Link>
          </div>
          <ul>
            {s.lines.map((line) => (
              <Line key={line.category?.id ?? "none"} line={line} periodKey={period.key} />
            ))}
          </ul>
          {s.totalLimitMinor === null && (
            <Link href="/plan" className="mt-2 text-sm font-semibold text-accent">
              Ustaw limity kategorii →
            </Link>
          )}
        </section>
      )}
    </main>
  );
}
