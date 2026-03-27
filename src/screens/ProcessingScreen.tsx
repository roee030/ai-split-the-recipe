import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const MESSAGES = [
  'Reading your receipt...',
  'Identifying dishes...',
  'Checking for Hebrew text...',
  'Calculating prices...',
  'Almost there...',
];

export function ProcessingScreen() {
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex((i) => (i + 1) % MESSAGES.length);
    }, 1800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-primary flex flex-col items-center justify-center gap-8 px-6">
      {/* Scanner animation */}
      <div className="relative w-48 h-48 rounded-2xl overflow-hidden bg-white/10">
        {/* Scanner line sweep */}
        <motion.div
          className="absolute left-0 right-0 h-0.5 bg-accent shadow-lg shadow-accent"
          initial={{ top: 0 }}
          animate={{ top: ['0%', '100%', '0%'] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-6xl">🧾</span>
        </div>
      </div>

      {/* Rotating status */}
      <motion.div
        key={msgIndex}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className="text-white font-medium text-lg text-center"
      >
        {MESSAGES[msgIndex]}
      </motion.div>

      {/* Progress dots */}
      <div className="flex gap-2">
        {MESSAGES.map((_, i) => (
          <motion.div
            key={i}
            className="w-2 h-2 rounded-full"
            animate={{ backgroundColor: i <= msgIndex ? '#FF6B35' : '#ffffff40' }}
            transition={{ duration: 0.3 }}
          />
        ))}
      </div>
    </div>
  );
}
