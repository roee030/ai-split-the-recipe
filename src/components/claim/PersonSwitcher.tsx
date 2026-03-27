import type { Person } from '../../types/split.types';

interface PersonChipsProps {
  people: Person[];
  activeIndex: number;
  onSelect: (index: number) => void;
  claimCounts: Record<string, number>;
}

export function PersonSwitcher({ people, activeIndex, onSelect, claimCounts }: PersonChipsProps) {
  return (
    <div className="px-5 py-3">
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {people.map((p, i) => (
          <button
            key={p.id}
            onClick={() => onSelect(i)}
            className={`flex items-center gap-2 px-3 py-2 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-all ${
              i === activeIndex
                ? 'text-white shadow-md'
                : 'bg-surface border border-border text-primary'
            }`}
            style={i === activeIndex ? { backgroundColor: p.color } : {}}
          >
            <span className="w-5 h-5 rounded-full bg-white/25 flex items-center justify-center text-[10px] font-bold">
              {p.avatar}
            </span>
            <span>{i === 0 ? 'You' : p.name}</span>
            {claimCounts[p.id] > 0 && (
              <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${i === activeIndex ? 'bg-white/30 text-white' : 'bg-primary/10 text-primary'}`}>
                {claimCounts[p.id]}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
