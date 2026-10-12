import { describe, expect, it } from "vitest";
import { amountMinorOf, displayAmount, pressKey, textOfMinor } from "@/features/add/amountInput";

const type = (keys: string[]) => keys.reduce(pressKey, "");

describe("klawiatura kwoty", () => {
  it("cyfry, przecinek, kasowanie", () => {
    expect(type(["3", "8", ",", "5", "0"])).toBe("38,50");
    expect(type(["3", "8", ",", "5", "0", "9"])).toBe("38,50"); // maks. 2 miejsca
    expect(type([",", "5"])).toBe("0,5");
    expect(type(["1", ",", ","])).toBe("1,");
    expect(type(["0", "0", "7"])).toBe("7");
    expect(type(["1", "2", "back"])).toBe("1");
    expect(type(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"])).toBe("123456789");
  });

  it("przeliczenie i wyświetlanie", () => {
    expect(amountMinorOf("38,5")).toBe(3850);
    expect(amountMinorOf("0,05")).toBe(5);
    expect(amountMinorOf("")).toBe(0);
    expect(displayAmount("1234,5")).toBe("1 234,5");
    expect(displayAmount("")).toBe("0");
    expect(textOfMinor(-3850)).toBe("38,50");
    expect(textOfMinor(620000)).toBe("6200");
  });
});
