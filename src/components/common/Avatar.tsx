interface AvatarProps {
  initials: string;
  color: string;
  size?: 'sm' | 'md' | 'lg';
  selected?: boolean;
}

const SIZE = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-14 h-14 text-lg' };

export function Avatar({ initials, color, size = 'md', selected }: AvatarProps) {
  return (
    <div
      className={`${SIZE[size]} rounded-full flex items-center justify-center font-semibold text-white transition-all ${selected ? 'ring-2 ring-offset-2 ring-current scale-110' : ''}`}
      style={{ backgroundColor: color }}
    >
      {initials}
    </div>
  );
}
