"use client";

import { useState } from "react";
import { btnPrimary, field } from "@/components/ui/styles";
import { useAction } from "@/lib/data/hooks";
import { addAccounts, errorMessage, type AccountForm } from "@/lib/data/mutations";
import type { Snapshot } from "@/lib/data/snapshot";
import type { LocalDate } from "@/lib/domain/dates";
import type { AccountKind } from "@/lib/domain/model";
import { parseAmount } from "@/lib/domain/money";
import { AccountBadge } from "@/lib/ui/icons";

type Preset = { key: string; name: string; kind: AccountKind; institution: string | null; hint: string };

const PRESETS: Preset[] = [
  { key: "revolut", name: "Revolut", kind: "bank", institution: "revolut", hint: "karta i konto" },
  { key: "pekao", name: "Pekao", kind: "bank", institution: "pekao", hint: "konto osobiste" },
  { key: "xtb", name: "XTB", kind: "broker", institution: "xtb", hint: "konto maklerskie" },
  { key: "mbank", name: "mBank", kind: "bank", institution: "mbank", hint: "konto osobiste" },
  { key: "pko", name: "PKO BP", kind: "bank", institution: "pko", hint: "konto osobiste" },
  { key: "ing", name: "ING", kind: "bank", institution: "ing", hint: "konto osobiste" },
  { key: "cash", name: "Gotówka", kind: "cash", institution: "cash", hint: "portfel" },
];

/** Pierwsze uruchomienie: wybór kont. Saldo jest opcjonalne — bez niego aplikacja liczy tylko wydatki. */
export function Onboarding({ snapshot, today }: { snapshot: Snapshot; today: LocalDate }) {
  const [picked, setPicked] = useState<Record<string, string>>({}); // klucz → wpisane saldo
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useAction((supabase, forms: AccountForm[]) => addAccounts(supabase, forms, 0));

  const toggle = (key: string) =>
    setPicked((p) => {
      const next = { ...p };
      if (key in next) delete next[key];
      else next[key] = "";
      return next;
    });

  function submit() {
    const forms: AccountForm[] = [];
    for (const preset of PRESETS) {
      if (!(preset.key in picked)) continue;
      const raw = picked[preset.key]!.trim();
      const balance = raw === "" ? null : parseAmount(raw);
      if (raw !== "" && balance === null) return setError(`Nie rozumiem salda dla ${preset.name}. Wpisz np. 1 250,00.`);
      forms.push({ name: preset.name, kind: preset.kind, institution: preset.institution, balanceMinor: balance, balanceOn: today });
    }
    if (custom.trim()) forms.push({ name: custom.trim(), kind: "bank", institution: null, balanceMinor: null, balanceOn: today });
    if (forms.length === 0) return setError("Wybierz przynajmniej jedno konto.");
    setError(null);
    create.mutate(forms, { onError: (e) => setError(errorMessage(e)) });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col gap-6 px-5 pb-10 pt-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl font-semibold">Skąd płacisz?</h1>
        <p className="text-muted">
          Zaznacz swoje konta. Saldo możesz wpisać od razu albo później — bez niego Finanse i tak policzą wydatki.
          {snapshot.email && <span className="block text-sm">Zalogowano jako {snapshot.email}.</span>}
        </p>
      </div>

      <ul className="flex flex-col">
        {PRESETS.map((p) => {
          const on = p.key in picked;
          return (
            <li key={p.key} className="border-b border-border py-2">
              <button type="button" aria-pressed={on} onClick={() => toggle(p.key)} className="flex w-full items-center gap-3.5 py-1.5 text-left">
                <AccountBadge name={p.name} institution={p.institution} />
                <span className="flex flex-1 flex-col">
                  <span className="text-[17px] font-semibold">{p.name}</span>
                  <span className="text-[13px] text-muted">{p.hint}</span>
                </span>
                <span aria-hidden="true" className={`flex h-11 w-11 items-center justify-center rounded-full ${on ? "bg-accent text-accent-contrast" : "border-[1.5px] border-control"}`}>
                  {on && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12l5 5 9-10" />
                    </svg>
                  )}
                </span>
              </button>
              {on && (
                <label className="mb-1 ml-[54px] flex items-center gap-2">
                  <span className="text-sm text-muted">{p.kind === "broker" ? "Wartość dziś" : "Saldo dziś"}</span>
                  <input
                    inputMode="decimal"
                    placeholder="opcjonalnie"
                    value={picked[p.key]}
                    onChange={(e) => setPicked((s) => ({ ...s, [p.key]: e.target.value }))}
                    className="h-10 w-36 rounded-xl border border-border bg-surface px-3 text-right"
                  />
                  <span className="text-sm text-muted">zł</span>
                </label>
              )}
            </li>
          );
        })}
      </ul>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">Inne konto</span>
        <input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={40} placeholder="np. Santander" className={field} />
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}
      <button type="button" onClick={submit} disabled={create.isPending} className={btnPrimary}>
        {create.isPending ? "Zapisuję…" : "Gotowe"}
      </button>
    </main>
  );
}
