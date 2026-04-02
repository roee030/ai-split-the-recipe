// Typed event names and property schemas.
// MonitoringEvent is the union of all event names.
// EventProperties maps each event name to its required properties.

// ── Scan flow ──────────────────────────────────────────────────────────────

export interface ScanStartedProps {
  source: 'camera' | 'upload';
}

export interface ScanOcrCompletedProps {
  pass1_input_tokens: number;
  pass1_output_tokens: number;
}

export interface ScanCompletedProps {
  receipt_type: string;
  item_count: number;
  confidence: string;
  pass1_input_tokens: number;
  pass1_output_tokens: number;
  pass2_input_tokens: number;
  pass2_output_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  estimated_cost_usd: number;
}

export interface ScanFailedProps {
  error_code: string;
  failed_pass: 1 | 2;
  total_input_tokens: number;
  total_output_tokens: number;
  estimated_cost_usd: number;
}

export interface ScanRetriedProps {
  previous_error_code: string;
}

// ── Editing (prompt quality signal) ───────────────────────────────────────

export interface ItemManuallyEditedProps {
  field: 'name' | 'price' | 'quantity';
  receipt_type: string;
  confidence: string;
}

export interface ItemAddedManuallyProps {
  receipt_type: string;
}

export interface ItemDeletedProps {
  receipt_type: string;
}

// ── Split flow ─────────────────────────────────────────────────────────────

export interface ScreenViewedProps {
  screen: string;
}

export interface SplitCompletedProps {
  person_count: number;
  item_count: number;
  has_tip: boolean;
  tip_percent: number;
  currency: string;
  receipt_type: string;
}

export interface SummarySharedProps {
  method: 'native' | 'clipboard';
}

// ── Auth + monetisation ────────────────────────────────────────────────────

export interface SignInCompletedProps {
  method: 'google' | 'email';
}

// Events with no extra properties use an empty object type alias
export type SignOutProps       = Record<string, never>;
export interface PaywallShownProps { scans_used: number; }
export type PaywallConvertedProps = Record<string, never>;

// ── Registry ──────────────────────────────────────────────────────────────

export type MonitoringEvent =
  | 'scan_started'
  | 'scan_ocr_completed'
  | 'scan_completed'
  | 'scan_failed'
  | 'scan_retried'
  | 'item_manually_edited'
  | 'item_added_manually'
  | 'item_deleted'
  | 'screen_viewed'
  | 'split_completed'
  | 'summary_shared'
  | 'sign_in_completed'
  | 'sign_out'
  | 'paywall_shown'
  | 'paywall_converted';

export interface EventProperties {
  scan_started:        ScanStartedProps;
  scan_ocr_completed:  ScanOcrCompletedProps;
  scan_completed:      ScanCompletedProps;
  scan_failed:         ScanFailedProps;
  scan_retried:        ScanRetriedProps;
  item_manually_edited: ItemManuallyEditedProps;
  item_added_manually: ItemAddedManuallyProps;
  item_deleted:        ItemDeletedProps;
  screen_viewed:       ScreenViewedProps;
  split_completed:     SplitCompletedProps;
  summary_shared:      SummarySharedProps;
  sign_in_completed:   SignInCompletedProps;
  sign_out:            SignOutProps;
  paywall_shown:       PaywallShownProps;
  paywall_converted:   PaywallConvertedProps;
}
