import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Account, Category, Transaction } from "@/lib/domain/model";
import { normalizeMerchant, suggestCategory } from "./categorize";
import { parseCsv } from "./csv";
import { buildImportPlan, plannedCount, type ImportChoices } from "./plan";
import { parseRevolut } from "./revolut";

// Plik z fikcyjnymi danymi w prawdziwym układzie kolumn wyciągu Revoluta
const fixture = readFileSync(new URL("./fixtures/revolut.csv", import.meta.url), "utf8");

describe("CSV", () => {
  it("cudzysłowy, przecinki w polach, średnik, BOM", () => {
    expect(parseCsv('a,"b, c","d ""e"""\n1,2,3\n')).toEqual([["a", "b, c", 'd "e"'], ["1", "2", "3"]]);
    expect(parseCsv("﻿x;y\r\n1;2")).toEqual([["x", "y"], ["1", "2"]]);
  });
});

describe("wyciąg Revoluta", () => {
  const s = parseRevolut(fixture);

  it("pomija oczekujące, cofnięte i obce waluty; liczy opłatę", () => {
    expect(s.skippedPending).toBe(1);
    expect(s.skippedOtherCurrency).toBe(1);
    expect(s.rows).toHaveLength(10);
    const shop = s.rows.find((r) => r.description.startsWith("Sklep"))!;
    expect(shop.amountMinor).toBe(-2187);
    expect(shop.description).toBe('Sklep "Pod Lipą", Kraków');
  });

  it("data z momentu zakupu, nie zaksięgowania", () => {
    expect(s.rows[0]!.bookedOn).toBe("2026-03-31");
  });

  it("rozpoznaje rodzaj wiersza", () => {
    const hint = (d: string) => s.rows.find((r) => r.description === d)!.hint;
    expect(hint("From PLN Savings account")).toEqual({ type: "own-transfer", product: "savings", direction: "in" });
    expect(hint("To PLN Savings account")).toEqual({ type: "own-transfer", product: "savings", direction: "out" });
    expect(hint("www.xtb.com")).toEqual({ type: "broker", broker: "xtb" });
    expect(hint("Open banking top-up")).toEqual({ type: "topup" });
    expect(hint("Cash withdrawal at Przykładowa 1")).toEqual({ type: "atm" });
    expect(hint("Eneba")).toEqual({ type: "refund" });
  });

  it("odcisk jest stały i różny dla różnych wierszy", () => {
    const again = parseRevolut(fixture);
    expect(again.rows.map((r) => r.fingerprint)).toEqual(s.rows.map((r) => r.fingerprint));
    expect(new Set(s.rows.map((r) => r.fingerprint)).size).toBe(s.rows.length);
  });

  it("odrzuca inny plik", () => {
    expect(() => parseRevolut("Data,Kwota\n2026-01-01,1")).toThrow(/Revoluta/);
  });
});

const cat = (id: string, name: string, kind: "expense" | "income" = "expense"): Category => ({ id, kind, name, icon: null, color: "green", sortOrder: 0, archivedAt: null });
const categories = [cat("food", "Jedzenie"), cat("fun", "Rozrywka"), cat("transport", "Transport"), cat("subs", "Subskrypcje"), cat("pay", "Wynagrodzenie", "income")];
const acc = (id: string, name: string): Account => ({ id, name, kind: "bank", institution: null, currency: "PLN", anchorBalanceMinor: null, anchorOn: null, sortOrder: 0, archivedAt: null });
const accounts = [acc("rev", "Revolut"), acc("sav", "Revolut Oszczędności"), acc("xtb", "XTB"), acc("pekao", "Pekao")];

describe("kategorie", () => {
  it("normalizacja opisu", () => {
    expect(normalizeMerchant("ZABKA Z4521 K.1")).toBe("zabka z k.");
    expect(normalizeMerchant("www.xtb.com")).toBe("xtb.com");
  });
  it("reguła użytkownika wygrywa z podpowiedzią, dłuższy wzorzec wygrywa", () => {
    const rules = [{ pattern: "kino", categoryId: "food" }, { pattern: "kino przykładowe", categoryId: "fun" }];
    expect(suggestCategory("Kino Przykładowe", "expense", rules, categories)).toEqual({ categoryId: "fun", source: "rule" });
    expect(suggestCategory("Biedronka 123", "expense", [], categories)).toEqual({ categoryId: "food", source: "built-in" });
    expect(suggestCategory("jakdojade.pl", "expense", [], categories)).toEqual({ categoryId: "transport", source: "built-in" });
    expect(suggestCategory("Coś nowego", "expense", [], categories)).toBeNull();
  });
});

describe("plan importu", () => {
  let n = 0;
  const newId = () => `id-${++n}`;
  const choices: ImportChoices = { accountId: "rev", ownAccountId: "sav", counterparties: {}, includeExchange: false, brokerAccountIds: { xtb: "xtb" }, topupFrom: "pekao", rejectedMerges: [] };
  const manual: Transaction = {
    id: "m1", accountId: "rev", bookedOn: "2026-04-02", kind: "expense", amountMinor: -3000, currency: "PLN", amountPlnMinor: -3000,
    categoryId: "fun", description: "Kino z Olą", bankDescription: null, note: null, source: "manual", transferId: null, fingerprint: null, createdAt: "",
  };

  it("przelewy własne, XTB i doładowanie jako pary; ręczny wpis do połączenia; reszta z kategoriami", () => {
    const plan = buildImportPlan({ statement: parseRevolut(fixture), choices, accounts, categories, transactions: [manual], rules: [], newId });
    expect(plan.transfers).toHaveLength(4); // z oszczędności, na oszczędności, XTB, doładowanie
    for (const t of plan.transfers) expect(t.legs[0]!.amountMinor + t.legs[1]!.amountMinor).toBe(0);
    expect(plan.transfers.find((t) => t.description === "Na XTB")!.legs.map((l) => l.accountId)).toEqual(["rev", "xtb"]);
    expect(plan.merges.map((m) => [m.manual.id, m.row.description])).toEqual([["m1", "Kino Przykładowe"]]);
    const byDesc = Object.fromEntries(plan.rows.map((r) => [r.description, r]));
    expect(byDesc["Biedronka"]!.categoryId).toBe("food");
    expect(byDesc["Bankomat (Przykładowa 1)"]!.categoryId).toBeNull();
    expect(byDesc["Eneba"]).toMatchObject({ kind: "expense", amountMinor: 420 }); // zwrot zmniejsza wydatki
    expect(plannedCount(plan)).toBe(10);
  });

  it("drugi import tego samego pliku nic nie dodaje; odrzucone połączenie daje osobny wiersz", () => {
    const first = buildImportPlan({ statement: parseRevolut(fixture), choices, accounts, categories, transactions: [], rules: [], newId });
    const imported: Transaction[] = first.rows.map((r) => ({ ...manual, id: r.id, fingerprint: r.fingerprint, source: "import" as const }));
    const second = buildImportPlan({ statement: parseRevolut(fixture), choices, accounts, categories, transactions: imported, rules: [], newId });
    expect(second.rows).toHaveLength(0);
    expect(second.duplicates).toBe(first.rows.length);

    const kino = parseRevolut(fixture).rows.find((r) => r.description === "Kino Przykładowe")!;
    const rejected = buildImportPlan({ statement: parseRevolut(fixture), choices: { ...choices, rejectedMerges: [kino.fingerprint] }, accounts, categories, transactions: [manual], rules: [], newId });
    expect(rejected.merges).toHaveLength(0);
    expect(rejected.rows.some((r) => r.description === "Kino Przykładowe")).toBe(true);
  });

  it("przelew z oszczędnościami z wyciągu drugiego konta nie wchodzi drugi raz", () => {
    const first = buildImportPlan({ statement: parseRevolut(fixture), choices, accounts, categories, transactions: [], rules: [], newId });
    // nogi zapisane na koncie oszczędności po imporcie konta głównego
    const legs: Transaction[] = first.transfers.flatMap((t) => t.legs.map((l) => ({ ...manual, id: l.id, accountId: l.accountId, kind: "transfer" as const, amountMinor: l.amountMinor, amountPlnMinor: l.amountMinor, bookedOn: t.bookedOn, transferId: t.transferId, source: "import" as const, fingerprint: l.fingerprint })));
    // wyciąg oszczędności: te same przelewy widziane z drugiej strony (inny odcisk, przeciwny znak)
    const savings = { ...parseRevolut(fixture), rows: parseRevolut(fixture).rows.filter((r) => r.hint.type === "own-transfer").map((r) => ({ ...r, amountMinor: -r.amountMinor, fingerprint: `${r.fingerprint}:sav`, hint: { type: "own-transfer" as const, product: "current" as const, direction: r.amountMinor < 0 ? ("in" as const) : ("out" as const) } })) };
    const plan = buildImportPlan({ statement: savings, choices: { ...choices, accountId: "sav", ownAccountId: "rev" }, accounts, categories, transactions: legs, rules: [], newId });
    expect(plan.transfers).toHaveLength(0);
    expect(plan.duplicates).toBe(2);
  });

  it("bez konta oszczędności te wiersze są pomijane, doładowanie może być przychodem", () => {
    const plan = buildImportPlan({ statement: parseRevolut(fixture), choices: { ...choices, ownAccountId: null, topupFrom: "income" }, accounts, categories, transactions: [], rules: [], newId });
    expect(plan.skipped.ownTransfersWithoutAccount).toBe(2);
    expect(plan.rows.find((r) => r.description === "Doładowanie z innego banku")).toMatchObject({ kind: "income", amountMinor: 50000 });
  });
});
