export const PERSON_COLORS = [
  '#FF6B35', '#3B82F6', '#10B981', '#8B5CF6',
  '#F59E0B', '#EC4899', '#14B8A6', '#EF4444',
];

export function getPersonColor(index: number): string {
  return PERSON_COLORS[index % PERSON_COLORS.length];
}

export function getPersonInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
