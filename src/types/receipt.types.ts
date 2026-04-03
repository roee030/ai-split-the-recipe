export interface ReceiptItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  category: 'food' | 'drink' | 'dessert' | 'other';
  isEdited: boolean;
  hasExtras?: boolean;
  flagged?: boolean;
}

export interface RawSubItem {
  name: string;
  price: number | null; // positive = extra charge, negative = discount/reduction
}

export interface RawReceiptItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  category: 'food' | 'drink' | 'dessert' | 'other';
  sub_items?: RawSubItem[];
  unit_price?: number | null;   // Gemini field name (snake_case)
  total_price?: number | null;  // Gemini field name (snake_case)
  price_missing?: boolean;
}

export interface ParsedReceipt {
  isReceipt: boolean;
  receipt_type: 'grocery' | 'restaurant' | 'gas' | 'other';
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
