import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      "flex min-h-[80px] w-full rounded-xl border border-input/80 bg-surface-container/80 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/80 transition-[border-color,box-shadow,background-color] duration-md ease-md focus-ring hover:border-border focus:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export { Textarea };
