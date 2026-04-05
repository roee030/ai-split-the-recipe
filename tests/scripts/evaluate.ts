/**
 * SplitSnap Generic Vision Evaluator
 *
 * Evaluates 3 extraction strategies across 4 sample receipts.
 * Model cascade per call: gemini-2.0-flash → Claude (quota fallback)
 *
 * Usage:
 *   npm run evaluate          # all 3 strategies fire in parallel per image
 *   npm run evaluate:seq      # one strategy at a time (safer on free-tier keys)
 *
 * Strategies:
 *   Classic   — 2-step: image→OCR text, then text→JSON  (current prod)
 *   Direct    — 1-step: image→JSON  (minimal prompt)
 *   Optimized — 1-step: image→JSON  (high-fidelity tuned prompt)
 *
 * Scoring:
 *   When ground truth is provided  → nameScore   (Levenshtein item-name match %)
 *   When no ground truth           → priceScore  (% items with a non-null price)
 *   confidenceScore                → model self-reported confidence → 0-100
 *   composite                      → extractionScore×0.6 + confidenceScore×0.4
 *
 * Output:
 *   - Per-image table + ground-truth diff when available
 *   - Aggregate summary across all images
 *   - CLAUDE.md overwritten with winner and architecture notes
 */

import fs      from 'fs';
import path    from 'path';
import dotenv  from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ─── Keys ─────────────────────────────────────────────────────────────────────

const GEMINI_KEY    = process.env.VITE_GEMINI_API_KEY    ?? '';
const ANTHROPIC_KEY = process.env.VITE_ANTHROPIC_API_KEY ?? '';

const GEMINI_FLASH_URL   = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
const CLAUDE_API_URL     = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL       = 'claude-sonnet-4-5';

const ROOT       = process.cwd();
const SEQUENTIAL = process.argv.includes('--sequential');

// Sleep between strategies in sequential mode (ms)
const SEQ_SLEEP_MS = 20_000;
// Sleep between images (ms)
const IMG_SLEEP_MS = 5_000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Ground truth ─────────────────────────────────────────────────────────────

interface GoldenItem { name: string; quantity: number; total_price: number }

// Ground truth for the WhatsApp restaurant receipt (provided by user)
const WHATSAPP_GOLDEN: GoldenItem[] = [
  { name: 'קוקה קולה',           quantity: 1, total_price: 16  },
  { name: 'כ. לימונדה',          quantity: 2, total_price: 30  },
  { name: 'בקבוק ערק',           quantity: 1, total_price: 600 },
  { name: 'מים מינרלים גדול',    quantity: 1, total_price: 24  },
  { name: 'סלט תפוחי אדמה',     quantity: 1, total_price: 22  },
  { name: 'לחם פסח',             quantity: 1, total_price: 24  },
  { name: 'סשימי דג',            quantity: 1, total_price: 68  },
  { name: 'רוסטביף סינטה',       quantity: 2, total_price: 136 },
  { name: 'קבב טלה',             quantity: 1, total_price: 78  },
  { name: 'לברק ירוקים',         quantity: 1, total_price: 96  },
  { name: 'שיפוד נתח קצבים',    quantity: 1, total_price: 122 },
  { name: 'המבורגר',             quantity: 1, total_price: 96  },
  { name: 'קרמו שוקולד',         quantity: 2, total_price: 96  },
  { name: 'פריט כללי מטבח',      quantity: 1, total_price: 713 },
];

// ─── Sample images ────────────────────────────────────────────────────────────

interface SampleImage {
  label:   string;
  path:    string;
  golden?: GoldenItem[];
}

const SAMPLE_IMAGES: SampleImage[] = [
  {
    label:  'WhatsApp restaurant receipt (ground truth)',
    path:   path.join(ROOT, 'src', 'recipe test', 'WhatsApp Image 2026-04-03 at 12.12.13.jpeg'),
    golden: WHATSAPP_GOLDEN,
  },
  {
    label: 'Coca-Cola receipt',
    path:  path.join(ROOT, 'src', 'recipe test', 'caption.jpg'),
  },
  {
    label: 'Kabala Colbo',
    path:  path.join(ROOT, 'src', 'recipe test', 'kabala colbo.jpeg'),
  },
  {
    label: 'Recipe Test',
    path:  path.join(ROOT, 'src', 'recipe test', 'recipe_test.jpg'),
  },
];

// ─── Prompts ──────────────────────────────────────────────────────────────────

const CLASSIC_PASS1 = `You are a LOW-LEVEL OCR engine.
You ONLY copy visual characters exactly as they appear on the page.

HARD RULES:
1. DO NOT FIX TEXT — keep wrong characters wrong.
2. DO NOT COMPLETE WORDS — "לימונ" stays "לימונ", never "לימונדה".
3. CHARACTER ACCURACY OVER MEANING — wrong shape = ok, real food word = FAILURE.
4. NO NORMALIZATION.

OUTPUT: One receipt line per output line. Copy EVERY line top-to-bottom.
If not a receipt: NOT_A_RECEIPT
If unreadable:    BLURRY`;

const CLASSIC_PASS2 = `You are a JSON formatter for Israeli restaurant receipts.

RECEIPT TRANSCRIPT:
{{TRANSCRIPT}}

NAME RULE: every item "name" MUST be copied character-for-character from the TRANSCRIPT.
RECEIPT LAYOUT (Tabit): price LEFT, quantity, name RIGHT.

Return ONLY JSON (no markdown):
{
  "isReceipt": true,
  "receipt_type": "restaurant",
  "restaurantName": null,
  "currency": "ILS",
  "subtotal": null, "tax": null, "taxPercent": null,
  "serviceCharge": null, "total": null,
  "confidence": "high",
  "items": [{"name": "", "quantity": 1, "unit_price": null, "total_price": null, "price_missing": false, "sub_items": []}]
}
Skip headers, address, totals, tax rows. quantity defaults to 1.`;

const DIRECT_PROMPT = `Extract all food/drink items from this receipt image.

Return ONLY JSON (no markdown):
{
  "isReceipt": boolean,
  "restaurantName": string | null,
  "currency": "ILS",
  "subtotal": number | null,
  "total": number | null,
  "confidence": "high" | "medium" | "low",
  "items": [
    {
      "name": string,
      "quantity": number,
      "unit_price": number | null,
      "total_price": number | null,
      "price_missing": boolean
    }
  ]
}`;

const OPTIMIZED_PROMPT = `You are a HIGH-PRECISION receipt digitizer for Israeli restaurant receipts.

EXTRACTION RULES:
1. Capture EVERY food/drink item line — no skipping, no merging
2. Copy names VERBATIM from the image — no translation, correction, or completion
3. Tabit POS layout: price appears LEFT of item name
   e.g. "98.00  2 קבב טלה" → price=98, qty=2, name="קבב טלה"
4. quantity defaults to 1 when not explicitly shown
5. Extract both subtotal AND total (may differ due to service charge / tax)
6. Set price_missing=true only when a price column is genuinely absent for that item
7. confidence: "high" = all prices captured, "medium" = some missing, "low" = many missing

SKIP: restaurant header, address, phone number, QR code, loyalty/points rows,
      VAT label rows, subtotal/total rows themselves

Return ONLY this JSON with no markdown wrapper or explanation:
{
  "isReceipt": boolean,
  "receipt_type": "restaurant" | "supermarket" | "other",
  "restaurantName": string | null,
  "currency": "ILS",
  "subtotal": number | null,
  "tax": number | null,
  "taxPercent": number | null,
  "serviceCharge": number | null,
  "total": number | null,
  "confidence": "high" | "medium" | "low",
  "items": [
    {
      "name": string,
      "quantity": number,
      "unit_price": number | null,
      "total_price": number | null,
      "price_missing": boolean,
      "sub_items": []
    }
  ]
}`;

// ─── Types ────────────────────────────────────────────────────────────────────

type StrategyName = 'Classic' | 'Direct' | 'Optimized';
type ModelUsed    = 'gemini-2.0-flash' | 'claude' | 'error';

interface ExtractedItem {
  name:         string;
  quantity:     number;
  unit_price:   number | null;
  total_price:  number | null;
  price_missing?: boolean;
}

interface ExtractedReceipt {
  isReceipt?:      boolean;
  restaurantName?: string | null;
  currency?:       string;
  subtotal?:       number | null;
  total?:          number | null;
  confidence?:     'high' | 'medium' | 'low';
  items:           ExtractedItem[];
}

export interface StrategyResult {
  strategy:        StrategyName;
  modelUsed:       ModelUsed;
  latencyMs:       number;
  extractionScore: number;   // 0-100  (nameScore when golden, priceScore otherwise)
  confidenceScore: number;   // 0-100
  itemCount:       number;
  hasTotal:        boolean;
  receipt:         ExtractedReceipt | null;
  matchedItems?:   Array<{ expected: string; got: string; score: number }>;
  error?:          string;
}

// ─── Levenshtein / similarity ─────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  if (!a && !b) return 100;
  const dist   = levenshtein(a.trim(), b.trim());
  const maxLen = Math.max(a.trim().length, b.trim().length);
  return maxLen === 0 ? 100 : Math.round((1 - dist / maxLen) * 100);
}

/** Best-match Levenshtein score for each golden item against extracted items */
function scoreAgainstGolden(
  extracted: ExtractedItem[],
  golden:    GoldenItem[],
): { avgScore: number; matches: Array<{ expected: string; got: string; score: number }> } {
  const matches = golden.map(g => {
    const best = extracted.reduce(
      (best, item) => {
        const s = similarity(g.name, item.name);
        return s > best.score ? { name: item.name, score: s } : best;
      },
      { name: '', score: -1 },
    );
    return { expected: g.name, got: best.name, score: best.score };
  });
  const avgScore = matches.length
    ? Math.round(matches.reduce((s, m) => s + m.score, 0) / matches.length)
    : 0;
  return { avgScore, matches };
}

// ─── API helpers ──────────────────────────────────────────────────────────────

const C = {
  reset:   '\x1b[0m',
  green:   '\x1b[32m',
  red:     '\x1b[31m',
  yellow:  '\x1b[33m',
  bold:    '\x1b[1m',
  cyan:    '\x1b[36m',
  dim:     '\x1b[2m',
  magenta: '\x1b[35m',
  blue:    '\x1b[34m',
};

async function httpPost(url: string, headers: Record<string,string>, body: object): Promise<{ ok: boolean; status: number; json: object; text: string }> {
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body:    JSON.stringify(body),
  });
  const text = await res.text();
  let json: object = {};
  try { json = JSON.parse(text); } catch { /* text might not be JSON */ }
  return { ok: res.ok, status: res.status, json, text };
}

function extractGeminiText(json: object): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((json as any).candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
}

function extractClaudeText(json: object): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = ((json as any).content?.[0]?.text ?? '').trim();
  // Strip markdown code fences Claude sometimes adds: ```json ... ``` or ``` ... ```
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

function isQuotaError(status: number, text: string): boolean {
  return status === 429 || (status === 400 && text.includes('quota'));
}

/**
 * Single Gemini call with one retry on transient 429, then throws.
 * Caller handles the cascade to the next model.
 */
async function geminiCall(url: string, body: object): Promise<string> {
  let r = await httpPost(url, {}, body);
  if (r.status === 429) {
    // One polite retry after 30 s for per-minute limits
    console.log(`${C.yellow}  ⏳ Gemini 429 — waiting 30 s then retrying once…${C.reset}`);
    await sleep(30_000);
    r = await httpPost(url, {}, body);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.text.slice(0, 300)}`);
  return extractGeminiText(r.json);
}

/** Single Claude call — used as last-resort fallback. */
async function claudeCall(
  imageData:  string,
  mimeType:   string,
  promptText: string,
  textOnly:   boolean,
): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error('No ANTHROPIC_KEY configured');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userContent: any[] = textOnly
    ? [{ type: 'text', text: promptText }]
    : [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageData } },
        { type: 'text', text: promptText },
      ];

  const body = {
    model:      CLAUDE_MODEL,
    max_tokens: 8192,
    messages:   [{ role: 'user', content: userContent }],
  };
  const headers = {
    'x-api-key':         ANTHROPIC_KEY,
    'anthropic-version': '2023-06-01',
  };
  const r = await httpPost(CLAUDE_API_URL, headers, body);
  if (!r.ok) throw new Error(`Claude HTTP ${r.status}: ${r.text.slice(0, 300)}`);
  return extractClaudeText(r.json);
}

/**
 * Vision call with model cascade:
 *   gemini-2.0-flash  →  claude
 * Returns { text, modelUsed }.
 */
async function visionCall(
  imageData: string,
  mimeType:  string,
  prompt:    string,
  wantJson:  boolean,
): Promise<{ text: string; modelUsed: ModelUsed }> {
  const geminiBody = {
    contents: [{ parts: [
      { inline_data: { mime_type: mimeType, data: imageData } },
      { text: prompt },
    ]}],
    generationConfig: {
      ...(wantJson ? { responseMimeType: 'application/json' } : {}),
      maxOutputTokens: 8192,
      temperature:     0,
      thinkingConfig:  { thinkingBudget: 0 },
    },
  };

  // Tier 1 — gemini-2.0-flash
  try {
    const text = await geminiCall(GEMINI_FLASH_URL, geminiBody);
    return { text, modelUsed: 'gemini-2.0-flash' };
  } catch (e1) {
    const e1s = String(e1);
    if (!isQuotaError(0, e1s) && !e1s.includes('429') && !e1s.includes('quota')) throw e1;
    console.log(`${C.yellow}  ⚡ gemini-2.0-flash quota — cascading to Claude…${C.reset}`);
  }

  await sleep(3_000);

  // Tier 2 — Claude
  const text = await claudeCall(imageData, mimeType, prompt, false);
  return { text, modelUsed: 'claude' };
}

/**
 * Text-only call (Pass 2) with cascade:
 *   gemini-2.0-flash  →  claude
 */
async function textCall(
  prompt: string,
): Promise<{ text: string; modelUsed: ModelUsed }> {
  const geminiBody = {
    contents:         [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens:  8192,
      temperature:      0,
      thinkingConfig:   { thinkingBudget: 0 },
    },
  };

  // Tier 1
  try {
    const text = await geminiCall(GEMINI_FLASH_URL, geminiBody);
    return { text, modelUsed: 'gemini-2.0-flash' };
  } catch (e1) {
    const e1s = String(e1);
    if (!isQuotaError(0, e1s) && !e1s.includes('429') && !e1s.includes('quota')) throw e1;
    console.log(`${C.yellow}  ⚡ gemini-2.0-flash quota (Pass2) — cascading to Claude…${C.reset}`);
  }

  await sleep(3_000);

  // Tier 2 — Claude text-only
  const text = await claudeCall('', '', prompt, true);
  return { text, modelUsed: 'claude' };
}

// ─── Scoring helpers ──────────────────────────────────────────────────────────

function scoreReceipt(
  receipt: ExtractedReceipt,
  golden?: GoldenItem[],
): Pick<StrategyResult, 'extractionScore' | 'confidenceScore' | 'itemCount' | 'hasTotal' | 'matchedItems'> {
  const items = receipt.items ?? [];

  let extractionScore: number;
  let matchedItems: StrategyResult['matchedItems'];

  if (golden && golden.length > 0) {
    const { avgScore, matches } = scoreAgainstGolden(items, golden);
    extractionScore = avgScore;
    matchedItems    = matches;
  } else {
    const withPrice = items.filter(i => (i.total_price ?? i.unit_price) != null).length;
    extractionScore = items.length > 0 ? Math.round(withPrice / items.length * 100) : 0;
  }

  const confMap: Record<string, number> = { high: 100, medium: 70, low: 40 };
  const confidenceScore = confMap[receipt.confidence ?? 'medium'] ?? 70;

  return { extractionScore, confidenceScore, itemCount: items.length, hasTotal: receipt.total != null, matchedItems };
}

function errResult(strategy: StrategyName, latencyMs: number, err: unknown): StrategyResult {
  return {
    strategy, modelUsed: 'error', latencyMs,
    extractionScore: 0, confidenceScore: 0, itemCount: 0, hasTotal: false,
    receipt: null, error: String(err),
  };
}

// ─── Strategy runners ─────────────────────────────────────────────────────────

async function runClassic(data: string, mimeType: string, golden?: GoldenItem[]): Promise<StrategyResult> {
  const t0 = Date.now();
  try {
    // Pass 1 — image → OCR text
    const p1 = await visionCall(data, mimeType, CLASSIC_PASS1, false);
    const transcript = p1.text;
    if (transcript.startsWith('NOT_A_RECEIPT') || transcript.startsWith('BLURRY')) {
      return errResult('Classic', Date.now() - t0, `Pass1: ${transcript}`);
    }

    // Inter-pass pause (mirrors production 1500 ms)
    await sleep(2_000);

    // Pass 2 — text → JSON
    const prompt2  = CLASSIC_PASS2.replace('{{TRANSCRIPT}}', transcript);
    const p2       = await textCall(prompt2);
    const receipt  = JSON.parse(p2.text) as ExtractedReceipt;
    const modelUsed = (p1.modelUsed !== p2.modelUsed
      ? `${p1.modelUsed}+${p2.modelUsed}` as ModelUsed
      : p1.modelUsed);

    return {
      strategy:  'Classic',
      modelUsed: modelUsed as ModelUsed,
      latencyMs: Date.now() - t0,
      ...scoreReceipt(receipt, golden),
      receipt,
    };
  } catch (err) {
    return errResult('Classic', Date.now() - t0, err);
  }
}

async function runDirect(data: string, mimeType: string, golden?: GoldenItem[]): Promise<StrategyResult> {
  const t0 = Date.now();
  try {
    const r       = await visionCall(data, mimeType, DIRECT_PROMPT, true);
    const receipt = JSON.parse(r.text) as ExtractedReceipt;
    return { strategy: 'Direct', modelUsed: r.modelUsed, latencyMs: Date.now() - t0, ...scoreReceipt(receipt, golden), receipt };
  } catch (err) {
    return errResult('Direct', Date.now() - t0, err);
  }
}

async function runOptimized(data: string, mimeType: string, golden?: GoldenItem[]): Promise<StrategyResult> {
  const t0 = Date.now();
  try {
    const r       = await visionCall(data, mimeType, OPTIMIZED_PROMPT, true);
    const receipt = JSON.parse(r.text) as ExtractedReceipt;
    return { strategy: 'Optimized', modelUsed: r.modelUsed, latencyMs: Date.now() - t0, ...scoreReceipt(receipt, golden), receipt };
  } catch (err) {
    return errResult('Optimized', Date.now() - t0, err);
  }
}

// ─── Composite ────────────────────────────────────────────────────────────────

function composite(r: StrategyResult): number {
  return Math.round(r.extractionScore * 0.6 + r.confidenceScore * 0.4);
}

// ─── Output formatting ────────────────────────────────────────────────────────

const COL_W = [11, 22, 10, 10, 7, 7, 11] as const;
const COL_H = ['Strategy', 'Model', 'Extr%', 'Conf%', 'Items', 'Total', 'Composite'];

function tableRow(cells: string[]): string {
  return '  ' + cells.map((c, i) => c.slice(0, COL_W[i]).padEnd(COL_W[i])).join(' ');
}

function modelLabel(m: ModelUsed): string {
  if (m === 'gemini-2.0-flash') return '2.0-flash';
  if (m === 'claude')           return 'claude-sonnet-4-5';
  return m;
}

function printImageSection(label: string, results: StrategyResult[], hasGolden: boolean) {
  const scoreLabel = hasGolden ? 'Name%' : 'Price%';
  const headers    = [COL_H[0], COL_H[1], scoreLabel, COL_H[3], COL_H[4], COL_H[5], COL_H[6]];

  console.log(`\n${C.cyan}${C.bold}── ${label} ──${C.reset}`);
  console.log(tableRow(headers));
  console.log('  ' + COL_W.map(w => '─'.repeat(w)).join(' '));

  const valid = results.filter(r => !r.error);
  const best  = valid.length ? valid.reduce((a, b) => composite(a) >= composite(b) ? a : b) : null;

  for (const r of results) {
    const comp  = composite(r);
    const cells = [
      r.strategy,
      r.error ? '-' : modelLabel(r.modelUsed),
      r.error ? 'ERROR' : `${r.extractionScore}%`,
      r.error ? 'ERROR' : `${r.confidenceScore}%`,
      r.error ? '-'     : String(r.itemCount),
      r.error ? '-'     : (r.hasTotal ? '✓' : '✗'),
      r.error ? 'ERROR' : `${comp}%`,
    ];
    const line = tableRow(cells);
    if (r.error) {
      console.log(`${C.red}${line}${C.reset}`);
      console.log(`${C.red}     Error: ${r.error.slice(0, 120)}${C.reset}`);
    } else if (r === best) {
      console.log(`${C.green}${line}  ← best${C.reset}`);
    } else {
      console.log(line);
    }
  }

  // Ground truth diff for the best strategy
  const bestWithMatches = results.find(r => r === best && r.matchedItems);
  if (bestWithMatches?.matchedItems) {
    console.log(`\n  ${C.bold}Ground truth diff (${bestWithMatches.strategy}):${C.reset}`);
    const w = 24;
    console.log(`  ${'Expected'.padEnd(w)} ${'Got'.padEnd(w)} Score`);
    console.log(`  ${'─'.repeat(w)} ${'─'.repeat(w)} ─────`);
    for (const m of bestWithMatches.matchedItems) {
      const icon = m.score >= 90 ? C.green + '✓' : m.score >= 70 ? C.yellow + '~' : C.red + '✗';
      console.log(`  ${m.expected.padEnd(w)} ${m.got.padEnd(w)} ${icon} ${m.score}%${C.reset}`);
    }
  }
}

// ─── Aggregate ────────────────────────────────────────────────────────────────

interface AggRow { strategy: StrategyName; avgExtr: number; avgConf: number; avgComp: number; avgLatency: number }

function buildAgg(allResults: Array<{ results: StrategyResult[] }>): AggRow[] {
  return (['Classic', 'Direct', 'Optimized'] as StrategyName[]).map(s => {
    const rows = allResults.flatMap(a => a.results.filter(r => r.strategy === s && !r.error));
    const n    = rows.length || 1;
    return {
      strategy:   s,
      avgExtr:    Math.round(rows.reduce((a, r) => a + r.extractionScore, 0) / n),
      avgConf:    Math.round(rows.reduce((a, r) => a + r.confidenceScore, 0) / n),
      avgComp:    Math.round(rows.reduce((a, r) => a + composite(r), 0) / n),
      avgLatency: Math.round(rows.reduce((a, r) => a + r.latencyMs, 0) / n),
    };
  });
}

function printAggregate(agg: AggRow[], imageCount: number): StrategyName {
  const W2 = [12, 12, 12, 12, 14] as const;
  const H2 = ['Strategy', 'Avg Extr%', 'Avg Conf%', 'Avg Comp%', 'Avg Latency'];
  const row2 = (cells: string[]) => '  ' + cells.map((c, i) => c.padEnd(W2[i])).join(' ');

  console.log(`\n${C.bold}${'═'.repeat(72)}${C.reset}`);
  console.log(`${C.bold} AGGREGATE SUMMARY  (avg across ${imageCount} image${imageCount !== 1 ? 's' : ''})${C.reset}`);
  console.log(`${C.bold}${'═'.repeat(72)}${C.reset}`);
  console.log(row2(H2));
  console.log('  ' + W2.map(w => '─'.repeat(w)).join(' '));

  const winner = agg.reduce((a, b) => a.avgComp >= b.avgComp ? a : b);
  for (const r of agg) {
    const cells = [r.strategy, `${r.avgExtr}%`, `${r.avgConf}%`, `${r.avgComp}%`, `${r.avgLatency}ms`];
    const line  = row2(cells);
    console.log(r === winner
      ? `${C.green}${C.bold}${line}${C.reset}${C.green}  ← WINNER${C.reset}`
      : line);
  }

  console.log();
  console.log(`${C.bold}🏆 Winner: ${C.green}${winner.strategy}${C.reset}`);
  if (winner.strategy === 'Classic') {
    console.log(`   Two-pass production pipeline is optimal — no code changes required.`);
  } else {
    console.log(`   ${C.yellow}Recommendation: switch production to ${winner.strategy} strategy.${C.reset}`);
  }
  return winner.strategy;
}

// ─── CLAUDE.md writer ─────────────────────────────────────────────────────────

function writeClaude(winner: StrategyName, agg: AggRow[]) {
  const claudePath = path.join(ROOT, 'CLAUDE.md');
  const ts = new Date().toISOString().slice(0, 10);

  const tableRows = agg.map(r =>
    `| ${r.strategy.padEnd(10)} | ${`${r.avgExtr}%`.padEnd(10)} | ${`${r.avgConf}%`.padEnd(10)} | ${`${r.avgComp}%`.padEnd(10)} | ${`${r.avgLatency}ms`.padEnd(12)} |`
  ).join('\n');

  const winnerNote = winner === 'Classic'
    ? `**Classic** (two-pass pipeline) is the production default. No changes needed.`
    : winner === 'Optimized'
    ? `**Optimized** (one-shot high-fidelity) outperforms the two-pass approach.\n\n` +
      `To implement: update Pass 1 in \`src/services/geminiVision.ts\` to send image + ` +
      `\`OPTIMIZED_PROMPT\` in a single call with \`responseMimeType: 'application/json'\`, ` +
      `bypassing Pass 2 entirely.`
    : `**Direct** (one-shot minimal) outperforms the two-pass approach.\n\n` +
      `To implement: add a single-pass mode in \`src/services/geminiVision.ts\` using ` +
      `\`DIRECT_PROMPT\` with \`responseMimeType: 'application/json'\`.`;

  const content =
`# SplitSnap — Architecture Notes

## Vision Strategy Evaluation

Last evaluated: **${ts}**
Tool: \`tests/scripts/evaluate.ts\`
Models tested: Gemini 2.0 Flash → Claude Sonnet 4.5 (cascade fallback)

---

### Scoring Methodology

| Metric            | Weight | Definition                                                 |
|-------------------|--------|------------------------------------------------------------|
| extractionScore   |  60 %  | Levenshtein name-match % (golden) or price-present % (self)|
| confidenceScore   |  40 %  | Model self-reported confidence mapped to 0-100             |
| **composite**     | 100 %  | Weighted sum                                               |

Ground truth provided for: WhatsApp restaurant receipt (14 items).

---

### Strategy Descriptions

| Strategy  | Passes | Description                                                   |
|-----------|--------|---------------------------------------------------------------|
| Classic   | 2      | image→OCR text (Pass 1), then text→JSON (Pass 2)              |
| Direct    | 1      | image→JSON, minimal extraction prompt                         |
| Optimized | 1      | image→JSON, high-fidelity Hebrew receipt prompt               |

---

### Results (avg across 4 sample receipts)

| Strategy   | Avg Extr%  | Avg Conf%  | Avg Comp%  | Avg Latency  |
|------------|------------|------------|------------|--------------|
${tableRows}

---

### Production Decision

${winnerNote}

---

### How to Re-run

\`\`\`bash
npm run evaluate      # parallel (paid keys)
npm run evaluate:seq  # sequential, 20 s gap (free-tier keys)
\`\`\`

---

### Production Configuration

Provider defaults (\`src/config/providers.ts\`):

\`\`\`
VITE_PASS1_PROVIDER=gemini-2.0-flash   # image → OCR text
VITE_PASS2_PROVIDER=gemini-2.0-flash   # OCR text → JSON
VITE_MAGIC_PROVIDER=gemini-2.0-flash   # math self-healing (Pass 3)
\`\`\`

Override via \`.env.local\` — no code changes needed.
Valid values: \`gemini-2.0-flash\` | \`gemini-2.5-flash\` | \`gemini-1.5-pro\` | \`claude-sonnet-4-5\`

---

### Fallback Chain (\`src/services/geminiVision.ts\`)

1. **Tier 1** — configured primary provider
2. **Tier 2** — \`gemini-2.0-flash\` on transient 429 / 500
3. **Tier 3** — \`claude-sonnet-4-5\` on daily Gemini quota exhaustion
   (requires \`VITE_ANTHROPIC_API_KEY\` or \`VITE_ANTHROPIC_PROXY_URL\`)
`;

  fs.writeFileSync(claudePath, content, 'utf8');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!GEMINI_KEY && !ANTHROPIC_KEY) {
    console.error(`${C.red}No API keys found. Set VITE_GEMINI_API_KEY and/or VITE_ANTHROPIC_API_KEY in .env.local${C.reset}`);
    process.exit(1);
  }
  if (!GEMINI_KEY)    console.log(`${C.yellow}⚠ No Gemini key — will use Claude for all calls${C.reset}`);
  if (!ANTHROPIC_KEY) console.log(`${C.dim}ℹ No Anthropic key — no Claude fallback${C.reset}`);

  const available = SAMPLE_IMAGES.filter(img => fs.existsSync(img.path));
  if (available.length === 0) {
    console.error(`${C.red}No sample images found in src/recipe test/${C.reset}`);
    process.exit(1);
  }

  const mode = SEQUENTIAL ? 'sequential' : 'parallel';
  console.log(`\n${C.bold}${C.magenta}SplitSnap Vision Evaluator${C.reset}`);
  console.log(`${C.dim}3 strategies × ${available.length} image${available.length !== 1 ? 's' : ''} — ${mode} mode${C.reset}`);
  console.log(`${C.dim}Model cascade: gemini-2.0-flash → claude (quota fallback)${C.reset}`);
  console.log(`${C.dim}Scoring: extractionScore×0.6 + confidenceScore×0.4 = composite${C.reset}`);

  const allResults: Array<{ label: string; results: StrategyResult[] }> = [];

  for (let i = 0; i < available.length; i++) {
    const img = available[i];
    process.stdout.write(`\n${C.dim}[${i + 1}/${available.length}] Loading "${img.label}"…${C.reset} `);
    const imgBytes = fs.readFileSync(img.path);
    const ext      = path.extname(img.path).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    const data     = imgBytes.toString('base64');
    console.log(`${C.dim}${Math.round(data.length * 3 / 4 / 1024)} KB${C.reset}`);

    let classic:   StrategyResult;
    let direct:    StrategyResult;
    let optimized: StrategyResult;

    if (SEQUENTIAL) {
      console.log(`${C.dim}  Running Classic…${C.reset}`);
      classic   = await runClassic(data, mimeType, img.golden);
      console.log(`${C.dim}  Classic done (${classic.latencyMs}ms) — sleeping ${SEQ_SLEEP_MS/1000}s…${C.reset}`);
      await sleep(SEQ_SLEEP_MS);

      console.log(`${C.dim}  Running Direct…${C.reset}`);
      direct    = await runDirect(data, mimeType, img.golden);
      console.log(`${C.dim}  Direct done (${direct.latencyMs}ms) — sleeping ${SEQ_SLEEP_MS/1000}s…${C.reset}`);
      await sleep(SEQ_SLEEP_MS);

      console.log(`${C.dim}  Running Optimized…${C.reset}`);
      optimized = await runOptimized(data, mimeType, img.golden);
      console.log(`${C.dim}  Optimized done (${optimized.latencyMs}ms)${C.reset}`);
    } else {
      [classic, direct, optimized] = await Promise.all([
        runClassic(data, mimeType, img.golden),
        runDirect(data, mimeType, img.golden),
        runOptimized(data, mimeType, img.golden),
      ]);
    }

    const results: StrategyResult[] = [classic, direct, optimized];
    printImageSection(img.label, results, !!img.golden);
    allResults.push({ label: img.label, results });

    if (i < available.length - 1) {
      console.log(`\n${C.dim}  Sleeping ${IMG_SLEEP_MS/1000}s before next image…${C.reset}`);
      await sleep(IMG_SLEEP_MS);
    }
  }

  const agg    = buildAgg(allResults);
  const winner = printAggregate(agg, allResults.length);

  writeClaude(winner, agg);
  console.log(`\n${C.green}✔ CLAUDE.md updated with evaluation results.${C.reset}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
