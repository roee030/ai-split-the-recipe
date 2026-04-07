import { useRef } from 'react';
import { motion } from 'framer-motion';
import { CurrencyDisplay } from '../common/CurrencyDisplay';
import { Avatar } from '../common/Avatar';
import type { ReceiptItem } from '../../types/receipt.types';
import type { ItemClaim, Person } from '../../types/split.types';

function getItemIcon(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('beef') || n.includes('steak') || n.includes('ribeye') || n.includes('wagyu') || n.includes('burger') || n.includes('meat')) return '🥩';
  if (n.includes('chicken') || n.includes('poultry') || n.includes('duck')) return '🍗';
  if (n.includes('fish') || n.includes('salmon') || n.includes('tuna') || n.includes('sea') || n.includes('shrimp') || n.includes('prawn')) return '🐟';
  if (n.includes('pizza')) return '🍕';
  if (n.includes('pasta') || n.includes('spaghetti') || n.includes('fettuccine') || n.includes('tagliatelle') || n.includes('penne')) return '🍝';
  if (n.includes('salad') || n.includes('greens') || n.includes('caesar')) return '🥗';
  if (n.includes('soup') || n.includes('broth') || n.includes('bisque')) return '🍲';
  if (n.includes('dessert') || n.includes('cake') || n.includes('ice cream') || n.includes('tiramisu') || n.includes('gelato')) return '🍰';
  if (n.includes('wine') || n.includes('vino') || n.includes('bordeaux') || n.includes('chateau')) return '🍷';
  if (n.includes('beer') || n.includes('ale') || n.includes('lager') || n.includes('ipa')) return '🍺';
  if (n.includes('cocktail') || n.includes('mojito') || n.includes('martini') || n.includes('negroni')) return '🍸';
  if (n.includes('coffee') || n.includes('espresso') || n.includes('cappuccino') || n.includes('latte')) return '☕';
  if (n.includes('water') || n.includes('juice') || n.includes('soda') || n.includes('sparkling')) return '🥤';
  if (n.includes('bread') || n.includes('roll') || n.includes('focaccia') || n.includes('baguette')) return '🍞';
  if (n.includes('sushi') || n.includes('maki') || n.includes('nigiri')) return '🍣';
  if (n.includes('truffle') || n.includes('mushroom')) return '🍄';
  if (n.includes('gratuity') || n.includes('service') || n.includes('tip') || n.includes('charge')) return '💳';
  if (n.includes('tax') || n.includes('vat')) return '📋';
  return '🍽️';
}

// Split name into main part and parenthetical notes (e.g. "Burger (well done, extra cheese)")
function splitItemName(name: string): { main: string; notes: string | null } {
  const match = name.match(/^(.*?)\s*(\(.*\))$/);
  if (match) return { main: match[1].trim(), notes: match[2] };
  return { main: name, notes: null };
}

interface ItemCardProps {
  item: ReceiptItem;
  claim: ItemClaim | undefined;
  activePerson: Person;
  people: Person[];
  currency: string;
  onTap: () => void;
  onLongPress: () => void;
  hideClaimants?: boolean;
  myQuantity?: number;
  onSetQuantity?: (qty: number) => void;
}

export function ItemCard({
  item, claim, activePerson, people, currency, onTap, onLongPress, hideClaimants, myQuantity, onSetQuantity,
}: ItemCardProps) {
  const isClaimed = claim !== undefined;
  const claimedByActive = claim?.personIds.includes(activePerson.id) ?? false;
  const sharedPersonIds = claim && claim.personIds.length > 1 ? claim.personIds : null;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleTouchStart() {
    longPressTimer.current = setTimeout(() => onLongPress(), 500);
  }
  function handleTouchEnd() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }

  const icon = getItemIcon(item.name);
  const { main, notes } = splitItemName(item.name);

  return (
    <motion.button
      className={`w-full rounded-2xl border text-start transition-all overflow-hidden ${
        claimedByActive
          ? 'border-transparent'
          : isClaimed
          ? 'bg-surface border-border opacity-60'
          : 'bg-surface border-border'
      }`}
      style={claimedByActive ? { backgroundColor: `${activePerson.color}15`, borderColor: `${activePerson.color}30` } : {}}
      onClick={onTap}
      onContextMenu={(e) => { e.preventDefault(); onLongPress(); }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
      whileTap={{ scale: 0.98 }}
    >
      {/* Main row */}
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-1">
        {/* Icon */}
        <span className="text-2xl flex-shrink-0 mt-0.5">{icon}</span>

        {/* Name block — takes all available space, wraps freely */}
        <div className="flex-1 min-w-0">
          {item.quantity > 1 && (
            <span className="text-[11px] font-bold text-accent bg-accent/10 rounded-md px-1.5 py-0.5 me-1.5 align-middle">
              ×{item.quantity}
            </span>
          )}
          <span className="text-sm font-semibold text-primary leading-snug break-words">
            {main}
          </span>
          {notes && (
            <p className="text-xs text-muted mt-0.5 leading-snug">{notes}</p>
          )}
        </div>

        {/* Price — right-aligned, never shrinks */}
        <div className="flex-shrink-0 text-end ms-2">
          <CurrencyDisplay
            amount={item.totalPrice}
            currency={currency}
            className="text-sm font-bold text-primary"
          />
        </div>
      </div>

      {/* Bottom row — quantity stepper / shared info / status badge */}
      <div className="flex items-center justify-between px-4 pb-3 pt-1">
        <div className="flex items-center gap-2">
          {/* Shared label */}
          {sharedPersonIds && !hideClaimants && (
            <div className="flex items-center gap-1">
              <div className="flex -space-x-1">
                {sharedPersonIds.slice(0, 3).map((pid) => {
                  const p = people.find((pe) => pe.id === pid);
                  return p ? <Avatar key={pid} initials={p.avatar} color={p.color} size="sm" /> : null;
                })}
              </div>
              <span className="text-[11px] text-muted font-medium">Shared ÷ {sharedPersonIds.length}</span>
            </div>
          )}

          {/* Quantity stepper for multi-unit items */}
          {claimedByActive && item.quantity > 1 && onSetQuantity && (
            <div
              className="flex items-center gap-1.5"
              onClick={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              <button
                onClick={(e) => { e.stopPropagation(); onSetQuantity(Math.max(0, (myQuantity ?? 1) - 1)); }}
                className="w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center"
              >−</button>
              <span className="text-xs font-semibold text-primary min-w-[44px] text-center">
                {myQuantity ?? 1} of {item.quantity}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onSetQuantity(Math.min(item.quantity, (myQuantity ?? 1) + 1)); }}
                className="w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center"
              >+</button>
            </div>
          )}

          {/* Unclaimed avatar stack (other people's claims) */}
          {!claimedByActive && isClaimed && !hideClaimants && !sharedPersonIds && (
            <div className="flex -space-x-1">
              {claim!.personIds.slice(0, 3).map((pid) => {
                const p = people.find((pe) => pe.id === pid);
                return p ? <Avatar key={pid} initials={p.avatar} color={p.color} size="sm" /> : null;
              })}
            </div>
          )}
        </div>

        {/* Status badge */}
        {claimedByActive ? (
          <span
            className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-lg text-white"
            style={{ backgroundColor: activePerson.color }}
          >
            Claimed ✓
          </span>
        ) : !isClaimed ? (
          <span className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-lg border-2 border-dashed border-border text-muted">
            Tap to claim
          </span>
        ) : null}
      </div>
    </motion.button>
  );
}
