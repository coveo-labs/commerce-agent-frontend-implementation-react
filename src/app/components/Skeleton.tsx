import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

type SkeletonProps = {
  className?: string;
};

export function Skeleton({ className = '' }: SkeletonProps) {
  return <span className={`skeleton ${className}`.trim()} aria-hidden="true" />;
}

export function SkeletonReveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
