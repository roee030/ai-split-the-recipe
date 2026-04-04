/**
 * Prepares a receipt image for OCR.
 * Resizes to max 1600px (longest side), outputs lossless PNG.
 * Image filtering (grayscale / contrast) is handled in geminiVision.ts
 * right before the API call, keeping this function a pure resize.
 */
export async function prepareImage(
  file: File
): Promise<{ blob: Blob; mimeType: string }> {
  const img = await createImageBitmap(file);

  const MAX = 2048;
  const longest = Math.max(img.width, img.height);
  const scale = longest > MAX ? MAX / longest : 1;

  const w = Math.round(img.width  * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise<Blob>((res) =>
    canvas.toBlob(res as BlobCallback, 'image/png')
  );

  return { blob: blob!, mimeType: 'image/png' };
}
