import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface ScreenContainerProps {
  children: ReactNode;
  className?: string;
}

export function ScreenContainer({ children, className = '' }: ScreenContainerProps) {
  return (
    <motion.div
      className={`min-h-screen bg-bg flex flex-col ${className}`}
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
