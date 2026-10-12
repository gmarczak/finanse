"use client";

import { useQueryClient } from "@tanstack/react-query";
import { del } from "idb-keyval";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { btnSecondary, field, label, labelText, sectionTitle } from "@/components/ui/styles";
import { PasswordForm } from "@/features/auth/PasswordForm";
import { useAction, useSnapshot } from "@/lib/data/hooks";
import { errorMessage, saveSettings } from "@/lib/data/mutations";
import type { Snapshot } from "@/lib/data/snapshot";
import { supabaseBrowser } from "@/lib/db/client";
import { applyTheme, readTheme, THEMES, type Theme } from "@/lib/theme";

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

export function SettingsScreen() {
  const { data: snapshot } = useSnapshot();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- wybór zapisany w przeglądarce, dostępny dopiero po zamontowaniu
  useEffect(() => setTheme(readTheme()), []);
  const save = useAction(saveSettings, (s: Snapshot, input) => ({
    ...s,
    settings: { ...s.settings, ...(input.monthStartDay !== undefined && { monthStartDay: input.monthStartDay }) },
  }));
  if (!snapshot) return null;

  async function signOut() {
    setSigningOut(true);
    await supabaseBrowser().auth.signOut();
    qc.clear();
    await del("finanse-cache"); // dane finansowe nie zostają w telefonie po wylogowaniu
    router.replace("/login");
    router.refresh();
  }

  return (
    <main className="flex flex-col gap-8 px-5 pt-6">
      <header className="flex items-center gap-1">
        <Link href="/accounts" aria-label="Wróć" className="-ml-3 flex h-11 w-11 items-center justify-center">
          <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <h1 className="font-serif text-[32px] font-semibold">Ustawienia</h1>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className={sectionTitle}>Miesiąc</h2>
        <label className={label}>
          <span className={labelText}>Miesiąc zaczyna się</span>
          <select
            value={snapshot.settings.monthStartDay}
            onChange={(e) => save.mutate({ monthStartDay: Number(e.target.value) }, { onError: (err) => toast({ message: errorMessage(err) }) })}
            className={field}
          >
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {d === 1 ? "1. dnia (kalendarzowo)" : `${d}. dnia (np. od wypłaty)`}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">Podsumowanie i limity liczą się od tego dnia do dnia przed nim w kolejnym miesiącu.</span>
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={sectionTitle}>Wygląd</h2>
        <div role="radiogroup" aria-label="Motyw" className="flex rounded-full bg-surface p-1">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={theme === t.value}
              onClick={() => {
                applyTheme(t.value);
                setTheme(t.value);
              }}
              className={`h-10 flex-1 rounded-full text-sm ${theme === t.value ? "bg-bg font-semibold text-text" : "font-medium text-muted"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted">Zapisane na tym urządzeniu.</span>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={sectionTitle}>Konto</h2>
        <p className="text-sm">
          Zalogowano jako <strong>{snapshot.email}</strong>. To samo konto co w Nawykach.
        </p>
        <PasswordForm />
        <button type="button" onClick={() => void signOut()} disabled={signingOut} className={`${btnSecondary} self-start`}>
          {signingOut ? "Wylogowuję…" : "Wyloguj"}
        </button>
      </section>

      <section className="flex flex-col gap-2 pb-6 text-sm text-muted">
        <h2 className={`${sectionTitle} text-text`}>O aplikacji</h2>
        <p>Finanse — siostrzana aplikacja Nawyków. Twoje dane są w Twojej bazie, widoczne tylko dla Twojego konta.</p>
      </section>
    </main>
  );
}
