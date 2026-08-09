import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      "flex h-11 w-full rounded-xl border border-input/80 bg-surface-container/80 px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground/80 transition-[border-color,box-shadow,background-color] duration-md ease-md focus-ring hover:border-border focus:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };
