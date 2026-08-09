import type { Transition, Variants } from "framer-motion";

export const easeHospitality = [0.22, 1, 0.36, 1] as const;

export const pageTransition: Transition = {
  duration: 0.42,
  ease: easeHospitality,
};

export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: pageTransition,
  },
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.045,
      delayChildren: 0.04,
    },
  },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.32,
      ease: easeHospitality,
    },
  },
};

export const messageVariants: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.28,
      ease: easeHospitality,
    },
  },
};
