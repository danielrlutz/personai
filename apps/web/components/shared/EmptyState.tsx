"use client";

import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "animate-in flex flex-col items-center justify-center px-4 py-10 text-center sm:py-12",
        className,
      )}
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-container/80 shadow-elev-1 sm:mb-4">
        <Icon className="h-5 w-5 text-primary-on-container" />
      </div>
      <h3 className="md-title-medium text-foreground">{title}</h3>
      {description && (
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4 sm:mt-5">{action}</div>}
    </div>
  );
}
