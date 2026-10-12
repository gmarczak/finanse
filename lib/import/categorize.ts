import type { Category } from "@/lib/domain/model";

/** Opis z banku w postaci do porównań: małe litery, bez cyfr (numery sklepów, terminali) i nadmiaru spacji. */
export function normalizeMerchant(description: string): string {
  return description
    .toLowerCase()
    .replace(/https?:\/\/|www\./g, "")
    .replace(/[0-9]+/g, " ")
    .replace(/[*#/\\_|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Wbudowane podpowiedzi dla popularnych sklepów i usług (nazwa kategorii startowej → fragmenty opisu).
 * Tylko oczywiste przypadki; resztę użytkownik przypisze raz, a aplikacja zapamięta regułę.
 */
const BUILT_IN: Record<string, string[]> = {
  Jedzenie: ["biedronka", "lidl", "żabka", "zabka", "stokrotka", "kaufland", "carrefour", "auchan", "dino", "netto", "aldi", "lewiatan", "polomarket", "intermarche", "freshmarket", "spar"],
  "Jedzenie na mieście": ["mcdonald", "kfc", "burger king", "pizza", "kebab", "starbucks", "costa coffee", "pyszne.pl", "glovo", "wolt", "uber eats"],
  Transport: ["orlen", "shell", "circle k", "moya", "amic", "bp ", "jakdojade", "uber", "bolt", "freenow", "pkp", "intercity", "koleo", "flixbus", "mpk", "ztm"],
  Subskrypcje: ["spotify", "netflix", "google one", "youtube premium", "disney", "hbo", "max.com", "apple.com/bill", "icloud", "canal+", "player.pl", "anthropic", "openai", "chatgpt"],
  Zdrowie: ["apteka", "rossmann", "hebe", "luxmed", "medicover", "enel-med"],
  Sport: ["basen", "osir", "siłownia", "silownia", "fitness", "multisport", "decathlon", " sportu", "sport "],
  Rozrywka: ["kino", "cinema city", "multikino", "helios", "steam", "playstation", "eneba"],
  Ubrania: ["zalando", "h&m", "reserved", "zara", "sinsay", "cropp", "house ", "lpp"],
  Mieszkanie: ["ikea", "castorama", "leroy merlin", "obi ", "pge", "tauron", "enea", "energa", "pgnig"],
};

export type CategoryRule = { pattern: string; categoryId: string };

/**
 * Kategoria dla opisu: najpierw reguły użytkownika (najdłuższy pasujący wzorzec wygrywa),
 * potem wbudowane podpowiedzi dopasowane do kategorii o tej nazwie. null = do skategoryzowania.
 */
export function suggestCategory(
  description: string,
  kind: "expense" | "income",
  rules: CategoryRule[],
  categories: Category[],
  options: { builtIn?: boolean } = {},
): { categoryId: string; source: "rule" | "built-in" } | null {
  const text = ` ${normalizeMerchant(description)} `;
  const valid = new Map(categories.filter((c) => c.kind === kind && c.archivedAt === null).map((c) => [c.id, c]));
  const rule = rules
    .filter((r) => valid.has(r.categoryId) && text.includes(r.pattern))
    .sort((a, b) => b.pattern.length - a.pattern.length)[0];
  if (rule) return { categoryId: rule.categoryId, source: "rule" };
  if (kind !== "expense" || options.builtIn === false) return null;
  for (const [name, keywords] of Object.entries(BUILT_IN)) {
    const category = [...valid.values()].find((c) => c.name === name);
    if (category && keywords.some((k) => text.includes(k))) return { categoryId: category.id, source: "built-in" };
  }
  return null;
}
