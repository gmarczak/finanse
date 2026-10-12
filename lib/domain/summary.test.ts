import { describe, expect, it } from "vitest";
import type { Budget, Category, Transaction } from "./model";
import { daysLeft, periodByKey, periodLabel, periodOf, sameDayInPrevious } from "./period";
import { limitFor, limitState, monthSummary } from "./summary";

const cat = (id: string, name: string, kind: "expense" | "income" = "expense", sortOrder = 0): Category => ({
  id, kind, name, icon: null, color: "green", sortOrder, archivedAt: null,
});

let n = 0;
const tx = (bookedOn: string, amount: number, categoryId: string | null, kind: Transaction["kind"] = amount < 0 ? "expense" : "income"): Transaction => ({
  id: `t${++n}`, accountId: "a", bookedOn, kind, amountMinor: amount, currency: "PLN", amountPlnMinor: amount,
  categoryId, description: null, bankDescription: null, note: null, source: "manual",
  transferId: kind === "transfer" ? "tr" : null, fingerprint: null, createdAt: "",
});

describe("okresy", () => {
  it("kalendarzowo", () => {
    expect(periodOf("2026-10-12")).toEqual({ key: "2026-10", from: "2026-10-01", to: "2026-10-31" });
    expect(periodOf("2026-02-28").to).toBe("2026-02-28");
    expect(periodOf("2028-02-10").to).toBe("2028-02-29");
    expect(periodByKey("2026-12").to).toBe("2026-12-31");
  });

  it("od dnia wypłaty (10.)", () => {
    expect(periodOf("2026-10-12", 10)).toEqual({ key: "2026-10", from: "2026-10-10", to: "2026-11-09" });
    expect(periodOf("2026-10-09", 10)).toEqual({ key: "2026-09", from: "2026-09-10", to: "2026-10-09" });
    expect(periodOf("2026-01-05", 10).key).toBe("2025-12");
  });

  it("dni do końca i ten sam dzień miesiąc wcześniej", () => {
    const oct = periodByKey("2026-10");
    expect(daysLeft(oct, "2026-10-12")).toBe(20);
    expect(daysLeft(oct, "2026-10-31")).toBe(1);
    expect(daysLeft(oct, "2026-11-01")).toBe(0);
    expect(sameDayInPrevious(oct, "2026-10-12")).toBe("2026-09-12");
    expect(sameDayInPrevious(periodByKey("2026-03"), "2026-03-31")).toBe("2026-02-28");
  });

  it("etykiety", () => {
    expect(periodLabel(periodByKey("2026-10"))).toBe("październik 2026");
    expect(periodLabel(periodOf("2026-10-12", 10), 10)).toBe("10 paź – 9 lis");
  });
});

describe("limity", () => {
  const p = periodByKey("2026-10");
  const budgets: Budget[] = [
    { categoryId: "food", validFrom: "2026-08-01", amountMinor: 70000 },
    { categoryId: "food", validFrom: "2026-10-01", amountMinor: 80000 },
    { categoryId: "food", validFrom: "2026-11-01", amountMinor: 90000 },
    { categoryId: "fun", validFrom: "2026-09-01", amountMinor: 0 },
  ];

  it("obowiązuje najnowsza wersja nie późniejsza niż okres; 0 = brak limitu", () => {
    expect(limitFor(budgets, "food", p)).toBe(80000);
    expect(limitFor(budgets, "food", periodByKey("2026-09"))).toBe(70000);
    expect(limitFor(budgets, "food", periodByKey("2026-07"))).toBeNull();
    expect(limitFor(budgets, "fun", p)).toBeNull();
  });

  it("stany: ostrzeżenie od 80%, przekroczenie powyżej limitu", () => {
    expect(limitState(100, null)).toBe("none");
    expect(limitState(79_99, 100_00)).toBe("ok");
    expect(limitState(80_00, 100_00)).toBe("warn");
    expect(limitState(100_00, 100_00)).toBe("warn");
    expect(limitState(100_01, 100_00)).toBe("over");
  });
});

describe("podsumowanie miesiąca", () => {
  const categories = [cat("food", "Jedzenie", "expense", 0), cat("out", "Na mieście", "expense", 1), cat("taxi", "Transport", "expense", 2), cat("pay", "Wynagrodzenie", "income")];
  const budgets: Budget[] = [
    { categoryId: "food", validFrom: "2026-10-01", amountMinor: 80000 },
    { categoryId: "out", validFrom: "2026-10-01", amountMinor: 40000 },
  ];
  const transactions = [
    tx("2026-10-02", -64200, "food"),
    tx("2026-10-05", -38800, "out"),
    tx("2026-10-10", 620000, "pay"),
    tx("2026-10-11", -5000, null),
    tx("2026-10-11", -50000, null, "transfer"), // przelew na XTB: nie wydatek
    tx("2026-10-11", 50000, null, "transfer"),
    tx("2026-09-03", -30000, "food"),
    tx("2026-09-20", -99999, "food"), // po 12. dniu: poza porównaniem „do tego dnia”
    tx("2026-11-01", -1000, "food"), // następny okres
  ];
  const s = monthSummary({ transactions, categories, budgets, period: periodByKey("2026-10"), today: "2026-10-12" });

  it("sumy bez przelewów i spoza okresu", () => {
    expect(s.spentMinor).toBe(64200 + 38800 + 5000);
    expect(s.incomeMinor).toBe(620000);
    expect(s.totalLimitMinor).toBe(120000);
    expect(s.remainingMinor).toBe(120000 - 108000);
    expect(s.daysLeft).toBe(20);
    expect(s.uncategorizedCount).toBe(1);
  });

  it("kategorie od największej, ze stanem limitu i pozycją „bez kategorii”", () => {
    expect(s.lines.map((l) => [l.category?.id ?? null, l.spentMinor, l.state])).toEqual([
      ["food", 64200, "warn"],
      ["out", 38800, "warn"],
      [null, 5000, "none"],
    ]);
  });

  it("porównanie z poprzednim okresem do tego samego dnia", () => {
    expect(s.previousToDateMinor).toBe(30000);
    const first = monthSummary({ transactions: transactions.filter((t) => t.bookedOn >= "2026-10-01"), categories, budgets, period: periodByKey("2026-10"), today: "2026-10-12" });
    expect(first.previousToDateMinor).toBeNull();
  });

  it("kategoria z limitem, ale bez wydatków, też jest na liście; usunięta kategoria → bez kategorii", () => {
    const withLimitOnly = monthSummary({ transactions: [], categories, budgets, period: periodByKey("2026-10"), today: "2026-10-12" });
    expect(withLimitOnly.lines.map((l) => l.category?.id)).toEqual(["food", "out"]);
    const orphan = monthSummary({ transactions: [tx("2026-10-03", -700, "deleted")], categories, budgets: [], period: periodByKey("2026-10"), today: "2026-10-12" });
    expect(orphan.lines).toEqual([{ category: null, spentMinor: 700, limitMinor: null, state: "none" }]);
  });
});
