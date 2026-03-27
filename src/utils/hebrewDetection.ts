export function containsHebrew(text: string): boolean {
  return /[\u0590-\u05FF]/.test(text);
}
