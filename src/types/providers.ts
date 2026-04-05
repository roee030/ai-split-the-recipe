/** All AI provider identifiers recognised by the adapter layer. */
export type ProviderName =
  | 'gemini-3.1-flash-lite-preview' // benchmark winner: 6.9s TTFB · 91% composite · fastest + most accurate
  | 'gemini-2.0-flash'
  | 'gemini-2.5-flash'
  | 'gemini-1.5-flash'              // replaces deprecated gemini-1.5-pro (same free quota, faster)
  | 'gemini-2.0-flash-lite'         // lightest + cheapest Gemini option
  | 'claude-sonnet-4-5';
