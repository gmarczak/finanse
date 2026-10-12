import {
  Baby,
  Banknote,
  Beer,
  BookOpen,
  Briefcase,
  Bus,
  Car,
  Coffee,
  Dumbbell,
  Ellipsis,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  Heart,
  House,
  Music,
  PawPrint,
  PiggyBank,
  Pill,
  Plane,
  Plus,
  Repeat,
  Scissors,
  Shirt,
  ShoppingCart,
  Smartphone,
  Ticket,
  Utensils,
  Wallet,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Color } from "@/lib/domain/model";

/** Ikony kategorii: klucz zapisany w bazie (categories.icon) → komponent i opis dla czytnika ekranu. */
export const ICONS: Record<string, { Icon: LucideIcon; label: string }> = {
  "shopping-cart": { Icon: ShoppingCart, label: "zakupy" },
  utensils: { Icon: Utensils, label: "jedzenie na mieście" },
  coffee: { Icon: Coffee, label: "kawa" },
  beer: { Icon: Beer, label: "wyjścia" },
  bus: { Icon: Bus, label: "transport" },
  car: { Icon: Car, label: "samochód" },
  fuel: { Icon: Fuel, label: "paliwo" },
  plane: { Icon: Plane, label: "podróże" },
  house: { Icon: House, label: "mieszkanie" },
  zap: { Icon: Zap, label: "rachunki" },
  wifi: { Icon: Wifi, label: "internet" },
  smartphone: { Icon: Smartphone, label: "telefon" },
  repeat: { Icon: Repeat, label: "subskrypcje" },
  heart: { Icon: Heart, label: "zdrowie" },
  pill: { Icon: Pill, label: "apteka" },
  dumbbell: { Icon: Dumbbell, label: "sport" },
  ticket: { Icon: Ticket, label: "rozrywka" },
  "gamepad-2": { Icon: Gamepad2, label: "gry" },
  music: { Icon: Music, label: "muzyka" },
  "book-open": { Icon: BookOpen, label: "książki" },
  "graduation-cap": { Icon: GraduationCap, label: "nauka" },
  shirt: { Icon: Shirt, label: "ubrania" },
  scissors: { Icon: Scissors, label: "uroda" },
  gift: { Icon: Gift, label: "prezenty" },
  baby: { Icon: Baby, label: "dzieci" },
  "paw-print": { Icon: PawPrint, label: "zwierzęta" },
  banknote: { Icon: Banknote, label: "wynagrodzenie" },
  briefcase: { Icon: Briefcase, label: "praca" },
  "piggy-bank": { Icon: PiggyBank, label: "oszczędności" },
  wallet: { Icon: Wallet, label: "portfel" },
  plus: { Icon: Plus, label: "inne przychody" },
  ellipsis: { Icon: Ellipsis, label: "inne" },
};

export const ICON_KEYS = Object.keys(ICONS);

type BadgeProps = { icon: string | null; color: Color; name: string; size?: "sm" | "md" | "lg" };

export function CategoryBadge({ icon, color, name, size = "md" }: BadgeProps) {
  const entry = icon ? ICONS[icon] : undefined;
  const box = size === "lg" ? "h-14 w-14" : size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const px = size === "lg" ? 26 : size === "sm" ? 16 : 20;
  return (
    <span
      aria-hidden="true"
      className={`flex ${box} shrink-0 items-center justify-center rounded-full font-semibold`}
      style={{ background: `var(--c-${color}-bg)`, color: `var(--c-${color}-fg)` }}
    >
      {entry ? <entry.Icon size={px} strokeWidth={2} /> : name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** Kolor konta z nazwy instytucji, żeby Revolut zawsze wyglądał tak samo. */
const INSTITUTION_COLORS: Record<string, Color> = { revolut: "blue", pekao: "rose", xtb: "green", cash: "amber" };

export function AccountBadge({ name, institution }: { name: string; institution: string | null }) {
  const color = (institution && INSTITUTION_COLORS[institution]) || "slate";
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[15px] font-semibold"
      style={{ background: `var(--c-${color}-bg)`, color: `var(--c-${color}-fg)` }}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** Kategoria „bez kategorii” w listach. */
export function UncategorizedBadge() {
  return (
    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-control text-muted">
      ?
    </span>
  );
}
