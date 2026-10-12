/**
 * Tekst kwoty wpisywany z klawiatury ekranowej: cyfry i jeden przecinek, maks. 2 miejsca po przecinku
 * i 9 cyfr przed nim. Zwraca nowy tekst albo poprzedni, gdy klawisz nic nie zmienia.
 */
export function pressKey(text: string, key: string): string {
  if (key === "back") return text.slice(0, -1);
  if (key === "," || key === ".") {
    if (text.includes(",")) return text;
    return text === "" ? "0," : `${text},`;
  }
  if (!/^\d$/.test(key)) return text;
  const [int = "", frac] = text.split(",");
  if (frac !== undefined) return frac.length >= 2 ? text : text + key;
  if (int === "0") return key; // bez zer wiodących
  if (int.length >= 9) return text;
  return text + key;
}

/** Tekst kwoty → grosze (0, gdy pusto). */
export function amountMinorOf(text: string): number {
  if (text === "") return 0;
  const [int = "0", frac = ""] = text.split(",");
  return Number(int || "0") * 100 + Number(frac.padEnd(2, "0"));
}

/** Kwota do wyświetlenia w trakcie pisania: „1 234,5” (spacje co 3 cyfry, przecinek zostaje). */
export function displayAmount(text: string): string {
  if (text === "") return "0";
  const [int = "0", frac] = text.split(",");
  const grouped = (int || "0").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return frac === undefined ? grouped : `${grouped},${frac}`;
}

/** Grosze → tekst do edycji („38,5” nie, tylko „38,50”; bez części ułamkowej, gdy zero). */
export function textOfMinor(minor: number): string {
  const abs = Math.abs(minor);
  const zl = Math.floor(abs / 100);
  const gr = abs % 100;
  return gr === 0 ? String(zl) : `${zl},${String(gr).padStart(2, "0")}`;
}
