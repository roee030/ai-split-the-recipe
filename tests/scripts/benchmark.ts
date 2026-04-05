/**
 * SplitSnap Model Benchmarker
 *
 * Benchmarks 3 Gemini model tiers on speed AND accuracy using the
 * Optimized single-pass strategy (proven winner from evaluate.ts).
 *
 * Usage:
 *   npm run benchmark          # run all models on all images
 *   npm run benchmark:seq      # alias (sequential is always used here)
 *
 * Models:
 *   gemini-3.1-flash-lite-preview  Flash Lite — speed target   (4 s wait)
 *   gemini-3-flash-preview          Flash      — balanced        (4 s wait)
 *   gemini-3.1-pro-preview          Pro        — accuracy brain  (32 s wait)
 *
 * Smart wait (free-tier rate limits):
 *   Flash  → 4 s after every call   (~15 RPM budget)
 *   Pro    → 32 s after every call  (~2 RPM budget)
 *
 * Metrics per model × image:
 *   TTFB          — ms until first response byte (headers received)
 *   Total         — ms until full response body parsed
 *   Extraction%   — Levenshtein name-match vs golden, or price-present%
 *   ₪ OK          — currency correctly identified as ILS for Hebrew receipts
 *   Date OK       — Israeli DD/MM/YYYY format present in raw OCR response
 *   JSON OK       — first-try JSON.parse succeeds without a retry
 *
 * Output:
 *   Per-model results table
 *   Aggregate ranking across all images
 *   CLAUDE.md updated with Pass 1 (speed) / Pass 2 (accuracy) model choice
 */

import fs     from 'fs';
import path   from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ─── Config ───────────────────────────────────────────────────────────────────

const GEMINI_KEY = process.env.VITE_GEMINI_API_KEY ?? '';
const ROOT       = process.cwd();

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

type Tier = 'flash' | 'pro';

interface ModelConfig {
  id:     string;
  label:  string;
  tier:   Tier;
  waitMs: number;   // ms to sleep after every API call (free-tier RPM guard)
}

const MODELS: ModelConfig[] = [
  { id: 'gemini-3.1-flash-lite-preview', label: 'Flash Lite', tier: 'flash', waitMs:  4_000 },
  { id: 'gemini-3-flash-preview',         label: 'Flash',      tier: 'flash', waitMs:  4_000 },
  { id: 'gemini-3.1-pro-preview',          label: 'Pro',        tier: 'pro',   waitMs: 32_000 },
];

function geminiUrl(modelId: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GEMINI_KEY}`;
}

// ─── Ground truth ─────────────────────────────────────────────────────────────

interface GoldenItem { name: string; quantity: number; total_price: number }

const WHATSAPP_GOLDEN: GoldenItem[] = [
  { name: 'קוקה קולה',                    quantity: 1, total_price:  16  },
  { name: 'כ. לימונדה',                   quantity: 2, total_price:  30  },
  { name: 'בקבוק ערק',                    quantity: 1, total_price: 600  },
  { name: 'מים מינרלים גדול',             quantity: 1, total_price:  24  },
  { name: 'סלט תפוחי אדמה',              quantity: 1, total_price:  22  },
  { name: 'לחם פסח',                      quantity: 1, total_price:  24  },
  { name: 'סשימי דג',                     quantity: 1, total_price:  68  },
  { name: 'רוסטביף סינטה',               quantity: 2, total_price: 136  },
  { name: 'קבב טלה',                      quantity: 1, total_price:  78  },
  { name: 'לברק ירוקים',                  quantity: 1, total_price:  96  },
  { name: 'שיפוד נתח קצבים',             quantity: 1, total_price: 122  },
  { name: 'המבורגר',                      quantity: 1, total_price:  96  },
  { name: 'קרמו שוקולד',                  quantity: 2, total_price:  96  },
  { name: 'פריט כללי מטבח',              quantity: 1, total_price: 713  },
];

const CAPTION_GOLDEN: GoldenItem[] = [
  { name: 'סאן פלגרינו',                  quantity: 1, total_price:  25  },
  { name: 'סלט קיסר',                     quantity: 1, total_price:  53  },
  { name: 'שניצל עגל',                    quantity: 2, total_price: 158  },
  { name: 'טירמיסו',                      quantity: 1, total_price:  39  },
  { name: 'קרם לימון ומרנג',              quantity: 1, total_price:  42  },
];

const RECIPE_GOLDEN: GoldenItem[] = [
  { name: 'סלט חלומי ופטריות',            quantity: 1, total_price:  69  },
  { name: 'לחם דגנים',                    quantity: 1, total_price:   0  },
  { name: 'תוספת סלט אישי',              quantity: 1, total_price:  12  },
  { name: 'סלט קיצוץ',                    quantity: 1, total_price:   0  },
  { name: 'לימונענע גרוס',               quantity: 1, total_price:  19  },
  { name: 'כללי מטבח',                    quantity: 1, total_price:   0  },
  { name: 'חידוש כרטיס מועדון',          quantity: 1, total_price:  30  },
  { name: 'הנחה (הנחת מועדון קאשבק)',    quantity: 1, total_price: -10  },
];

const KABALA_GOLDEN: GoldenItem[] = [
  { name: 'פלפל אדום ולא בצל אדום',      quantity: 1, total_price: 0 },
  { name: 'קוטג 5% תנובה',               quantity: 3, total_price: 0 },
  { name: 'טחינה - הר ברכה',             quantity: 1, total_price: 0 },
  { name: 'קוטג 5 % תמונה',              quantity: 3, total_price: 0 },
  { name: 'עגבניות',                      quantity: 1, total_price: 0 },
  { name: 'פלפל חריף',                    quantity: 1, total_price: 0 },
  { name: 'כרובית',                       quantity: 1, total_price: 0 },
  { name: 'שוקולית של עלית',              quantity: 1, total_price: 0 },
  { name: 'כמון טחון 120 גרם',            quantity: 1, total_price: 0 },
  { name: 'מלפפון',                       quantity: 1, total_price: 0 },
  { name: 'כרובית',                       quantity: 1, total_price: 0 },
  { name: 'חציל רממה',                    quantity: 1, total_price: 0 },
  { name: 'מיונז הלמאנס לייט',           quantity: 1, total_price: 0 },
  { name: 'תפוח אדמה אדום',               quantity: 1, total_price: 0 },
  { name: 'חומוס חריף המערב',             quantity: 1, total_price: 0 },
  { name: 'שקיות גופיה לבן',              quantity: 3, total_price: 0 },
  { name: 'תיבול תפוחי אמה',              quantity: 1, total_price: 0 },
  { name: 'טופו בזיליקום',               quantity: 1, total_price: 0 },
  { name: 'כרוב אדום',                    quantity: 1, total_price: 0 },
  { name: 'גזר מרוקאי 150 גרם',           quantity: 1, total_price: 0 },
  { name: 'פפריקה מתוקה פרג',             quantity: 1, total_price: 0 },
  { name: 'סודה לשתייה 100 גר',           quantity: 1, total_price: 0 },
  { name: 'עמק מופחת שומן',               quantity: 1, total_price: 0 },
  { name: 'חלב אורז שקדים',              quantity: 1, total_price: 0 },
];

const CAPTION2_GOLDEN: GoldenItem[] = [
  { name: 'MOJITO',             quantity: 2, total_price: 16.00 },
  { name: 'APEROL SPRITZ',      quantity: 1, total_price:  6.50 },
  { name: 'AGUA 1.5 L',         quantity: 1, total_price:  2.50 },
  { name: 'ENTRECOT',           quantity: 1, total_price: 15.50 },
  { name: 'BURGER PLATJA PALS', quantity: 1, total_price: 12.50 },
  { name: 'BURGER PLATJA PALS', quantity: 1, total_price: 12.50 },
  { name: 'COSTILLAS DE CERDO', quantity: 1, total_price: 15.50 },
  { name: 'PATATAS BRAVAS',     quantity: 1, total_price:  7.00 },
  { name: 'CROQUETA JAMON',     quantity: 1, total_price:  9.00 },
  { name: 'CAFE',               quantity: 2, total_price:  3.00 },
];

// ─── Sample images ────────────────────────────────────────────────────────────

interface SampleImage {
  label:        string;
  path:         string;
  golden:       GoldenItem[];
  expectShekel: boolean;   // response.currency should be 'ILS'
  expectEuro:   boolean;   // response.currency should be 'EUR'
  expectDate:   boolean;   // raw response text should contain DD/MM/YYYY
}

const SAMPLE_IMAGES: SampleImage[] = [
  {
    label:        'WhatsApp restaurant receipt',
    path:         path.join(ROOT, 'src', 'recipe test', 'WhatsApp Image 2026-04-03 at 12.12.13.jpeg'),
    golden:       WHATSAPP_GOLDEN,
    expectShekel: true, expectEuro: false, expectDate: false,
  },
  {
    label:        'Caption (Hebrew, angled photo)',
    path:         path.join(ROOT, 'src', 'recipe test', 'caption.jpg'),
    golden:       CAPTION_GOLDEN,
    expectShekel: true, expectEuro: false, expectDate: true,
  },
  {
    label:        'Recipe Test (Hebrew, clean)',
    path:         path.join(ROOT, 'src', 'recipe test', 'recipe_test.jpg'),
    golden:       RECIPE_GOLDEN,
    expectShekel: true, expectEuro: false, expectDate: true,
  },
  {
    label:        'Kabala Colbo (Hebrew supermarket)',
    path:         path.join(ROOT, 'src', 'recipe test', 'kabala colbo.jpeg'),
    golden:       KABALA_GOLDEN,
    expectShekel: false, expectEuro: false, expectDate: false,
  },
  {
    label:        'Caption2 (Euro/Spanish)',
    path:         path.join(ROOT, 'src', 'recipe test', 'caption2.jpg'),
    golden:       CAPTION2_GOLDEN,
    expectShekel: false, expectEuro: true, expectDate: false,
  },
];

// ─── Prompt (Optimized — winner from evaluate.ts) ─────────────────────────────

const OPTIMIZED_PROMPT = `You are a HIGH-PRECISION receipt digitizer.

EXTRACTION RULES:
1. Capture EVERY food/drink/product item line — no skipping, no merging
2. Copy names VERBATIM from the image — no translation, correction, or completion
3. Tabit POS layout: price appears LEFT of item name
   e.g. "98.00  2 קבב טלה" → price=98, qty=2, name="קבב טלה"
4. quantity defaults to 1 when not explicitly shown
5. Extract both subtotal AND total (may differ due to service charge / tax)
6. Set price_missing=true only when a price column is genuinely absent for that item
7. confidence: "high"=all prices captured, "medium"=some missing, "low"=many missing

SKIP: restaurant header, address, phone number, QR code, loyalty/points rows,
      VAT label rows, subtotal/total rows themselves

Return ONLY this JSON with no markdown wrapper:
{
  "isReceipt": boolean,
  "receipt_type": "restaurant" | "supermarket" | "other",
  "restaurantName": string | null,
  "currency": "ILS" | "EUR" | "USD" | string,
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

interface ExtractedItem {
  name:          string;
  quantity:      number;
  unit_price:    number | null;
  total_price:   number | null;
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

/** One model run against one image */
export interface RunResult {
  model:         string;      // model.label
  modelId:       string;      // model.id
  image:         string;      // img.label
  ttfbMs:        number;
  totalMs:       number;
  extractionPct: number;      // 0-100 Levenshtein or price-present
  confidencePct: number;      // 0-100 model self-reported
  compositePct:  number;      // extraction×0.6 + confidence×0.4
  shekelOk:      boolean | null;   // null = not applicable
  euroOk:        boolean | null;
  dateOk:        boolean | null;   // null = not expected
  jsonOk:        boolean;
  itemCount:     number;
  hasTotal:      boolean;
  status:        'ok' | 'quota' | 'not_found' | 'error';
  error?:        string;
}

// ─── Levenshtein scoring ──────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0),
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
  const dist = levenshtein(a.trim(), b.trim());
  const maxL = Math.max(a.trim().length, b.trim().length);
  return maxL === 0 ? 100 : Math.round((1 - dist / maxL) * 100);
}

function scoreAgainstGolden(extracted: ExtractedItem[], golden: GoldenItem[]): number {
  if (golden.length === 0) return 0;
  const scores = golden.map(g => {
    const best = extracted.reduce((b, item) => {
      const s = similarity(g.name, item.name);
      return s > b ? s : b;
    }, 0);
    return best;
  });
  return Math.round(scores.reduce((a, s) => a + s, 0) / scores.length);
}

// ─── API call with TTFB + total timing ───────────────────────────────────────

interface TimedResponse {
  ok:      boolean;
  status:  number;
  rawText: string;
  ttfbMs:  number;
  totalMs: number;
}

async function timedPost(url: string, body: object): Promise<TimedResponse> {
  const t0  = Date.now();
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const ttfbMs  = Date.now() - t0;    // ← TTFB: headers received
  const rawText = await res.text();
  const totalMs = Date.now() - t0;    // ← Total: body fully streamed

  return { ok: res.ok, status: res.status, rawText, ttfbMs, totalMs };
}

function extractGeminiText(rawText: string): string {
  try {
    const json = JSON.parse(rawText);
    return (json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
  } catch {
    return '';
  }
}

/** Strip markdown code fences that some models add despite responseMimeType */
function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

// ─── Hebrew accuracy checks ───────────────────────────────────────────────────

/** Does the raw API response text contain an Israeli date (DD/MM/YYYY)? */
function detectIsraeliDate(rawText: string): boolean {
  return /\b\d{2}\/\d{2}\/\d{4}\b/.test(rawText);
}

// ─── Single model × image run ─────────────────────────────────────────────────

async function runOne(
  model: ModelConfig,
  img:   SampleImage,
): Promise<RunResult> {
  const base: Omit<RunResult, 'ttfbMs' | 'totalMs' | 'extractionPct' | 'confidencePct'
    | 'compositePct' | 'shekelOk' | 'euroOk' | 'dateOk' | 'jsonOk' | 'itemCount'
    | 'hasTotal' | 'status'> = {
    model:   model.label,
    modelId: model.id,
    image:   img.label,
  };

  const errResult = (
    status: RunResult['status'],
    msg: string,
    ttfbMs = 0,
    totalMs = 0,
  ): RunResult => ({
    ...base,
    ttfbMs, totalMs,
    extractionPct: 0, confidencePct: 0, compositePct: 0,
    shekelOk: null, euroOk: null, dateOk: null,
    jsonOk: false, itemCount: 0, hasTotal: false,
    status, error: msg,
  });

  // Load image
  if (!fs.existsSync(img.path)) return errResult('error', `File not found: ${img.path}`);
  const ext      = path.extname(img.path).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
  const data     = fs.readFileSync(img.path).toString('base64');

  const geminiBody = {
    contents: [{ parts: [
      { inline_data: { mime_type: mimeType, data } },
      { text: OPTIMIZED_PROMPT },
    ]}],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens:  8192,
      temperature:      0,
      thinkingConfig:   { thinkingBudget: 0 },
    },
  };

  // ── First attempt ──
  let timed = await timedPost(geminiUrl(model.id), geminiBody);

  // ── Handle 429: one smart-wait retry ──
  if (timed.status === 429) {
    const retryWait = model.waitMs * 2;
    console.log(
      `${C.yellow}  ⏳ 429 rate limit — waiting ${retryWait / 1000}s then retrying once…${C.reset}`,
    );
    await sleep(retryWait);
    timed = await timedPost(geminiUrl(model.id), geminiBody);
  }

  // ── Classify failures ──
  if (!timed.ok) {
    const status: RunResult['status'] =
      timed.status === 404 ? 'not_found' :
      timed.status === 429 ? 'quota'     : 'error';
    return errResult(status, `HTTP ${timed.status}: ${timed.rawText.slice(0, 120)}`,
      timed.ttfbMs, timed.totalMs);
  }

  // ── Extract text from Gemini envelope ──
  const modelText = stripFences(extractGeminiText(timed.rawText));

  // ── JSON integrity check ──
  let receipt: ExtractedReceipt;
  let jsonOk = true;
  try {
    receipt = JSON.parse(modelText) as ExtractedReceipt;
  } catch {
    jsonOk  = false;
    receipt = { items: [] };
  }

  const items = receipt.items ?? [];

  // ── Extraction score ──
  const extractionPct = img.golden.length > 0
    ? scoreAgainstGolden(items, img.golden)
    : items.length > 0
      ? Math.round(items.filter(i => (i.total_price ?? i.unit_price) != null).length / items.length * 100)
      : 0;

  // ── Confidence score ──
  const confMap: Record<string, number> = { high: 100, medium: 70, low: 40 };
  const confidencePct = confMap[receipt.confidence ?? 'medium'] ?? 70;

  const compositePct = Math.round(extractionPct * 0.6 + confidencePct * 0.4);

  // ── Hebrew / currency accuracy ──
  const currency = (receipt.currency ?? '').toUpperCase();
  const shekelOk: boolean | null = img.expectShekel ? (currency === 'ILS') : null;
  const euroOk:   boolean | null = img.expectEuro   ? (currency === 'EUR') : null;
  const dateOk:   boolean | null = img.expectDate
    ? detectIsraeliDate(timed.rawText)
    : null;

  return {
    ...base,
    ttfbMs:        timed.ttfbMs,
    totalMs:       timed.totalMs,
    extractionPct,
    confidencePct,
    compositePct,
    shekelOk,
    euroOk,
    dateOk,
    jsonOk,
    itemCount:  items.length,
    hasTotal:   receipt.total != null,
    status:     'ok',
  };
}

// ─── Console colours ──────────────────────────────────────────────────────────

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

// ─── Per-model output table ───────────────────────────────────────────────────

function boolCell(v: boolean | null, trueLabel = '✓', falseLabel = '✗'): string {
  if (v === null)  return C.dim + '—' + C.reset;
  return v ? C.green + trueLabel + C.reset : C.red + falseLabel + C.reset;
}

function printModelTable(model: ModelConfig, results: RunResult[]) {
  const W = [30, 8, 8, 5, 5, 6, 9, 9] as const;
  const H = ['Image', 'Extr%', 'Comp%', '₪OK', '€OK', 'Date', 'TTFB', 'Total'];

  console.log(`\n${C.cyan}${C.bold}━━━ ${model.label}  (${model.id}) ━━━${C.reset}`);
  console.log('  ' + H.map((h, i) => h.padEnd(W[i])).join(' '));
  console.log('  ' + W.map(w => '─'.repeat(w)).join(' '));

  for (const r of results) {
    if (r.status !== 'ok') {
      const label = r.status === 'not_found' ? 'MODEL NOT FOUND' :
                    r.status === 'quota'      ? 'QUOTA EXCEEDED'  : 'ERROR';
      console.log(`  ${r.image.slice(0, 29).padEnd(30)} ${C.red}${label}${C.reset}`);
      if (r.error) console.log(`    ${C.dim}${r.error.slice(0, 100)}${C.reset}`);
      continue;
    }
    const cells = [
      r.image.slice(0, 29).padEnd(W[0]),
      `${r.extractionPct}%`.padEnd(W[1]),
      `${r.compositePct}%`.padEnd(W[2]),
      boolCell(r.shekelOk).padEnd(W[3] + 10), // +10 for ANSI bytes
      boolCell(r.euroOk).padEnd(W[4] + 10),
      boolCell(r.dateOk).padEnd(W[5] + 10),
      `${r.ttfbMs}ms`.padEnd(W[6]),
      `${r.totalMs}ms`.padEnd(W[7]),
    ];
    console.log('  ' + cells.join(' '));
  }

  // Row of averages (ok results only)
  const ok = results.filter(r => r.status === 'ok');
  if (ok.length) {
    const avg = (fn: (r: RunResult) => number) =>
      Math.round(ok.reduce((a, r) => a + fn(r), 0) / ok.length);
    const jsonOkPct = Math.round(ok.filter(r => r.jsonOk).length / ok.length * 100);

    console.log('  ' + '─'.repeat(W.reduce((a, w) => a + w + 1, 0)));
    console.log(
      `  ${'AVERAGE'.padEnd(W[0])} ` +
      `${C.bold}${avg(r => r.extractionPct)}%${C.reset}`.padEnd(W[1] + 8) + ' ' +
      `${C.bold}${avg(r => r.compositePct)}%${C.reset}`.padEnd(W[2] + 8) + '  ' +
      `${C.dim}JSON OK: ${jsonOkPct}%  TTFB avg: ${avg(r => r.ttfbMs)}ms  Total avg: ${avg(r => r.totalMs)}ms${C.reset}`,
    );
  }
}

// ─── Aggregate summary ────────────────────────────────────────────────────────

interface ModelSummary {
  label:      string;
  id:         string;
  avgExtr:    number;
  avgComp:    number;
  avgTtfb:    number;
  avgTotal:   number;
  jsonOkPct:  number;
  runCount:   number;   // how many images succeeded
  errors:     number;
}

function buildSummary(models: ModelConfig[], allResults: Map<string, RunResult[]>): ModelSummary[] {
  return models.map(m => {
    const results = allResults.get(m.id) ?? [];
    const ok      = results.filter(r => r.status === 'ok');
    const n       = ok.length || 1;
    const avg     = (fn: (r: RunResult) => number) =>
      Math.round(ok.reduce((a, r) => a + fn(r), 0) / n);
    return {
      label:     m.label,
      id:        m.id,
      avgExtr:   avg(r => r.extractionPct),
      avgComp:   avg(r => r.compositePct),
      avgTtfb:   avg(r => r.ttfbMs),
      avgTotal:  avg(r => r.totalMs),
      jsonOkPct: ok.length ? Math.round(ok.filter(r => r.jsonOk).length / ok.length * 100) : 0,
      runCount:  ok.length,
      errors:    results.length - ok.length,
    };
  });
}

function printSummary(summaries: ModelSummary[], imageCount: number): { pass1: ModelSummary; pass2: ModelSummary } {
  const W2 = [12, 12, 10, 10, 10, 10, 10] as const;
  const H2 = ['Model', 'Avg Comp%', 'Avg Extr%', 'Avg TTFB', 'Avg Total', 'JSON OK%', 'Runs'];
  const row2 = (cells: string[]) => '  ' + cells.map((c, i) => c.padEnd(W2[i])).join(' ');

  console.log(`\n${C.bold}${'═'.repeat(78)}${C.reset}`);
  console.log(`${C.bold} AGGREGATE SUMMARY  (avg across up to ${imageCount} images)${C.reset}`);
  console.log(`${C.bold}${'═'.repeat(78)}${C.reset}`);
  console.log(row2(H2));
  console.log('  ' + W2.map(w => '─'.repeat(w)).join(' '));

  const withRuns = summaries.filter(s => s.runCount > 0);

  // Pass 1 = fastest TTFB with acceptable accuracy (≥60 composite)
  const pass1Candidates = withRuns.filter(s => s.avgComp >= 60);
  const pass1 = pass1Candidates.length
    ? pass1Candidates.reduce((a, b) => a.avgTtfb <= b.avgTtfb ? a : b)
    : withRuns[0] ?? summaries[0];

  // Pass 2 = highest composite accuracy
  const pass2 = withRuns.length
    ? withRuns.reduce((a, b) => a.avgComp >= b.avgComp ? a : b)
    : summaries[summaries.length - 1];

  for (const s of summaries) {
    const isPass1 = s === pass1;
    const isPass2 = s === pass2 && pass2 !== pass1;
    const tag     = isPass1 && isPass2 ? ' ← Pass1+2'
                  : isPass1            ? ` ← ${C.blue}Pass1 (speed)${C.reset}`
                  : isPass2            ? ` ← ${C.magenta}Pass2 (accuracy)${C.reset}`
                  : '';
    const cells = [
      s.label,
      `${s.avgComp}%`,
      `${s.avgExtr}%`,
      `${s.avgTtfb}ms`,
      `${s.avgTotal}ms`,
      `${s.jsonOkPct}%`,
      `${s.runCount}/${SAMPLE_IMAGES.length}`,
    ];
    const line = row2(cells);
    const colour = isPass1 ? C.blue : isPass2 ? C.magenta : '';
    console.log(`${colour}${line}${C.reset}${tag}`);
  }

  console.log();
  console.log(`${C.blue}${C.bold}Pass 1 (Speed/OCR):   ${pass1.label} (${pass1.id})${C.reset}`);
  console.log(`  TTFB ${pass1.avgTtfb}ms · composite ${pass1.avgComp}% · JSON OK ${pass1.jsonOkPct}%`);
  console.log(`${C.magenta}${C.bold}Pass 2 (Accuracy/Fix): ${pass2.label} (${pass2.id})${C.reset}`);
  console.log(`  Total ${pass2.avgTotal}ms · composite ${pass2.avgComp}% · JSON OK ${pass2.jsonOkPct}%`);

  return { pass1, pass2 };
}

// ─── CLAUDE.md updater ────────────────────────────────────────────────────────

function updateClaude(summaries: ModelSummary[], pass1: ModelSummary, pass2: ModelSummary) {
  const claudePath = path.join(ROOT, 'CLAUDE.md');
  const existing   = fs.existsSync(claudePath) ? fs.readFileSync(claudePath, 'utf8') : '';
  const ts         = new Date().toISOString().slice(0, 10);

  const tableRows = summaries.map(s =>
    `| ${s.label.padEnd(10)} | ${`${s.avgExtr}%`.padEnd(10)} | ${`${s.avgComp}%`.padEnd(10)} ` +
    `| ${`${s.avgTtfb}ms`.padEnd(10)} | ${`${s.avgTotal}ms`.padEnd(12)} | ${`${s.jsonOkPct}%`.padEnd(8)} |`,
  ).join('\n');

  const section = `
## Model Benchmark Results

Last benchmarked: **${ts}**
Tool: \`tests/scripts/benchmark.ts\`
Strategy: Optimized single-pass (high-fidelity prompt, winner from \`evaluate.ts\`)
Images tested: 5 (WhatsApp receipt + caption.jpg + recipe_test + kabala colbo + caption2)

### Results

| Model      | Avg Extr%  | Avg Comp%  | Avg TTFB   | Avg Total    | JSON OK% |
|------------|------------|------------|------------|--------------|----------|
${tableRows}

### Pass 1 / Pass 2 Recommendations

**Pass 1 (Speed / OCR vision):** \`${pass1.id}\`
- Avg TTFB: ${pass1.avgTtfb}ms · Composite: ${pass1.avgComp}% · JSON integrity: ${pass1.jsonOkPct}%
- Best choice for image→text/JSON first pass: low latency, acceptable accuracy

**Pass 2 (Accuracy / JSON fix):** \`${pass2.id}\`
- Avg Total: ${pass2.avgTotal}ms · Composite: ${pass2.avgComp}% · JSON integrity: ${pass2.jsonOkPct}%
- Best choice for structuring/self-healing: highest accuracy, latency less critical

To apply in production, update \`.env.local\`:
\`\`\`
VITE_PASS1_PROVIDER=${pass1.id}
VITE_PASS2_PROVIDER=${pass2.id}
\`\`\`

---

### How to Re-run

\`\`\`bash
npm run benchmark       # model benchmark (this script)
npm run evaluate:seq    # strategy comparison (evaluate.ts)
\`\`\`
`;

  // Replace existing benchmark section if present, else append
  const marker = '\n## Model Benchmark Results\n';
  const updated = existing.includes(marker)
    ? existing.slice(0, existing.indexOf(marker)) + section
    : existing.trimEnd() + '\n' + section;

  fs.writeFileSync(claudePath, updated, 'utf8');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!GEMINI_KEY) {
    console.error(`${C.red}VITE_GEMINI_API_KEY is not set. Add it to .env.local and re-run.${C.reset}`);
    process.exit(1);
  }

  const available = SAMPLE_IMAGES.filter(img => fs.existsSync(img.path));
  console.log(`\n${C.bold}${C.magenta}SplitSnap Model Benchmarker${C.reset}`);
  console.log(`${C.dim}${MODELS.length} models × ${available.length} images — sequential${C.reset}`);
  console.log(`${C.dim}Smart wait: flash=${MODELS[0].waitMs / 1000}s  pro=${MODELS[2].waitMs / 1000}s${C.reset}`);
  console.log(`${C.dim}Metrics: TTFB · Total latency · Extraction% · ₪OK · DateOK · JSON integrity${C.reset}`);

  if (available.length === 0) {
    console.error(`${C.red}No sample images found in src/recipe test/${C.reset}`);
    process.exit(1);
  }

  const allResults = new Map<string, RunResult[]>();

  for (let mi = 0; mi < MODELS.length; mi++) {
    const model = MODELS[mi];
    const results: RunResult[] = [];
    allResults.set(model.id, results);

    console.log(`\n${C.bold}[${mi + 1}/${MODELS.length}] Testing ${model.label} (${model.id})${C.reset}`);
    console.log(`${C.dim}  Tier: ${model.tier}  Smart wait: ${model.waitMs / 1000}s/call${C.reset}`);

    for (let ii = 0; ii < available.length; ii++) {
      const img = available[ii];
      process.stdout.write(`${C.dim}  [${ii + 1}/${available.length}] ${img.label}…${C.reset} `);

      const result = await runOne(model, img);
      results.push(result);

      if (result.status === 'ok') {
        process.stdout.write(
          `${C.green}✓${C.reset} ${result.extractionPct}% extr  TTFB ${result.ttfbMs}ms  Total ${result.totalMs}ms\n`,
        );
      } else {
        process.stdout.write(`${C.red}✗ ${result.status.toUpperCase()}${C.reset}\n`);
      }

      // Smart wait after every call (free-tier RPM guard)
      if (ii < available.length - 1) {
        process.stdout.write(`${C.dim}     sleeping ${model.waitMs / 1000}s…${C.reset}\n`);
        await sleep(model.waitMs);
      }
    }

    printModelTable(model, results);

    // Extra pause between model tiers (pro→next avoids carry-over rate limits)
    if (mi < MODELS.length - 1) {
      const gap = Math.max(model.waitMs, 5_000);
      console.log(`\n${C.dim}  Pausing ${gap / 1000}s before next model…${C.reset}`);
      await sleep(gap);
    }
  }

  // Aggregate summary + recommendations
  const summaries = buildSummary(MODELS, allResults);
  const { pass1, pass2 } = printSummary(summaries, available.length);

  updateClaude(summaries, pass1, pass2);
  console.log(`\n${C.green}✔ CLAUDE.md updated with Pass 1 / Pass 2 recommendations.${C.reset}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
