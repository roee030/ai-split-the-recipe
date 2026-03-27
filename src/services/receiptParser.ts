import type { ParsedReceipt, ReceiptItem } from '../types/receipt.types';
import { generateId } from '../utils/idGenerator';

export function parseReceiptToItems(parsed: ParsedReceipt): ReceiptItem[] {
  return parsed.items.map((item) => ({
    id: item.id || generateId(),
    name: item.name,
    quantity: item.quantity || 1,
    unitPrice: item.unitPrice,
    totalPrice: item.totalPrice,
    category: item.category || 'other',
    isEdited: false,
  }));
}

export function createManualItem(): ReceiptItem {
  return {
    id: generateId(),
    name: '',
    quantity: 1,
    unitPrice: 0,
    totalPrice: 0,
    category: 'food',
    isEdited: true,
  };
}
