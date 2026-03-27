import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { Avatar } from '../common/Avatar';
import type { Person } from '../../types/split.types';

interface PersonChipProps {
  person: Person;
  onRemove: () => void;
  onNameChange: (name: string) => void;
}

export function PersonChip({ person, onRemove, onNameChange }: PersonChipProps) {
  return (
    <motion.div
      layout
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.5, opacity: 0 }}
      transition={{ type: 'spring', damping: 20, stiffness: 300 }}
      className="flex items-center gap-3 p-4 bg-surface rounded-2xl border border-border"
    >
      <Avatar initials={person.avatar} color={person.color} size="md" />
      <input
        className="flex-1 text-sm font-medium text-primary bg-transparent outline-none"
        value={person.name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Name"
      />
      <button onClick={onRemove} className="text-muted p-1">
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
}
