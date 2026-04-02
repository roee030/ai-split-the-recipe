import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'fs';

mkdirSync('public/icons', { recursive: true });

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Orange background
  ctx.fillStyle = '#FF6B35';
  const r = size * 0.22;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.arcTo(size, 0, size, r, r);
  ctx.lineTo(size, size - r);
  ctx.arcTo(size, size, size - r, size, r);
  ctx.lineTo(r, size);
  ctx.arcTo(0, size, 0, size - r, r);
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0, r, 0, r);
  ctx.closePath();
  ctx.fill();

  // Receipt body (white)
  ctx.fillStyle = '#FFFFFF';
  const pad = size * 0.25;
  const w = size - pad * 2;
  const h = w * 1.3;
  const rx = size * 0.05;
  const x = pad;
  const y = (size - h) / 2;

  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rx);
  ctx.fill();

  // Lines on receipt (orange)
  ctx.fillStyle = '#FF6B35';
  const lineH = size * 0.04;
  const lineW = w * 0.6;
  const lineX = x + w * 0.15;
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(lineX, y + h * 0.25 + i * lineH * 2.5, lineW, lineH);
  }
  // Price line (shorter)
  ctx.fillRect(lineX + lineW * 0.3, y + h * 0.7, lineW * 0.5, lineH);

  return canvas.toBuffer('image/png');
}

writeFileSync('public/icons/icon-192.png', drawIcon(192));
writeFileSync('public/icons/icon-512.png', drawIcon(512));
console.log('Icons generated: public/icons/icon-192.png and icon-512.png');
