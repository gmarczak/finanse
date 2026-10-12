"use client";

import type { Category, CategoryKind } from "@/lib/domain/model";
import { CategoryBadge } from "@/lib/ui/icons";

type Props = {
  categories: Category[];
  kind: CategoryKind;
  value: string | null;
  onChange: (id: string | null) => void;
};

/** Siatka kategorii jako radio: jedno kliknięcie, drugie kliknięcie w zaznaczoną odznacza. */
export function CategoryGrid({ categories, kind, value, onChange }: Props) {
  const list = categories.filter((c) => c.kind === kind && c.archivedAt === null);
  return (
    <div role="radiogroup" aria-label="Kategoria" className="grid grid-cols-4 gap-1">
      {list.map((c) => {
        const on = c.id === value;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(on ? null : c.id)}
            className={`flex min-h-[76px] flex-col items-center gap-1.5 rounded-2xl px-0.5 py-2 text-center text-xs font-medium leading-tight ${
              on ? "bg-surface ring-2 ring-accent" : ""
            }`}
          >
            <CategoryBadge icon={c.icon} color={c.color} name={c.name} />
            <span className="line-clamp-2">{c.name}</span>
          </button>
        );
      })}
    </div>
  );
}
