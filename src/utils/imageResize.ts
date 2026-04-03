/**
 * Prepares a receipt image for Gemini OCR.
 *
 * EMERGENCY MODE: All image processing (contrast boost, unsharp mask) is
 * bypassed. We found the 3×3 sharpening kernel turns Hebrew letter strokes
 * into noise that Gemini hallucinates over. We now do a single clean resize
 * to 1200px and output JPEG at 0.90 quality — enough for Gemini to read
 * every character without artificial artefacts.
 *
 * Caller signature is unchanged: prepareImage(file) → { blob, mimeType }
 */
export async function prepareImage(
  file: File
): Promise<{ blob: Blob; mimeType: string }> {
  const img = await createImageBitmap(file);

  // Clean resize: cap the longest side at 1200px.
  // If the image is already smaller, keep it as-is (no upscaling artefacts).
  const MAX = 1200;
  const longest = Math.max(img.width, img.height);
  const scale = longest > MAX ? MAX / longest : 1;

  const w = Math.round(img.width  * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Plain draw — no CSS filters, no pixel manipulation.
  // Let the browser's built-in bicubic downscaler do the work cleanly.
  ctx.drawImage(img, 0, 0, w, h);

  // JPEG 0.90 — standard quality, no over-compression, no sharpening artefacts.
  const blob = await new Promise<Blob>((res) =>
    canvas.toBlob(res as BlobCallback, 'image/jpeg', 0.90)
  );

  return { blob: blob!, mimeType: 'image/jpeg' };
}
