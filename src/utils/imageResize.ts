/**
 * Prepares a receipt image for OCR.
 * PNG output, max 1600px longest side, no filters.
 */
export async function prepareImage(
  file: File
): Promise<{ blob: Blob; mimeType: string }> {
  const img = await createImageBitmap(file);

  const MAX = 1600;
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

/**
 * Row-Slicer: cuts a receipt image into individual horizontal strips,
 * one strip per item line.
 *
 * Algorithm:
 *  1. Scan every horizontal scanline — compute average "darkness"
 *     (how much ink is on that row).
 *  2. Rows with darkness < LIGHT_THRESHOLD are whitespace (gaps).
 *  3. Consecutive dark rows form a "text band".
 *  4. Each text band becomes one PNG blob (padded by PADDING px).
 *
 * Returns an array of PNG Blobs, top-to-bottom order.
 * Returns the original blob unchanged if fewer than 2 bands are found
 * (safety fallback so the caller always gets something usable).
 */
export async function sliceIntoRows(
  blob: Blob,
  options: { darkThreshold?: number; minBandHeight?: number; padding?: number } = {}
): Promise<Blob[]> {
  const {
    darkThreshold  = 12,   // average ink darkness per row (0–255); rows below this are "white"
    minBandHeight  = 8,    // ignore bands shorter than this many pixels (noise)
    padding        = 4,    // extra pixels added above/below each band
  } = options;

  const img = await createImageBitmap(blob);
  const { width, height } = img;

  // Draw the full image onto a canvas so we can read pixel data
  const canvas = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);

  // ── Step 1: Compute per-row darkness ────────────────────────────────────────
  // darkness[y] = average of (255 - brightness) across all pixels in row y
  const darkness: number[] = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4; // RGBA
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      sum += 255 - brightness;
    }
    darkness[y] = sum / width;
  }

  // ── Step 2: Find text bands (consecutive dark rows) ──────────────────────────
  const bands: { start: number; end: number }[] = [];
  let inBand = false;
  let bandStart = 0;

  for (let y = 0; y < height; y++) {
    if (!inBand && darkness[y] > darkThreshold) {
      inBand    = true;
      bandStart = y;
    } else if (inBand && darkness[y] <= darkThreshold) {
      inBand = false;
      if (y - bandStart >= minBandHeight) {
        bands.push({ start: bandStart, end: y });
      }
    }
  }
  // Close a band that runs to the bottom edge
  if (inBand && height - bandStart >= minBandHeight) {
    bands.push({ start: bandStart, end: height });
  }

  console.log(`[DEBUG] Row-Slicer: found ${bands.length} bands in ${width}×${height}px image`);

  // Safety fallback: if we couldn't split, return the original
  if (bands.length < 2) {
    return [blob];
  }

  // ── Step 3: Export each band as a PNG blob ──────────────────────────────────
  const slices: Blob[] = [];
  for (const band of bands) {
    const y = Math.max(0, band.start - padding);
    const h = Math.min(height, band.end + padding) - y;

    const sc = document.createElement('canvas');
    sc.width  = width;
    sc.height = h;
    const sc_ctx = sc.getContext('2d')!;
    // Copy the strip from the original canvas
    sc_ctx.drawImage(canvas, 0, y, width, h, 0, 0, width, h);

    const sliceBlob = await new Promise<Blob>((res) =>
      sc.toBlob(res as BlobCallback, 'image/png')
    );
    slices.push(sliceBlob!);
  }

  return slices;
}
