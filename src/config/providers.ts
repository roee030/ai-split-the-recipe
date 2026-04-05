import type { ProviderName } from '../types/providers';

/**
 * Provider flags — switch AI models per pass via .env.local, no code changes needed.
 *
 * VITE_PASS1_PROVIDER  — vision OCR   (must support image input)
 * VITE_PASS2_PROVIDER  — text → JSON  (text-only, fast/cheap)
 * VITE_MAGIC_PROVIDER  — Magic Fix    (text-only, accuracy-focused)
 *
 * Valid values: 'gemini-3.1-flash-lite-preview' | 'gemini-2.0-flash' | 'gemini-2.5-flash' | 'gemini-1.5-flash' | 'claude-sonnet-4-5'
 * Default:      'gemini-3.1-flash-lite-preview' — benchmark winner (6.9s TTFB, 91% composite, 100% JSON OK)
 */
export const PROVIDERS = {
  pass1: (import.meta.env.VITE_PASS1_PROVIDER ?? 'gemini-3.1-flash-lite-preview') as ProviderName,
  pass2: (import.meta.env.VITE_PASS2_PROVIDER ?? 'gemini-3.1-flash-lite-preview') as ProviderName,
  magic: (import.meta.env.VITE_MAGIC_PROVIDER ?? 'gemini-3.1-flash-lite-preview') as ProviderName,
} as const;
