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
    <div className="space-y-3">
      {groups.map(({ group, items }) =>
        items.length === 0 ? null : (
          <div key={group}>
            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              {GROUP_LABEL[group]}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {items.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={disabled}
                  title={s.description}
                  onClick={() => onChange(s.id)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs transition-colors duration-md ease-md disabled:opacity-50",
                    value === s.id
                      ? "bg-secondary text-secondary-foreground shadow-elev-1"
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
