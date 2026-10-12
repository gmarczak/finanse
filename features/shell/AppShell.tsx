"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";
import { AddTransaction, type AddPreset } from "@/features/add/AddTransaction";
import { Onboarding } from "@/features/onboarding/Onboarding";
import { useSnapshot, useToday } from "@/lib/data/hooks";

type OpenAdd = (preset?: AddPreset) => void;
const AddContext = createContext<OpenAdd>(() => {});
export const useOpenAdd = () => useContext(AddContext);

const NAV = [
  { href: "/", label: "Miesiąc", d: ["M21.2 15.9A10 10 0 1 1 8 2.8", "M22 12A10 10 0 0 0 12 2v10z"] },
  { href: "/transactions", label: "Transakcje", d: ["M3 6h18", "M3 12h18", "M3 18h12"] },
  { href: "/plan", label: "Plan", d: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z", "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"] },
  { href: "/accounts", label: "Majątek", d: ["M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1", "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"] },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: snapshot, isPending, error, refetch } = useSnapshot();
  const today = useToday(snapshot);
  const [adding, setAdding] = useState<{ preset?: AddPreset } | null>(null);

  const open: OpenAdd = useCallback((preset) => setAdding({ preset }), []);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const link = (item: (typeof NAV)[number]) => (
    <Link
      key={item.href}
      href={item.href}
      aria-current={isActive(item.href) ? "page" : undefined}
      className={`flex min-w-16 flex-col items-center gap-1 text-xs ${isActive(item.href) ? "font-bold text-text" : "font-medium text-muted"}`}
    >
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {item.d.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
      {item.label}
    </Link>
  );

  if (isPending && !snapshot) {
    return <div className="mx-auto min-h-dvh max-w-lg px-5 pt-10 text-muted">Wczytuję…</div>;
  }
  if (!snapshot || !today) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col items-start gap-4 px-5 pt-10">
        <h1 className="font-serif text-2xl font-semibold">Nie udało się wczytać danych</h1>
        <p className="text-muted">{error?.message ?? "Sprawdź połączenie z internetem."}</p>
        <button type="button" onClick={() => void refetch()} className="h-12 rounded-full bg-accent px-6 font-semibold text-accent-contrast">
          Spróbuj ponownie
        </button>
      </div>
    );
  }
  // Bez kont nie da się zapisać wydatku: najpierw krótki start
  if (snapshot.accounts.length === 0) return <Onboarding snapshot={snapshot} today={today} />;

  return (
    <AddContext.Provider value={open}>
      <div className="mx-auto min-h-dvh max-w-lg pb-[calc(5.5rem+env(safe-area-inset-bottom))]">{children}</div>

      <nav aria-label="Główna nawigacja" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto flex max-w-lg items-center justify-around px-2">
          {link(NAV[0])}
          {link(NAV[1])}
          <button
            type="button"
            aria-label="Dodaj wydatek"
            onClick={() => open()}
            className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-accent text-accent-contrast"
          >
            <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          {link(NAV[2])}
          {link(NAV[3])}
        </div>
      </nav>

      <Modal open={adding !== null} onClose={() => setAdding(null)} title="Nowa transakcja">
        {adding && <AddTransaction snapshot={snapshot} today={today} preset={adding.preset} onDone={() => setAdding(null)} />}
      </Modal>
    </AddContext.Provider>
  );
}
