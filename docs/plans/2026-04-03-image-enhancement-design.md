# Image Pre-processing Enhancement Design

**Goal:** Improve Gemini OCR accuracy by enhancing receipt images before sending to the API.

**Chosen approach:** Option A — Canvas-based enhancement only. No new dependencies, no OpenCV, no perspective correction (Gemini 2.5 Flash handles skew better than naive JS homography).

---

## Pipeline (inside `prepareImage()`)

```
File → createImageBitmap
     → Step 1: Smart resize (upscale if small, cap at 1800px)
     → Step 2: Contrast + brightness filter
     → Step 3: Unsharp mask (3×3 sharpening convolution)
     → canvas.toBlob → JPEG 92%
```

---

## Step Details

### Step 1 — Smart Resize
- If longest side < 1200px → upscale to 1800px (receipt was far from camera)
- If longest side ≥ 1200px → downscale to 1800px (as before)
- Output is always ≤ 1800px = ≤ 6 Gemini tiles (~258 tokens), preserving current token cost

### Step 2 — Contrast + Brightness
```typescript
ctx.filter = 'contrast(1.35) brightness(1.08)';
ctx.drawImage(img, 0, 0, w, h);
ctx.filter = 'none';
```
- Fixes bad lighting and shadows (most common failure mode)
- Values tuned conservatively — aggressive contrast causes halation on crumpled receipts

### Step 3 — Unsharp Mask
3×3 convolution kernel applied via `getImageData` / `putImageData`:
```
 0  -1   0
-1   5  -1
 0  -1   0
```
Makes character edges crisp for Gemini's tokenizer. ~20ms on 1800px image on mobile.

### Output
JPEG at 92% quality (up from 90%) to recover sharpening detail that JPEG compression would otherwise smear.

---

## Files Changed
- `src/utils/imageResize.ts` — only file touched. Caller signature unchanged.

## Token Cost
Unchanged — still ≤ 1800px = ≤ 6 tiles.
