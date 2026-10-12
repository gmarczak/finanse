import { describe, expect, it } from "vitest";
import { balanceOn, netWorth } from "./balance";
import { institutionFromName, type Account, type Transaction } from "./model";

const acc = (id: string, anchor: number | null, anchorOn: string | null): Account => ({
  id, name: id, kind: "bank", institution: null, currency: "PLN", anchorBalanceMinor: anchor, anchorOn, sortOrder: 0, archivedAt: null,
});
const tx = (accountId: string, bookedOn: string, amount: number): Transaction => ({
  id: `${accountId}-${bookedOn}-${amount}`, accountId, bookedOn, kind: amount < 0 ? "expense" : "income", amountMinor: amount, currency: "PLN",
  amountPlnMinor: amount, categoryId: null, description: null, bankDescription: null, note: null, source: "manual", transferId: null, createdAt: "",
});

describe("saldo od kotwicy", () => {
  const pekao = acc("pekao", 842000, "2026-10-12");
  const txs = [tx("pekao", "2026-10-10", 620000), tx("pekao", "2026-10-12", -5000), tx("pekao", "2026-10-13", -1000), tx("revolut", "2026-10-13", -999)];

  it("dzień kotwicy = wpisane saldo", () => {
    expect(balanceOn(pekao, txs, "2026-10-12")).toBe(842000);
  });
  it("później dodaje nowe transakcje tego konta", () => {
    expect(balanceOn(pekao, txs, "2026-10-13")).toBe(841000);
  });
  it("wcześniej cofa transakcje sprzed kotwicy (import historii nie zmienia dzisiejszego salda)", () => {
    expect(balanceOn(pekao, txs, "2026-10-11")).toBe(847000);
    expect(balanceOn(pekao, txs, "2026-10-09")).toBe(227000);
  });
  it("bez kotwicy saldo nieznane; majątek liczy tylko śledzone, pomija zarchiwizowane", () => {
    const rev = acc("revolut", null, null);
    const old = { ...acc("old", 100, "2026-01-01"), archivedAt: "2026-02-01" };
    expect(balanceOn(rev, txs, "2026-10-13")).toBeNull();
    expect(netWorth([pekao, rev, old], txs, "2026-10-13")).toEqual({ totalMinor: 841000, tracked: 1, untracked: 1 });
  });
});

describe("instytucja z nazwy konta", () => {
  it("rozpoznaje banki i gotówkę", () => {
    expect(institutionFromName("Revolut Oszczędności")).toBe("revolut");
    expect(institutionFromName("PKO BP")).toBe("pko");
    expect(institutionFromName("Gotówka")).toBe("cash");
    expect(institutionFromName("Skarbonka")).toBeNull();
  });
});
