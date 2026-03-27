import { useState, useEffect } from 'react';
import { BottomSheet } from '../common/BottomSheet';
import { Avatar } from '../common/Avatar';
import type { Person } from '../../types/split.types';
import type { ReceiptItem } from '../../types/receipt.types';

interface SharedModalProps {
  open: boolean;
  item: ReceiptItem | null;
  people: Person[];
  currentPersonIds: string[];
  isSolo?: boolean; // true when only 1 person in session
  onConfirm: (personIds: string[], sharedUnitsOrSoloCount: number) => void;
  onClose: () => void;
}

export function SharedModal({ open, item, people, currentPersonIds, isSolo, onConfirm, onClose }: SharedModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(currentPersonIds));
  const [sharedUnits, setSharedUnits] = useState(1);
  const [soloCount, setSoloCount] = useState(2); // total people sharing in solo mode

  useEffect(() => {
    setSelected(new Set(currentPersonIds));
    setSharedUnits(1);
    setSoloCount(2);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentPersonIds.join(',')]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  // Solo mode: just ask how many people shared (including the user)
  if (isSolo) {
    const mePerson = people[0];
    return (
      <BottomSheet open={open} onClose={onClose} title={`Shared ${item?.name ?? ''}?`}>
        <p className="text-sm text-muted mb-4">
          How many people shared this dish in total (including you)?
        </p>
        <div className="flex items-center justify-center gap-6 mb-6 p-4 bg-surface border border-border rounded-2xl">
          <button
            onClick={() => setSoloCount((c) => Math.max(2, c - 1))}
            className="w-10 h-10 rounded-full bg-primary/10 text-primary font-bold text-xl flex items-center justify-center"
          >
            −
          </button>
          <div className="text-center">
            <span className="text-3xl font-bold text-primary">{soloCount}</span>
            <p className="text-xs text-muted mt-1">people</p>
          </div>
          <button
            onClick={() => setSoloCount((c) => c + 1)}
            className="w-10 h-10 rounded-full bg-primary/10 text-primary font-bold text-xl flex items-center justify-center"
          >
            +
          </button>
        </div>
        <p className="text-xs text-muted text-center mb-4">
          You'll pay{' '}
          <span className="font-semibold text-primary">
            1/{soloCount}
          </span>{' '}
          of the price
        </p>
        <button
          onClick={() => { onConfirm(mePerson ? [mePerson.id] : [], soloCount); onClose(); }}
          className="w-full py-4 bg-primary text-white font-semibold rounded-2xl"
        >
          Split {soloCount} ways
        </button>
      </BottomSheet>
    );
  }

  // Group mode: existing UI
  return (
    <BottomSheet open={open} onClose={onClose} title={`Who shared ${item?.name ?? ''}?`}>
      {item && item.quantity > 1 && (
        <div className="mb-4 p-4 bg-surface border border-border rounded-2xl">
          <p className="text-xs text-muted font-medium mb-3">How many units are being shared?</p>
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setSharedUnits((u) => Math.max(1, u - 1))}
              className="w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-lg flex items-center justify-center"
            >
              −
            </button>
            <span className="text-xl font-bold text-primary min-w-[80px] text-center">
              {sharedUnits} of {item.quantity}
            </span>
            <button
              onClick={() => setSharedUnits((u) => Math.min(item.quantity, u + 1))}
              className="w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-lg flex items-center justify-center"
            >
              +
            </button>
          </div>
        </div>
      )}
      <div className="space-y-3 mb-6">
        {people.map((p) => (
          <button
            key={p.id}
            onClick={() => toggle(p.id)}
            className={`w-full flex items-center gap-3 p-3 rounded-2xl border transition-colors ${
              selected.has(p.id) ? 'border-transparent' : 'border-border bg-surface'
            }`}
            style={selected.has(p.id) ? { backgroundColor: `${p.color}20`, borderColor: `${p.color}40` } : {}}
          >
            <Avatar initials={p.avatar} color={p.color} size="sm" selected={selected.has(p.id)} />
            <span className="text-sm font-medium text-primary">{p.name}</span>
          </button>
        ))}
      </div>
      <button
        onClick={() => { onConfirm(Array.from(selected), sharedUnits); onClose(); }}
        disabled={selected.size === 0}
        className="w-full py-4 bg-primary text-white font-semibold rounded-2xl disabled:opacity-40"
      >
        Confirm ({selected.size} people)
      </button>
    </BottomSheet>
  );
}
