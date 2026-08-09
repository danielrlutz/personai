"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { pageVariants, staggerContainer, staggerItem } from "@/lib/motion";

interface PageEnterProps {
  children: React.ReactNode;
  className?: string;
}

/** Calm page enter — Airbnb-soft fade/rise into the Material shell. */
export function PageEnter({ children, className }: PageEnterProps) {
  const reduce = useReducedMotion();

  if (reduce) {
    return <div className={cn("min-w-0", className)}>{children}</div>;
  }

  return (
    <motion.div
      className={cn("min-w-0", className)}
      variants={pageVariants}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.div>
  );
}

interface StaggerProps {
  children: React.ReactNode;
  className?: string;
}

export function Stagger({ children, className }: StaggerProps) {
  const reduce = useReducedMotion();

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      variants={staggerContainer}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: StaggerProps) {
  const reduce = useReducedMotion();

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div className={className} variants={staggerItem}>
      {children}
    </motion.div>
  );
}
