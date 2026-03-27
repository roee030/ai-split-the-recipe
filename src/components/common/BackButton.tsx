import { ChevronLeft } from 'lucide-react';
import type { Screen } from '../../types/split.types';

const BACK_LABELS: Partial<Record<Screen, string>> = {
  review: 'Home',
  people: 'Review Items',
  claim: "Who's Joining",
  tip: 'Claim Dishes',
  summary: 'Tip & Tax',
  roundrobin: 'Summary',
};

interface BackButtonProps {
  screen: Screen;
  className?: string;
}

export function BackButton({ screen, className = '' }: BackButtonProps) {
  return (
    <button
      onClick={() => window.history.back()}
      className={`flex items-center gap-0.5 text-sm font-medium text-muted hover:text-primary transition-colors ${className}`}
    >
      <ChevronLeft className="w-4 h-4 flex-shrink-0" />
      <span>{BACK_LABELS[screen] ?? 'Back'}</span>
    </button>
  );
}
