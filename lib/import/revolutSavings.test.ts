import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Account, Category, Transaction } from "@/lib/domain/model";
import { buildImportPlan, counterpartiesOf, type ImportChoices } from "./plan";
import { revolutHint } from "./revolut";
import { isRevolutSavings, parseEnglishDate, parseRevolutSavings } from "./revolutSavings";

// Fikcyjne dane w układzie kolumn wyciągu z oszczędności Revoluta
const fixture = readFileSync(new URL("./fixtures/revolut-savings.csv", import.meta.url), "utf8");

describe("wyciąg z oszczędności Revoluta", () => {
  const s = parseRevolutSavings(fixture);

  it("rozpoznaje nagłówek i daty", () => {
    expect(isRevolutSavings(["Date", "Description", "Money out", "Money in", "Balance"])).toBe(true);
    expect(parseEnglishDate("Jan 1, 2026")).toBe("2026-01-01");
    expect(parseEnglishDate("Oct 12, 2026")).toBe("2026-10-12");
    expect(parseEnglishDate("2026-01-01")).toBeNull();
  });

  it("odsetki sumowane w jeden wiersz za miesiąc, nadpisywalny", () => {
    const interest = s.rows.filter((r) => r.hint.type === "interest");
    expect(interest.map((r) => [r.fingerprint, r.amountMinor, r.bookedOn, r.replace])).toEqual([
      ["revolut-savings:interest:2026-03", 191, "2026-03-31", true],
      ["revolut-savings:interest:2026-04", 207, "2026-04-05", true],
    ]);
  });

  it("wpłaty i wypłaty to przelewy z kontem głównym; dwa identyczne wiersze dnia mają różne odciski", () => {
    const moves = s.rows.filter((r) => r.hint.type === "own-transfer");
    expect(moves.map((r) => r.amountMinor)).toEqual([-10000, 40000, 40000]);
    expect(moves[0]!.hint).toEqual({ type: "own-transfer", product: "current", direction: "out" });
    expect(new Set(moves.map((r) => r.fingerprint)).size).toBe(3);
  });

  it("saldo końcowe z ostatniego wiersza (kwoty z przecinkiem tysięcy)", () => {
    expect(s.closingBalance).toEqual({ minor: 170398, on: "2026-04-05" });
    expect(s.accountKind).toBe("savings");
  });
});

describe("podpowiedzi wierszy Revoluta", () => {
  it("oszczędności, inwestycje, osoby, wymiana", () => {
    expect(revolutHint("Transfer", "Unknown Description", 5000)).toEqual({ type: "own-transfer", product: "savings", direction: "in" });
    expect(revolutHint("Transfer", "Depositing savings", -5000)).toEqual({ type: "own-transfer", product: "savings", direction: "out" });
    expect(revolutHint("Transfer", "To investment account", -5000)).toEqual({ type: "counterparty", name: "Konto inwestycyjne Revolut" });
    expect(revolutHint("Transfer", "To JAN KOWALSKI", -5000)).toEqual({ type: "counterparty", name: "Jan Kowalski" });
    expect(revolutHint("Transfer", "Transfer from ANNA NOWAK", 5000)).toEqual({ type: "counterparty", name: "Anna Nowak" });
    expect(revolutHint("Exchange", "Exchanged to PLN", 5000)).toEqual({ type: "exchange" });
    expect(revolutHint("OTP_ATM", "Cash withdrawal", -5000)).toEqual({ type: "atm" });
  });
});

const cat = (id: string, name: string, kind: "expense" | "income"): Category => ({ id, kind, name, icon: null, color: "green", sortOrder: 0, archivedAt: null });
const acc = (id: string, name: string): Account => ({ id, name, kind: "bank", institution: null, currency: "PLN", anchorBalanceMinor: null, anchorOn: null, sortOrder: 0, archivedAt: null });

describe("plan importu oszczędności i osób", () => {
  let n = 0;
  const newId = () => `id-${++n}`;
  const categories = [cat("int", "Odsetki", "income"), cat("other", "Inne przychody", "income")];
  const accounts = [acc("rev", "Revolut"), acc("sav", "Revolut Oszczędności"), acc("pekao", "Pekao")];
  const choices: ImportChoices = { accountId: "sav", ownAccountId: "rev", counterparties: {}, includeExchange: false, brokerAccountIds: {}, topupFrom: "income", rejectedMerges: [] };

  it("odsetki jako przychód w kategorii Odsetki; ponowny import z większą kwotą aktualizuje ten sam wiersz", () => {
    const first = buildImportPlan({ statement: parseRevolutSavings(fixture), choices, accounts, categories, transactions: [], rules: [], newId });
    const interest = first.rows.filter((r) => r.categorySource === "interest");
    expect(interest.map((r) => [r.kind, r.categoryId, r.replace])).toEqual([["income", "int", true], ["income", "int", true]]);
    expect(first.transfers).toHaveLength(3);

    const saved: Transaction[] = interest.map((r) => ({
      id: r.id, accountId: "sav", bookedOn: r.bookedOn, kind: "income", amountMinor: r.amountMinor, currency: "PLN", amountPlnMinor: r.amountMinor,
      categoryId: "int", description: r.description, bankDescription: null, note: null, source: "import", transferId: null, fingerprint: r.fingerprint, createdAt: "",
    }));
    saved[1] = { ...saved[1]!, amountMinor: 100, amountPlnMinor: 100 }; // w poprzednim pliku miesiąc był niepełny
    const second = buildImportPlan({ statement: { ...parseRevolutSavings(fixture), rows: parseRevolutSavings(fixture).rows.filter((r) => r.hint.type === "interest") }, choices, accounts, categories, transactions: saved, rules: [], newId });
    expect(second.duplicates).toBe(1);
    expect(second.counts.interestUpdated).toBe(1);
    expect(second.rows.map((r) => [r.id, r.amountMinor])).toEqual([[saved[1]!.id, 207]]);
  });

  it("osoba przypisana do własnego konta to przelew, wymiana walut domyślnie pominięta", () => {
    const statement = {
      format: "revolut", label: "Revolut", skippedPending: 0, skippedOtherCurrency: 0, closingBalance: null, accountKind: "bank" as const,
      rows: [
        { bookedOn: "2026-04-01", amountMinor: -50000, currency: "PLN", description: "To JAN KOWALSKI", fingerprint: "a", status: "completed" as const, hint: { type: "counterparty" as const, name: "Jan Kowalski" } },
        { bookedOn: "2026-04-02", amountMinor: -2000, currency: "PLN", description: "To ANNA NOWAK", fingerprint: "b", status: "completed" as const, hint: { type: "counterparty" as const, name: "Anna Nowak" } },
        { bookedOn: "2026-04-03", amountMinor: 9000, currency: "PLN", description: "Exchanged to PLN", fingerprint: "c", status: "completed" as const, hint: { type: "exchange" as const } },
      ],
    };
    expect(counterpartiesOf(statement).map((p) => p.name).sort()).toEqual(["Anna Nowak", "Jan Kowalski"]);
    const plan = buildImportPlan({ statement, choices: { ...choices, accountId: "rev", ownAccountId: "sav", counterparties: { "Jan Kowalski": "pekao" } }, accounts, categories, transactions: [], rules: [], newId });
    expect(plan.transfers.map((t) => t.legs.map((l) => [l.accountId, l.amountMinor]))).toEqual([[["rev", -50000], ["pekao", 50000]]]);
    expect(plan.rows.map((r) => [r.kind, r.amountMinor])).toEqual([["expense", -2000]]);
    expect(plan.skipped.exchange).toBe(1);
    const withExchange = buildImportPlan({ statement, choices: { ...choices, accountId: "rev", includeExchange: true }, accounts, categories, transactions: [], rules: [], newId });
    expect(withExchange.rows.find((r) => r.amountMinor === 9000)?.kind).toBe("income");
  });
});
