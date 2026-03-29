export async function prepareImage(
  file: File
): Promise<{ blob: Blob; mimeType: string }> {
  const canvas = document.createElement('canvas');
  const img = await createImageBitmap(file);

  // 1800px gives enough detail for small receipt text and Hebrew characters
  const MAX = 1800;
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);

  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob>((res) =>
    canvas.toBlob(res as BlobCallback, 'image/jpeg', 0.90)
  );

  return { blob: blob!, mimeType: 'image/jpeg' };
}
