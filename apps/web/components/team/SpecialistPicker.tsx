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
    <div className="space-y-2.5">
      {groups.map(({ group, items }) =>
        items.length === 0 ? null : (
          <div key={group} className="min-w-0">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-foreground/70">
              {GROUP_LABEL[group]}
            </p>
            <div className="grid grid-cols-2 gap-1.5 min-[420px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] sm:gap-2">
              {items.map((s) => {
                const selected = value === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={disabled}
                    title={s.description}
                    aria-pressed={selected}
                    onClick={() => onChange(s.id)}
                    className={cn(
                      "pressable inline-flex min-h-10 w-full min-w-0 items-center justify-center rounded-full px-3 text-sm font-medium transition-colors duration-md ease-md disabled:opacity-50 sm:px-3.5",
                      selected
                        ? "bg-primary text-primary-foreground shadow-elev-1 ring-1 ring-primary/30"
                        : "bg-surface-container text-foreground/80 hover:bg-surface-container-high hover:text-foreground",
                    )}
                  >
                    <span className="truncate">{s.shortLabel}</span>
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
