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
    <div className="flex gap-2 rounded-lg border border-border bg-muted/10 p-1">
      {personas.map((p) => (
        <button
          key={p.id}
          type="button"
          disabled={disabled}
          onClick={() => onChange(p.id)}
          className={cn(
            "flex-1 rounded-md px-3 py-2 text-left transition-colors disabled:opacity-50",
            value === p.id ? "bg-teal-500/20 text-teal-300" : "hover:bg-muted/30 text-muted-foreground",
          )}
        >
          <span className="block text-sm font-medium">{p.label}</span>
          <span className="block text-xs opacity-70">{p.description}</span>
        </button>
      ))}
    </div>
  );
}
