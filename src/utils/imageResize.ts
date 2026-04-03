/**
 * Prepares a receipt image for Gemini OCR.
 *
 * Pipeline:
 *   1. Clean resize to 1200px (no upscaling — only downscale if needed)
 *   2. Grayscale + contrast/brightness filter
 *      — grayscale(100%): removes colour noise; Hebrew thermal-print receipts
 *        are black-on-white, so colour is irrelevant and only adds confusion
 *      — contrast(1.5): maximises separation between dark ink and white paper,
 *        which is the single biggest factor in Hebrew glyph recognition
 *      — brightness(1.1): lifts faint ink without blowing out white areas
 *   3. JPEG at 0.90 quality
 *
 * Caller signature unchanged: prepareImage(file) → { blob, mimeType }
 */
export async function prepareImage(
  file: File
): Promise<{ blob: Blob; mimeType: string }> {
  const img = await createImageBitmap(file);

  // Step 1: resize — cap longest side at 1200px; never upscale
  const MAX = 1200;
  const longest = Math.max(img.width, img.height);
  const scale = longest > MAX ? MAX / longest : 1;

  const w = Math.round(img.width  * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Step 2: grayscale + high-contrast draw
  // This is a single GPU-accelerated CSS filter pass — no pixel loop needed.
  ctx.filter = 'grayscale(100%) contrast(1.5) brightness(1.1)';
  ctx.drawImage(img, 0, 0, w, h);
  ctx.filter = 'none';

  // Step 3: JPEG 0.90
  const blob = await new Promise<Blob>((res) =>
    canvas.toBlob(res as BlobCallback, 'image/jpeg', 0.90)
  );

  return { blob: blob!, mimeType: 'image/jpeg' };
}
