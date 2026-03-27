import { motion } from 'framer-motion';
import { Camera } from 'lucide-react';

interface ScanButtonProps {
  onClick: () => void;
}

export function ScanButton({ onClick }: ScanButtonProps) {
  return (
    <div className="relative flex items-center justify-center">
      {/* Pulsing rings */}
      <motion.div
        className="absolute w-40 h-40 rounded-full border-2 border-accent/30"
        animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute w-32 h-32 rounded-full border-2 border-accent/40"
        animate={{ scale: [1, 1.2, 1], opacity: [0.6, 0, 0.6] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
      />
      <motion.button
        className="w-24 h-24 rounded-full bg-accent flex items-center justify-center shadow-xl shadow-accent/30"
        onClick={onClick}
        whileTap={{ scale: 0.95 }}
        whileHover={{ scale: 1.05 }}
      >
        <Camera className="w-10 h-10 text-white" />
      </motion.button>
    </div>
  );
}
