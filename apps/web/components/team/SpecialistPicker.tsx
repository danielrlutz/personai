"use client";

import { cn } from "@/lib/utils";
import { GROUP_LABEL, type SpecialistMeta } from "@/lib/specialists";

interface SpecialistPickerProps {
  specialists: SpecialistMeta[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}

export function SpecialistPicker({ specialists, value, onChange, disabled }: SpecialistPickerProps) {
  const groups = (["ops", "code", "care", "coaching"] as const).map((group) => ({
    group,
    items: specialists.filter((s) => s.group === group),
  }));

  return (
    <div
      className="-mx-0.5 flex gap-2 overflow-x-auto overscroll-x-contain px-0.5 pb-0.5 [scrollbar-width:thin]"
      role="listbox"
      aria-label="Specialists"
    >
      {groups.map(({ group, items }, groupIndex) =>
        items.length === 0 ? null : (
          <div
            key={group}
            className={cn(
              "flex shrink-0 items-center gap-1.5",
              groupIndex > 0 && "border-l border-border/50 pl-2",
            )}
          >
            <span className="sr-only">{GROUP_LABEL[group]}</span>
            <span
              aria-hidden
              className="hidden text-[10px] font-semibold uppercase tracking-[0.06em] text-foreground/55 sm:inline"
            >
              {GROUP_LABEL[group]}
            </span>
            <div className="flex items-center gap-1.5">
              {items.map((s) => {
                const selected = value === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={disabled}
                    title={`${s.label} — ${s.description}`}
                    onClick={() => onChange(s.id)}
                    className={cn(
                      "pressable inline-flex h-9 shrink-0 items-center rounded-full px-3 text-sm font-medium transition-colors duration-md ease-md disabled:opacity-50",
                      selected
                        ? "bg-primary text-primary-foreground shadow-elev-1 ring-1 ring-primary/25"
                        : "bg-surface-container text-foreground/85 hover:bg-surface-container-high hover:text-foreground",
                    )}
                  >
                    {s.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>
        ),
      )}
    </div>
  );
}
