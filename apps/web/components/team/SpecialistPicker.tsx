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
    <div className="space-y-3.5">
      {groups.map(({ group, items }) =>
        items.length === 0 ? null : (
          <div key={group} className="min-w-0">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {GROUP_LABEL[group]}
            </p>
            <div className="flex flex-wrap gap-2">
              {items.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={disabled}
                  title={s.description}
                  onClick={() => onChange(s.id)}
                  className={cn(
                    "pressable rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors duration-md ease-md disabled:opacity-50",
                    value === s.id
                      ? "bg-secondary text-secondary-foreground shadow-elev-1 ring-1 ring-primary/25"
                      : "bg-surface-container text-muted-foreground hover:bg-surface-container-high hover:text-foreground",
                  )}
                >
                  {s.shortLabel}
                </button>
              ))}
            </div>
          </div>
        ),
      )}
    </div>
  );
}
