/**
 * OCR Correction Dictionary
 *
 * When a user manually fixes a wrong item name in ReviewScreen, we save the
 * mapping  ocrText → correctedText  keyed by restaurant.  On the next scan of
 * the same restaurant every item name is automatically replaced before display.
 *
 * Storage: localStorage as JSON (client-only, no backend needed).
 */

const STORAGE_KEY = 'splitsnap_ocr_corrections_v1';

/** restaurantKey → { ocrText: correctedText } */
type DictionaryStore = Record<string, Record<string, string>>;

function load(): DictionaryStore {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function save(store: DictionaryStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage full or unavailable — silently skip
  }
}

/** Normalise restaurant name to a stable key */
function key(restaurantName: string): string {
  return restaurantName.trim().toLowerCase();
}

/**
 * Save a correction: for this restaurant, "ocrText" should be displayed as
 * "correctedText" on future scans.
 * If ocrText === correctedText (no change), the entry is removed.
 */
export function saveCorrection(
  restaurantName: string,
  ocrText: string,
  correctedText: string,
): void {
  if (!restaurantName || !ocrText) return;
  const store = load();
  const rKey = key(restaurantName);
  if (!store[rKey]) store[rKey] = {};

  if (ocrText === correctedText) {
    // User reverted to original — remove the entry
    delete store[rKey][ocrText];
  } else {
    store[rKey][ocrText] = correctedText;
  }
  save(store);
}

/**
 * Return the correction dictionary for a restaurant:
 * { "מיצב תפוזים": "קוקה קולה", ... }
 */
export function getCorrections(restaurantName: string | null): Record<string, string> {
  if (!restaurantName) return {};
  const store = load();
  return store[key(restaurantName)] ?? {};
}

/**
 * Apply all saved corrections to a list of item names.
 * Returns the corrected name, or the original if no correction exists.
 */
export function applyCorrection(
  restaurantName: string | null,
  ocrName: string,
): string {
  if (!restaurantName) return ocrName;
  const corrections = getCorrections(restaurantName);
  return corrections[ocrName] ?? ocrName;
}

/** Remove all corrections for a specific restaurant, or everything. */
export function clearCorrections(restaurantName?: string): void {
  if (!restaurantName) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  const store = load();
  delete store[key(restaurantName)];
  save(store);
}

/** How many corrections are stored across all restaurants. */
export function correctionCount(): number {
  const store = load();
  return Object.values(store).reduce((n, r) => n + Object.keys(r).length, 0);
}
