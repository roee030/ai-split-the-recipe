export interface ReceiptItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  category: 'food' | 'drink' | 'dessert' | 'other';
  isEdited: boolean;
}

export interface ParsedReceipt {
  restaurantName: string | null;
  items: RawReceiptItem[];
  subtotal: number | null;
  tax: number | null;
  taxPercent: number | null;
  serviceCharge: number | null;
  total: number | null;
  currency: 'ILS' | 'USD' | 'EUR' | 'GBP' | 'other';
  confidence: 'high' | 'medium' | 'low';
}

export interface RawReceiptItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  category: 'food' | 'drink' | 'dessert' | 'other';
}
