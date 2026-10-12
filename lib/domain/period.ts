import { addDays, diffDays, type LocalDate } from "./dates";

/**
 * Okres rozliczeniowy („miesiąc”) zaczyna się w dniu `startDay` (1 = kalendarzowo, 10 = od wypłaty 10.).
 * Klucz okresu to miesiąc, w którym okres się zaczyna: "2026-10".
 */
export type Period = { key: string; from: LocalDate; to: LocalDate };

function ym(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function shift(key: string, months: number): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + months;
  return ym(Math.floor(index / 12), (index % 12) + 1);
}

export function periodByKey(key: string, startDay = 1): Period {
  const from = `${key}-${String(startDay).padStart(2, "0")}`;
  const nextFrom = `${shift(key, 1)}-${String(startDay).padStart(2, "0")}`;
  return { key, from, to: addDays(nextFrom, -1) };
}

/** Okres zawierający dany dzień. */
export function periodOf(date: LocalDate, startDay = 1): Period {
  const key = date.slice(0, 7);
  const day = Number(date.slice(8, 10));
  return periodByKey(day >= startDay ? key : shift(key, -1), startDay);
}

export function previousPeriod(period: Period, startDay = 1): Period {
  return periodByKey(shift(period.key, -1), startDay);
}

export function nextPeriod(period: Period, startDay = 1): Period {
  return periodByKey(shift(period.key, 1), startDay);
}

/** Ile dni okresu zostało, licząc dzisiejszy (0, gdy okres minął; cały okres, gdy jeszcze się nie zaczął). */
export function daysLeft(period: Period, today: LocalDate): number {
  if (today > period.to) return 0;
  if (today < period.from) return diffDays(period.from, period.to) + 1;
  return diffDays(today, period.to) + 1;
}

/** Dzień tego samego „miejsca” w poprzednim okresie (do porównań „do tego dnia”), nie dalej niż jego koniec. */
export function sameDayInPrevious(period: Period, today: LocalDate, startDay = 1): LocalDate {
  const prev = previousPeriod(period, startDay);
  const offset = Math.max(0, diffDays(period.from, today));
  const candidate = addDays(prev.from, offset);
  return candidate > prev.to ? prev.to : candidate;
}

const MONTHS = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];

/** „październik 2026” (kalendarzowo) albo „10 paź – 9 lis” (od wypłaty). */
export function periodLabel(period: Period, startDay = 1): string {
  const [y, m] = period.key.split("-").map(Number) as [number, number];
  if (startDay === 1) return `${MONTHS[m - 1]} ${y}`;
  const short = (d: LocalDate) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]!.slice(0, 3)}`;
  return `${short(period.from)} – ${short(period.to)}`;
}
