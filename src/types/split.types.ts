import type { ReceiptItem } from './receipt.types';

export interface Person {
  id: string;
  name: string;
  color: string;
  avatar: string; // initials
}

export interface ItemClaim {
  itemId: string;
  personIds: string[];
  quantityPerPerson?: Record<string, number>;
}

export type TipMode = 'percent' | 'amount';
export type TipSplitMode = 'proportional' | 'equal';

export interface TipConfig {
  mode: TipMode;
  value: number;
  splitMode: TipSplitMode;
}

export interface SplitSession {
  receiptItems: ReceiptItem[];
  people: Person[];
  claims: ItemClaim[];
  tip: TipConfig;
  tax: number;
  serviceCharge: number;
  subtotal: number | null;
  restaurantName: string | null;
  currency: string;
  scanConfidence: 'high' | 'medium' | 'low' | null;
  splitMode: 'solo' | 'whole' | 'some' | null;
  lastTranscript: string | null;
  processingPhase: 'scanning' | 'analyzing' | null;
  /** DEV-only: full data URL of the image that was sent to Gemini. */
  debugImageUrl: string | null;
  /** True when the scan pipeline auto-ran Pass 3 (Magic Fix) and it succeeded. */
  autoFixed: boolean;
}

export type Screen =
  | 'home'
  | 'processing'
  | 'review'
  | 'people'
  | 'claim'
  | 'tip'
  | 'summary'
  | 'roundrobin'
  | 'privacy'
  | 'terms'
  | 'settings';

export interface PersonTotal {
  personId: string;
  subtotal: number;
  tipAmount: number;
  taxAmount: number;
  serviceAmount: number;
  total: number;
  items: Array<{ name: string; amount: number; shared: boolean }>;
}
