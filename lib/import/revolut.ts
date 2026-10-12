import { isLocalDate } from "@/lib/domain/dates";
import { parseAmount } from "@/lib/domain/money";
import { csvRecords } from "./csv";
import { shortHash, type ParsedStatement, type RowHint, type StatementRow } from "./model";

/**
 * Wyciąg CSV z aplikacji Revolut (konto osobiste):
 * Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
 * Daty „YYYY-MM-DD HH:MM:SS”, kwoty z kropką i znakiem, opłata dodatnia (odejmowana od kwoty).
 */
export const REVOLUT_HEADER = ["Type", "Product", "Started Date", "Completed Date", "Description", "Amount", "Fee", "Currency", "State", "Balance"];

export function isRevolut(header: string[]): boolean {
  return REVOLUT_HEADER.every((h) => header.includes(h));
}

export function revolutHint(type: string, description: string, amount: number): RowHint {
  const t = type.toUpperCase();
  const d = description.trim();
  const lower = d.toLowerCase();
  // Przelewy między rachunkiem a oszczędnościami: „To/From PLN Savings account”, „Depositing savings”,
  // a wypłaty z oszczędności Revolut opisuje też jako „Unknown Description”
  const own = lower.match(/^(to|from) [a-z]{3} (savings|current) account/);
  if (own) return { type: "own-transfer", product: own[2] === "savings" ? "savings" : "current", direction: own[1] === "from" ? "in" : "out" };
  if (lower === "depositing savings") return { type: "own-transfer", product: "savings", direction: "out" };
  if (t === "TRANSFER" && lower === "unknown description" && amount > 0) return { type: "own-transfer", product: "savings", direction: "in" };
  if (/(^|\W)(www\.)?xtb\.com/.test(lower)) return { type: "broker", broker: "xtb" };
  if (t === "EXCHANGE") return { type: "exchange" };
  if (t === "ATM" || t === "OTP_ATM") return { type: "atm" };
  if (t === "TOPUP") return { type: "topup" };
  if (t === "CARD REFUND" || t === "REFUND") return { type: "refund" };
  if (t === "CHARGE" || t === "FEE") return { type: "fee" };
  if (t === "CARD PAYMENT") return { type: "card" };
  if (t === "TRANSFER") {
    if (lower === "to investment account") return { type: "counterparty", name: "Konto inwestycyjne Revolut" };
    // „To Jan Kowalski”, „Transfer to JAN KOWALSKI”, „Transfer from JAN KOWALSKI”
    const person = d.match(/^(?:transfer )?(?:to|from) (.+)$/i);
    if (person) return { type: "counterparty", name: titleCase(person[1]!.trim()) };
  }
  if (t === "OTP_PAYMENT" || t === "PAYMENT" || t === "REV PAYMENT" || t === "TRANSFER") return { type: amount < 0 ? "payment" : "other" };
  return { type: "other" };
}

function titleCase(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function parseRevolut(text: string, baseCurrency = "PLN"): ParsedStatement {
  const { header, records } = csvRecords(text);
  if (!isRevolut(header)) throw new Error("To nie wygląda na wyciąg CSV z Revoluta.");
  const rows: StatementRow[] = [];
  let skippedPending = 0;
  let skippedOtherCurrency = 0;
  let closingBalance: ParsedStatement["closingBalance"] = null;

  for (const r of records) {
    const state = (r["State"] ?? "").toUpperCase();
    if (state === "REVERTED" || state === "DECLINED" || state === "FAILED") continue;
    if (state === "PENDING") {
      skippedPending++;
      continue;
    }
    const currency = r["Currency"] ?? "";
    if (currency !== baseCurrency) {
      skippedOtherCurrency++; // waluty obce: etap z kursami NBP
      continue;
    }
    const started = r["Started Date"] ?? "";
    const bookedOn = started.slice(0, 10);
    const amount = parseAmount(r["Amount"] ?? "");
    const fee = parseAmount(r["Fee"] || "0") ?? 0;
    if (!isLocalDate(bookedOn) || amount === null) throw new Error(`Nie rozumiem wiersza z ${started || "?"}: ${r["Description"] ?? ""}`);

    // Saldo po ostatniej zaksięgowanej operacji (wiersze są w kolejności zaksięgowania)
    const balance = parseAmount(r["Balance"] ?? "");
    const completed = (r["Completed Date"] ?? "").slice(0, 10);
    if (balance !== null && isLocalDate(completed) && (!closingBalance || completed >= closingBalance.on)) closingBalance = { minor: balance, on: completed };

    const net = amount - Math.abs(fee);
    if (net === 0) continue;
    const description = r["Description"] ?? "";
    const product = (r["Product"] ?? "Current").toLowerCase();
    rows.push({
      bookedOn,
      amountMinor: net,
      currency,
      description,
      // Moment rozpoczęcia + kwota + opis: ten sam wiersz w kolejnym wyciągu da ten sam odcisk
      fingerprint: `revolut:${product}:${started}:${amount}:${shortHash(description)}`,
      status: "completed",
      hint: revolutHint(r["Type"] ?? "", description, net),
    });
  }
  return { format: "revolut", label: "Revolut", rows, skippedPending, skippedOtherCurrency, closingBalance, accountKind: "bank" };
}
