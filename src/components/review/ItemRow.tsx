import React from 'react';
import { motion } from 'framer-motion';
import { Trash2, Edit3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReceiptItem } from '../../types/receipt.types';
import { CurrencyDisplay } from '../common/CurrencyDisplay';

// Simple category icon based on item name keywords
function getItemIcon(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('beef') || n.includes('steak') || n.includes('ribeye') || n.includes('wagyu') || n.includes('burger')) return '🥩';
  if (n.includes('chicken') || n.includes('poultry') || n.includes('duck')) return '🍗';
  if (n.includes('fish') || n.includes('salmon') || n.includes('tuna') || n.includes('sea')) return '🐟';
  if (n.includes('pizza')) return '🍕';
  if (n.includes('pasta') || n.includes('spaghetti') || n.includes('fettuccine')) return '🍝';
  if (n.includes('salad') || n.includes('greens')) return '🥗';
  if (n.includes('soup')) return '🍲';
  if (n.includes('dessert') || n.includes('cake') || n.includes('ice cream') || n.includes('tiramisu') || n.includes('gelato')) return '🍰';
  if (n.includes('wine') || n.includes('vino') || n.includes('bordeaux') || n.includes('margaux') || n.includes('chateau')) return '🍷';
  if (n.includes('beer') || n.includes('ale') || n.includes('lager')) return '🍺';
  if (n.includes('cocktail') || n.includes('mojito') || n.includes('martini')) return '🍸';
  if (n.includes('coffee') || n.includes('espresso') || n.includes('cappuccino') || n.includes('latte')) return '☕';
  if (n.includes('water') || n.includes('juice') || n.includes('soda') || n.includes('drink')) return '🥤';
  if (n.includes('bread') || n.includes('roll') || n.includes('focaccia')) return '🍞';
  if (n.includes('sushi') || n.includes('roll') || n.includes('maki')) return '🍣';
  if (n.includes('gratuity') || n.includes('service') || n.includes('tip') || n.includes('charge')) return '💳';
  if (n.includes('tax') || n.includes('vat')) return '📋';
  return '🍽️';
}

interface Props {
  item: ReceiptItem;
  index: number;
  isEditing: boolean;
  currency: string;
  onEdit: (id: string) => void;
  onCommit: () => void;
  onDelete: (id: string) => void;
  onUpdateItem: (id: string, changes: Partial<ReceiptItem>) => void;
  onEditFieldChange: (field: 'name' | 'price' | 'quantity') => void;
  priceInputRef?: React.RefObject<HTMLInputElement | null>;
}

export function ItemRow({
  item,
  index,
  isEditing,
  currency,
  onEdit,
  onCommit,
  onDelete,
  onUpdateItem,
  onEditFieldChange,
  priceInputRef,
}: Props) {
  const { t } = useTranslation();

  return (
    <motion.div
      key={item.id}
      layout
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      className="border-b border-border last:border-b-0"
    >
      {isEditing ? (
        <div className="p-4 space-y-2">
          <input
            className="w-full text-sm font-medium text-primary bg-bg border border-border rounded-xl px-3 py-2.5 outline-none focus:border-accent"
            value={item.name}
            onChange={(e) => { onEditFieldChange('name'); onUpdateItem(item.id, { name: e.target.value }); }}
            placeholder={t('review.itemNamePlaceholder')}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                priceInputRef?.current?.focus();
              }
            }}
          />
          <div className="flex gap-2">
            <input
              type="number"
              className="w-16 text-sm text-center bg-bg border border-border rounded-xl px-2 py-2 outline-none"
              value={item.quantity}
              min={1}
              onChange={(e) => {
                onEditFieldChange('quantity');
                const q = Number(e.target.value) || 1;
                onUpdateItem(item.id, { quantity: q, totalPrice: item.unitPrice * q });
              }}
            />
            <span className="text-muted self-center text-sm">×</span>
            <input
              ref={priceInputRef}
              type="number"
              className="flex-1 text-sm bg-bg border border-border rounded-xl px-3 py-2 outline-none focus:border-accent"
              value={item.unitPrice}
              step="0.01"
              onChange={(e) => {
                onEditFieldChange('price');
                const p = Number(e.target.value) || 0;
                onUpdateItem(item.id, { unitPrice: p, totalPrice: p * item.quantity });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCommit();
              }}
            />
            <button
              onClick={() => onCommit()}
              className="px-3 py-2 bg-primary text-white text-xs font-semibold rounded-xl"
            >
              {t('review.done')}
            </button>
          </div>
          {isEditing && item.flagged && (
            <p className="text-[10px] text-amber-600 mt-0.5 px-1">
              {t('review.flaggedItem')}
            </p>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className="text-muted text-xs font-semibold w-5 text-end flex-shrink-0">{index + 1}</span>
          <span className="text-lg flex-shrink-0">{getItemIcon(item.name)}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5">
              {item.quantity > 1 && (
                <span className="text-xs text-muted font-medium">{item.quantity}×</span>
              )}
              <span className="text-sm font-medium text-primary truncate">{item.name}</span>
              {item.flagged && (
                <span title="Price math doesn't add up — please check manually" className="text-amber-500 text-xs">⚠️</span>
              )}
            </div>
          </div>
          <CurrencyDisplay
            amount={item.totalPrice}
            currency={currency}
            className="text-sm font-bold text-primary whitespace-nowrap"
            showWarningForZero={item.flagged && item.totalPrice === 0}
          />
          <button onClick={() => onEdit(item.id)} className="text-muted p-1">
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(item.id)} className="text-red-400 p-1">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </motion.div>
  );
}
