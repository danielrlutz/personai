"use client";

import { cn } from "@/lib/utils";

export type AdvisorPersona = "CFO" | "COUNSEL" | "COMBINED";

const personas: Array<{ id: AdvisorPersona; label: string; description: string }> = [
  { id: "CFO", label: "CFO", description: "Finance & cashflow" },
  { id: "COUNSEL", label: "Counsel", description: "Legal & compliance" },
  { id: "COMBINED", label: "Combined", description: "Dual advisor" },
];

interface PersonaToggleProps {
  value: AdvisorPersona;
  onChange: (persona: AdvisorPersona) => void;
  disabled?: boolean;
}

export function PersonaToggle({ value, onChange, disabled }: PersonaToggleProps) {
  return (
    <div className="flex gap-1 rounded-full border border-border/80 bg-surface-container p-1">
      {personas.map((p) => (
        <button
          key={p.id}
          type="button"
          disabled={disabled}
          onClick={() => onChange(p.id)}
          className={cn(
            "flex-1 rounded-full px-3 py-2 text-left transition-colors duration-md ease-md disabled:opacity-50",
            value === p.id
              ? "bg-secondary text-secondary-foreground shadow-elev-1"
              : "text-muted-foreground hover:bg-surface-container-high",
          )}
        >
          <span className="block md-label-large">{p.label}</span>
          <span className="block text-xs opacity-70">{p.description}</span>
        </button>
      ))}
    </div>
  );
}
