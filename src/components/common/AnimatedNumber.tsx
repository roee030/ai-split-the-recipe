import { useEffect, useRef, useState } from 'react';

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  format?: (n: number) => string;
}

export function AnimatedNumber({ value, duration = 1200, format = (n) => n.toFixed(2) }: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(0);

  // `display` is intentionally omitted from deps: captured via ref at animation start to avoid restart loops.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    fromRef.current = display;
    startRef.current = null;
    let raf: number;

    function tick(ts: number) {
      if (!startRef.current) startRef.current = ts;
      const progress = Math.min((ts - startRef.current) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(fromRef.current + (value - fromRef.current) * eased);
      if (progress < 1) raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  /* eslint-enable react-hooks/exhaustive-deps */

  return <>{format(display)}</>;
}
