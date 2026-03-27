import { createContext, useContext, type ReactNode } from 'react';
import { useSplitSession, type SplitSessionHook } from '../hooks/useSplitSession';

const SplitSessionContext = createContext<SplitSessionHook | null>(null);

export function SplitSessionProvider({ children }: { children: ReactNode }) {
  const session = useSplitSession();
  return (
    <SplitSessionContext.Provider value={session}>
      {children}
    </SplitSessionContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSession(): SplitSessionHook {
  const ctx = useContext(SplitSessionContext);
  if (!ctx) throw new Error('useSession must be used within SplitSessionProvider');
  return ctx;
}
