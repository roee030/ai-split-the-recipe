import { useState, useCallback, useEffect } from 'react';
import type { SplitSession, Screen, Person, ItemClaim, TipConfig } from '../types/split.types';
import type { ReceiptItem } from '../types/receipt.types';
import { generateId } from '../utils/idGenerator';
import { getPersonColor, getPersonInitials } from '../utils/colorPalette';

export function getLocalScansUsed(): number {
  return parseInt(localStorage.getItem('splitsnap_local_scans') ?? '0', 10);
}

export function incrementLocalScansUsed(): void {
  const next = getLocalScansUsed() + 1;
  localStorage.setItem('splitsnap_local_scans', String(next));
}

const DEFAULT_SESSION: SplitSession = {
  receiptItems: [],
  people: [],
  claims: [],
  tip: { mode: 'percent', value: 15, splitMode: 'proportional' },
  tax: 0,
  serviceCharge: 0,
  subtotal: null,
  restaurantName: null,
  currency: 'ILS',
  scanConfidence: null,
  splitMode: null,
  lastTranscript: null,
  processingPhase: null,
  debugImageUrl: null,
  autoFixed: false,
};

// Screens that get their own browser history entry (back-navigable)
const HISTORY_SCREENS = new Set<Screen>(['home', 'review', 'people', 'claim', 'tip', 'summary', 'roundrobin']);

function hashToScreen(hash: string): Screen {
  const s = hash.replace('#', '') as Screen;
  return HISTORY_SCREENS.has(s) ? s : 'home';
}

export function useSplitSession() {
  const [session, setSession] = useState<SplitSession>(DEFAULT_SESSION);
  const [screen, setScreenState] = useState<Screen>(() => hashToScreen(window.location.hash));
  const [activePersonIndex, setActivePersonIndex] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);

  // Sync screen → URL hash
  const setScreen = useCallback((s: Screen) => {
    setScreenState(s);
    if (s === 'home') {
      window.history.replaceState({ screen: s }, '', '#');
    } else if (HISTORY_SCREENS.has(s)) {
      window.history.pushState({ screen: s }, '', `#${s}`);
    }
    // 'processing' — transient, no history entry
  }, []);

  // Browser back/forward button
  useEffect(() => {
    const onPopState = () => {
      setScreenState(hashToScreen(window.location.hash));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const setReceiptData = useCallback(
    (items: ReceiptItem[], meta: Partial<SplitSession>) => {
      setSession((s) => ({ ...s, ...meta, receiptItems: items, claims: [] }));
    },
    []
  );

  const updateItem = useCallback((id: string, updates: Partial<ReceiptItem>) => {
    setSession((s) => ({
      ...s,
      receiptItems: s.receiptItems.map((item) =>
        item.id === id ? { ...item, ...updates, isEdited: true } : item
      ),
    }));
  }, []);

  const deleteItem = useCallback((id: string) => {
    setSession((s) => ({
      ...s,
      receiptItems: s.receiptItems.filter((item) => item.id !== id),
      claims: s.claims.filter((c) => c.itemId !== id),
    }));
  }, []);

  const addItem = useCallback((item: ReceiptItem) => {
    setSession((s) => ({ ...s, receiptItems: [...s.receiptItems, item] }));
  }, []);

  const addPerson = useCallback((name: string) => {
    setSession((s) => {
      const index = s.people.length;
      const person: Person = {
        id: generateId(),
        name,
        color: getPersonColor(index),
        avatar: getPersonInitials(name || '?'),
      };
      return { ...s, people: [...s.people, person] };
    });
  }, []);

  const removePerson = useCallback((id: string) => {
    setSession((s) => ({
      ...s,
      people: s.people.filter((p) => p.id !== id),
      claims: s.claims
        .map((c) => ({
          ...c,
          personIds: c.personIds.filter((pid) => pid !== id),
        }))
        .filter((c) => c.personIds.length > 0),
    }));
  }, []);

  const updatePersonName = useCallback((id: string, name: string) => {
    setSession((s) => ({
      ...s,
      people: s.people.map((p) =>
        p.id === id ? { ...p, name, avatar: getPersonInitials(name || '?') } : p
      ),
    }));
  }, []);

  const claimItem = useCallback(
    (itemId: string, personId: string) => {
      setSession((s) => {
        const item = s.receiptItems.find((i) => i.id === itemId);
        const isMulti = (item?.quantity ?? 1) > 1;
        const existing = s.claims.find((c) => c.itemId === itemId);

        if (!existing) {
          const claim: ItemClaim = { itemId, personIds: [personId] };
          if (isMulti) claim.quantityPerPerson = { [personId]: 1 };
          return { ...s, claims: [...s.claims, claim] };
        }

        if (existing.personIds.includes(personId)) {
          // unclaim — remove person
          const newPersonIds = existing.personIds.filter((id) => id !== personId);
          if (newPersonIds.length === 0) {
            return { ...s, claims: s.claims.filter((c) => c.itemId !== itemId) };
          }
          const newQPP = existing.quantityPerPerson
            ? Object.fromEntries(
                Object.entries(existing.quantityPerPerson).filter(([k]) => k !== personId)
              )
            : undefined;
          return {
            ...s,
            claims: s.claims.map((c) =>
              c.itemId === itemId
                ? { ...c, personIds: newPersonIds, quantityPerPerson: newQPP }
                : c
            ),
          };
        }

        // add person to existing claim
        const newQPP = isMulti
          ? { ...(existing.quantityPerPerson ?? {}), [personId]: 1 }
          : existing.quantityPerPerson;
        return {
          ...s,
          claims: s.claims.map((c) =>
            c.itemId === itemId
              ? { ...c, personIds: [...c.personIds, personId], quantityPerPerson: newQPP }
              : c
          ),
        };
      });
    },
    []
  );

  const setClaimQuantity = useCallback((itemId: string, personId: string, qty: number) => {
    setSession((s) => {
      const existing = s.claims.find((c) => c.itemId === itemId);
      if (!existing) {
        if (qty <= 0) return s;
        return {
          ...s,
          claims: [...s.claims, {
            itemId,
            personIds: [personId],
            quantityPerPerson: { [personId]: qty },
          }],
        };
      }
      if (qty <= 0) {
        const newPersonIds = existing.personIds.filter((id) => id !== personId);
        if (newPersonIds.length === 0) {
          return { ...s, claims: s.claims.filter((c) => c.itemId !== itemId) };
        }
        const newQPP = { ...(existing.quantityPerPerson ?? {}) };
        delete newQPP[personId];
        return {
          ...s,
          claims: s.claims.map((c) =>
            c.itemId === itemId
              ? { ...c, personIds: newPersonIds, quantityPerPerson: newQPP }
              : c
          ),
        };
      }
      const newQPP = { ...(existing.quantityPerPerson ?? {}), [personId]: qty };
      const newPersonIds = existing.personIds.includes(personId)
        ? existing.personIds
        : [...existing.personIds, personId];
      return {
        ...s,
        claims: s.claims.map((c) =>
          c.itemId === itemId
            ? { ...c, personIds: newPersonIds, quantityPerPerson: newQPP }
            : c
        ),
      };
    });
  }, []);

  const setSharedClaim = useCallback((itemId: string, personIds: string[], sharedUnits = 1) => {
    setSession((s) => {
      const filtered = s.claims.filter((c) => c.itemId !== itemId);
      if (personIds.length === 0) return { ...s, claims: filtered };

      // Distribute shared units equally as fractions per person
      const qtyEach = sharedUnits / personIds.length;
      const quantityPerPerson: Record<string, number> = {};
      for (const pid of personIds) {
        quantityPerPerson[pid] = qtyEach;
      }

      return {
        ...s,
        claims: [...filtered, { itemId, personIds, quantityPerPerson }],
      };
    });
  }, []);

  const splitRemainingEvenly = useCallback(() => {
    setSession((s) => {
      const allPersonIds = s.people.map((p) => p.id);
      const unclaimedItems = s.receiptItems.filter(
        (item) => !s.claims.find((c) => c.itemId === item.id)
      );
      const newClaims: ItemClaim[] = unclaimedItems.map((item) => ({
        itemId: item.id,
        personIds: allPersonIds,
      }));
      return { ...s, claims: [...s.claims, ...newClaims] };
    });
  }, []);

  const setSplitMode = useCallback((splitMode: SplitSession['splitMode']) => {
    setSession((s) => ({ ...s, splitMode }));
  }, []);

  const setTip = useCallback((tip: TipConfig) => {
    setSession((s) => ({ ...s, tip }));
  }, []);

  const setTax = useCallback((tax: number) => {
    setSession((s) => ({ ...s, tax }));
  }, []);

  const setServiceCharge = useCallback((serviceCharge: number) => {
    setSession((s) => ({ ...s, serviceCharge }));
  }, []);

  const setTranscript = useCallback((transcript: string) => {
    setSession((s) => ({ ...s, lastTranscript: transcript }));
  }, []);

  const setProcessingPhase = useCallback((phase: SplitSession['processingPhase']) => {
    setSession((s) => ({ ...s, processingPhase: phase }));
  }, []);

  const setDebugImageUrl = useCallback((url: string | null) => {
    setSession((s) => ({ ...s, debugImageUrl: url }));
  }, []);

  const setReceiptItems = useCallback((items: ReceiptItem[]) => {
    setSession((s) => ({ ...s, receiptItems: items }));
  }, []);

  const reset = useCallback(() => {
    setSession(DEFAULT_SESSION);
    setScreenState('home');
    setActivePersonIndex(0);
    setScanError(null);
    window.history.replaceState({ screen: 'home' }, '', '#');
  }, []);

  const unclaimedCount = session.receiptItems.filter(
    (item) => !session.claims.find((c) => c.itemId === item.id)
  ).length;

  return {
    session,
    screen,
    setScreen,
    activePersonIndex,
    setActivePersonIndex,
    scanError,
    setScanError,
    setReceiptData,
    updateItem,
    deleteItem,
    addItem,
    addPerson,
    removePerson,
    updatePersonName,
    claimItem,
    setClaimQuantity,
    setSharedClaim,
    splitRemainingEvenly,
    setSplitMode,
    setTip,
    setTax,
    setServiceCharge,
    setTranscript,
    setProcessingPhase,
    setDebugImageUrl,
    setReceiptItems,
    reset,
    unclaimedCount,
  };
}

export type SplitSessionHook = ReturnType<typeof useSplitSession>;
