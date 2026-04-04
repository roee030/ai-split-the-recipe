/**
 * SplitSnap OCR Regression Suite
 *
 * Usage:
 *   npx tsx tests/scripts/regression.ts
 *   npx tsx tests/scripts/regression.ts --threshold-bench      # test contrast 0.8/1.0/1.2
 *   npx tsx tests/scripts/regression.ts --apply-corrections    # write failures to autoLearnedCorrections.json
 *   npx tsx tests/scripts/regression.ts --apply-corrections --threshold-bench  # both
 *
 * Test structure:
 *   tests/receipts/my-receipt.jpg          ← receipt image (jpg or png)
 *   tests/receipts/my-receipt.expected.json ← golden file (see format below)
 *
 * Golden file format:
 * {
 *   "restaurantName": "מסעדת הגן",    // optional
 *   "items": [
 *     { "name": "קוקה קולה",  "quantity": 1, "total_price": 16   },
 *     { "name": "לחם פסח",    "quantity": 1, "total_price": 24   }
 *   ],
 *   "corrections": {             // optional — learning engine input
 *     "שטיחי דג": "סשימי דג",   //   OCR output → correct value
 *     "קולה קולה": "קוקה קולה"
 *   }
 * }
 */

import fs   from 'fs';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';
import dotenv from 'dotenv';

// Load .env.local (Vite convention) then fall back to .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const GEMINI_KEY         = process.env.VITE_GEMINI_API_KEY ?? '';
const GEMINI_URL         = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
const BENCH_MODE         = process.argv.includes('--threshold-bench');
const APPLY_CORRECTIONS  = process.argv.includes('--apply-corrections');
const RECEIPTS_DIR       = path.resolve(process.cwd(), 'tests/receipts');
const CORRECTIONS_FILE   = path.resolve(process.cwd(), 'src/data/autoLearnedCorrections.json');

// ─── Types ────────────────────────────────────────────────────────────────────

interface GoldenItem  { name: string; quantity?: number; total_price?: number }
interface GoldenFile  { restaurantName?: string; items: GoldenItem[]; corrections?: Record<string, string> }
interface ParsedItem  { name: string; quantity: number; unit_price: number | null; total_price: number | null }
interface ParsedReceipt { isReceipt: boolean; items: ParsedItem[]; restaurantName?: string; confidence?: string }

interface ItemResult {
  expected: string;
  got:      string;
  score:    number;   // 0–100
  match:    boolean;
}

interface RunResult {
  imageName:    string;
  contrast:     number;
  items:        ItemResult[];
  accuracy:     number;         // 0–100 across all items
  suggestions:  Record<string, string>; // learning engine output
  error?:       string;
}

// ─── Levenshtein distance ─────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

/** 0–100 similarity score between two strings */
function similarity(a: string, b: string): number {
  if (!a && !b) return 100;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return Math.round((1 - dist / maxLen) * 100);
}

// ─── Image → base64 with optional contrast ───────────────────────────────────

async function imageToBase64(imagePath: string, contrast = 1.0): Promise<{ data: string; mimeType: string }> {
  const ext      = path.extname(imagePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

  if (contrast === 1.0) {
    // Raw image — no processing (matches production pipeline)
    const data = fs.readFileSync(imagePath).toString('base64');
    return { data, mimeType };
  }

  // Apply contrast boost for threshold benchmarking
  const img    = await loadImage(imagePath);
  const canvas = createCanvas(img.width, img.height);
  const ctx    = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const c    = Math.max(0, Math.min(255, (gray - 128) * contrast + 128));
    d[i] = d[i + 1] = d[i + 2] = c;
  }
  ctx.putImageData(imageData, 0, 0);

  const data = canvas.toBuffer('image/png').toString('base64');
  return { data, mimeType: 'image/png' };
}

// ─── Gemini calls (mirrors llmAdapters.ts, Node-compatible) ──────────────────

const TRANSCRIPT_PROMPT = `You are a LOW-LEVEL OCR engine.
You ONLY copy visual characters exactly as they appear on the page.

HARD RULES:
1. DO NOT FIX TEXT — keep wrong characters wrong.
2. DO NOT COMPLETE WORDS — "לימונ" stays "לימונ", never "לימונדה".
3. CHARACTER ACCURACY OVER MEANING — wrong shape = ok, real food word = FAILURE.
4. NO NORMALIZATION.

OUTPUT: One receipt line per output line. Copy EVERY line top-to-bottom.
If not a receipt: NOT_A_RECEIPT
If unreadable:    BLURRY`;

const STRUCTURE_PROMPT = `You are a JSON formatter for Israeli restaurant receipts.

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

async function geminiTranscribe(imageBase64: string, mimeType: string): Promise<string> {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: mimeType, data: imageBase64 } },
        { text: TRANSCRIPT_PROMPT },
      ]}],
      generationConfig: { maxOutputTokens: 8192, temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!res.ok) throw new Error(`Gemini Pass1 HTTP ${res.status}`);
  const json = await res.json();
  return (json.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
}

async function geminiStructure(transcript: string): Promise<ParsedReceipt> {
  const prompt = STRUCTURE_PROMPT.replace('{{TRANSCRIPT}}', transcript);
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 8192, temperature: 0,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini Pass2 HTTP ${res.status}`);
  const json = await res.json();
  const text = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
  return JSON.parse(text) as ParsedReceipt;
}

// ─── Auto-corrections writer ──────────────────────────────────────────────────

/**
 * Merge new OCR→correct mappings into src/data/autoLearnedCorrections.json.
 * Existing entries are preserved; new entries are added; conflicts keep
 * the NEW value (the golden file is always the source of truth).
 */
function persistCorrections(newEntries: Record<string, string>): number {
  if (!Object.keys(newEntries).length) return 0;

  let existing: Record<string, string> = {};
  if (fs.existsSync(CORRECTIONS_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(CORRECTIONS_FILE, 'utf8')); }
    catch { /* start fresh if file is corrupt */ }
  }

  const before = Object.keys(existing).length;
  const merged = { ...existing, ...newEntries };
  fs.writeFileSync(CORRECTIONS_FILE, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return Object.keys(merged).length - before; // how many NEW entries added
}

// ─── Core runner ─────────────────────────────────────────────────────────────

async function runOne(imagePath: string, golden: GoldenFile, contrast: number): Promise<RunResult> {
  const imageName = path.basename(imagePath);

  try {
    const { data, mimeType } = await imageToBase64(imagePath, contrast);

    // Pass 1
    const transcript = await geminiTranscribe(data, mimeType);
    if (transcript.startsWith('NOT_A_RECEIPT') || transcript.startsWith('BLURRY')) {
      return { imageName, contrast, items: [], accuracy: 0, suggestions: {}, error: transcript };
    }

    // Brief inter-pass pause (same as production)
    await new Promise(r => setTimeout(r, 1500));

    // Pass 2
    const receipt = await geminiStructure(transcript);

    // Compare items
    const items: ItemResult[] = golden.items.map((expected, i) => {
      const got  = receipt.items[i]?.name ?? '';
      const score = similarity(expected.name, got);
      return { expected: expected.name, got, score, match: score >= 90 };
    });

    const accuracy = items.length
      ? Math.round(items.reduce((s, r) => s + r.score, 0) / items.length)
      : 0;

    // Learning engine — suggest corrections for failures
    const suggestions: Record<string, string> = {};
    if (golden.corrections) {
      items
        .filter(r => !r.match && golden.corrections![r.got])
        .forEach(r => { suggestions[r.got] = golden.corrections![r.got]; });
    }

    // Learning engine — write corrections to disk if flag is set
    if (APPLY_CORRECTIONS && Object.keys(suggestions).length) {
      const added = persistCorrections(suggestions);
      if (added > 0) {
        Object.entries(suggestions).forEach(([ocr, correct]) =>
          console.log(`  ${C.cyan}✎ auto-correction saved: "${ocr}" → "${correct}"${C.reset}`)
        );
      }
    }

    return { imageName, contrast, items, accuracy, suggestions };
  } catch (err) {
    return { imageName, contrast, items: [], accuracy: 0, suggestions: {}, error: String(err) };
  }
}

// ─── Output formatting ────────────────────────────────────────────────────────

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', bold: '\x1b[1m', cyan: '\x1b[36m', dim: '\x1b[2m' };

function statusIcon(score: number) {
  if (score >= 95) return `${C.green}✓${C.reset}`;
  if (score >= 80) return `${C.yellow}~${C.reset}`;
  return `${C.red}✗${C.reset}`;
}

function printRun(run: RunResult) {
  const contrastLabel = run.contrast !== 1.0 ? ` ${C.dim}[contrast×${run.contrast}]${C.reset}` : '';
  console.log(`\n${C.bold}${run.imageName}${C.reset}${contrastLabel}  accuracy: ${C.bold}${run.accuracy}%${C.reset}`);

  if (run.error) { console.log(`  ${C.red}ERROR: ${run.error}${C.reset}`); return; }

  // Item table
  const colW = 28;
  console.log(`  ${'Expected'.padEnd(colW)} ${'Got'.padEnd(colW)} Score  Status`);
  console.log(`  ${'─'.repeat(colW)} ${'─'.repeat(colW)} ─────  ──────`);
  run.items.forEach(r => {
    const exp = r.expected.padEnd(colW).slice(0, colW);
    const got = r.got.padEnd(colW).slice(0, colW);
    console.log(`  ${exp} ${got} ${String(r.score).padStart(4)}%  ${statusIcon(r.score)}`);
  });

  if (Object.keys(run.suggestions).length) {
    console.log(`\n  ${C.cyan}💡 Learning engine suggestions (add to correctionDictionary):${C.reset}`);
    Object.entries(run.suggestions).forEach(([ocr, correct]) =>
      console.log(`     "${ocr}"  →  "${correct}"`)
    );
  }
}

function printThresholdSummary(runs: RunResult[]) {
  const best = runs.reduce((a, b) => a.accuracy >= b.accuracy ? a : b);
  console.log(`\n${C.bold}Threshold Benchmark Summary${C.reset}`);
  console.log('  Contrast  Accuracy');
  console.log('  ────────  ────────');
  runs.forEach(r => {
    const mark = r.contrast === best.contrast ? ` ← ${C.green}best${C.reset}` : '';
    console.log(`  ×${String(r.contrast).padEnd(7)} ${r.accuracy}%${mark}`);
  });
  console.log(`\n  ${C.green}Golden threshold: ×${best.contrast}${C.reset}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!GEMINI_KEY) {
    console.error(`${C.red}VITE_GEMINI_API_KEY not set. Add it to .env.local${C.reset}`);
    process.exit(1);
  }

  // Find all images that have a corresponding .expected.json
  const files = fs.readdirSync(RECEIPTS_DIR);
  const images = files.filter(f => /\.(jpg|jpeg|png)$/i.test(f) &&
    fs.existsSync(path.join(RECEIPTS_DIR, f.replace(/\.(jpg|jpeg|png)$/i, '.expected.json')))
  );

  if (!images.length) {
    console.log(`${C.yellow}No test cases found in tests/receipts/${C.reset}`);
    console.log('Add receipt images with matching .expected.json golden files.');
    console.log('\nExample golden file (receipt1.expected.json):');
    console.log(JSON.stringify({
      items: [
        { name: 'קוקה קולה', quantity: 1, total_price: 16 },
        { name: 'בקבוק ערק', quantity: 1, total_price: 600 },
      ],
      corrections: { 'קולה קולה': 'קוקה קולה' }
    }, null, 2));
    return;
  }

  const flags = [BENCH_MODE && 'threshold-bench', APPLY_CORRECTIONS && 'apply-corrections'].filter(Boolean).join(' ');
  console.log(`\n${C.bold}SplitSnap OCR Regression Suite${C.reset}  ${images.length} test case(s)${flags ? `  [${flags}]` : ''}`);

  let totalAccuracy = 0;
  const contrastLevels = BENCH_MODE ? [0.8, 1.0, 1.2] : [1.0];

  for (const img of images) {
    const imagePath  = path.join(RECEIPTS_DIR, img);
    const goldenPath = imagePath.replace(/\.(jpg|jpeg|png)$/i, '.expected.json');
    const golden: GoldenFile = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));

    if (BENCH_MODE) {
      const runs: RunResult[] = [];
      for (const c of contrastLevels) {
        process.stdout.write(`  scanning ${img} contrast×${c}…`);
        const run = await runOne(imagePath, golden, c);
        runs.push(run);
        printRun(run);
        // Rate-limit pause between benchmark runs
        await new Promise(r => setTimeout(r, 2000));
      }
      printThresholdSummary(runs);
      const best = runs.reduce((a, b) => a.accuracy >= b.accuracy ? a : b);
      totalAccuracy += best.accuracy;
    } else {
      process.stdout.write(`  scanning ${img}…`);
      const run = await runOne(imagePath, golden, 1.0);
      printRun(run);
      totalAccuracy += run.accuracy;
    }
  }

  const avg = Math.round(totalAccuracy / images.length);
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`${C.bold}Overall accuracy: ${avg >= 90 ? C.green : avg >= 75 ? C.yellow : C.red}${avg}%${C.reset}  across ${images.length} receipt(s)`);
  console.log(`${'─'.repeat(70)}\n`);

  process.exit(avg >= 80 ? 0 : 1); // non-zero exit if accuracy drops below 80%
}

main().catch(e => { console.error(e); process.exit(1); });
