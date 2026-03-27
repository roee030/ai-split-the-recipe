# Quantity Claiming & "Just Me" Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix "Just me" to go through ClaimScreen, add per-person quantity steppers for multi-unit items, and support shared partial quantities (e.g. Beer ×3 where B&C only share ONE of the three).

**Architecture:** Three layered changes. (1) Routing fix in PeopleScreen + ClaimScreen solo-mode behavior. (2) Quantity stepper: ItemCard gains a stepper UI, useSplitSession gains `setClaimQuantity`, splitCalculator already handles `quantityPerPerson`. (3) SharedModal gains a "how many units?" stepper, `setSharedClaim` stores fractional `quantityPerPerson` per sharer. The existing `ItemClaim.quantityPerPerson` field carries all the data — no type changes needed.

**Tech Stack:** React + TypeScript, Framer Motion, Tailwind CSS, Lucide React

---

## Task 1: Fix "Just me" — route through ClaimScreen

**Problem:** PeopleScreen "Just me" button goes directly to `'tip'`, skipping ClaimScreen. User cannot select only their dishes.

**Files:**
- Modify: `src/screens/PeopleScreen.tsx`
- Modify: `src/screens/ClaimScreen.tsx`
- Modify: `src/hooks/useSplitSession.ts`

### Step 1: Update PeopleScreen "Just me" handler

In `PeopleScreen.tsx`, find the "Just me" button (line ~54):
```tsx
onClick={() => setScreen('tip')}
```

Replace with a handler that adds "Me" and routes to claim:
```tsx
onClick={() => {
  if (people.length === 0) addPerson('Me');
  setScreen('claim');
}}
```

### Step 2: Update ClaimScreen for solo mode

In `ClaimScreen.tsx`, the Continue button is currently:
```tsx
disabled={unclaimedCount > 0}
```

For solo mode (`people.length === 1`), unclaimed items are simply "not mine" — they shouldn't block. Change the button:
```tsx
<motion.button
  onClick={() => setScreen('tip')}
  disabled={people.length > 1 && unclaimedCount > 0}
  className="w-full flex items-center justify-center gap-2 py-4 bg-primary text-white font-semibold rounded-2xl disabled:opacity-40"
  whileTap={{ scale: 0.97 }}
>
  {people.length === 1
    ? `See my total →`
    : unclaimedCount === 0
      ? 'All claimed — Continue'
      : `${unclaimedCount} items unclaimed`}
  <ChevronRight className="w-5 h-5" />
</motion.button>
```

Also update the unclaimed counter label for solo mode. Find the counter text:
```tsx
<span className="text-sm font-medium">{unclaimedCount} item{unclaimedCount !== 1 ? 's' : ''} unclaimed</span>
```

Replace with:
```tsx
<span className="text-sm font-medium">
  {people.length === 1
    ? `${unclaimedCount} item${unclaimedCount !== 1 ? 's' : ''} not claimed by you`
    : `${unclaimedCount} item${unclaimedCount !== 1 ? 's' : ''} unclaimed`}
</span>
```

### Step 3: Fix splitCalculator for solo-with-claims

Currently the solo path in `splitCalculator.ts` only fires when `totalPeopleCount === 1 && claims.length === 0`. But now solo users WILL have claims (only their items). The multi-person code path already handles this correctly via `quantityPerPerson`. So just remove the solo shortcut entirely — the regular claims path works for 1 person too.

In `src/services/splitCalculator.ts`, remove lines 15-23:
```typescript
// DELETE this entire block:
if (totalPeopleCount === 1 && claims.length === 0) {
  const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
  const tipAmount = tip.mode === 'percent'
    ? subtotal * tip.value / 100
    : tip.value;
  const taxAmount = tax;
  const serviceAmount = serviceCharge;
  return { personId, subtotal, tipAmount, taxAmount, serviceAmount, total: subtotal + tipAmount + taxAmount + serviceAmount, items: [] };
}
```

### Step 4: Type-check and commit
```bash
cd ai-split-the-recipe && npx tsc --noEmit
git add src/screens/PeopleScreen.tsx src/screens/ClaimScreen.tsx src/services/splitCalculator.ts
git commit -m "fix: just-me flow goes through ClaimScreen to select own dishes"
```

---

## Task 2: Per-person quantity stepper on ItemCard

**Problem:** Items with quantity > 1 (e.g. Beer ×3) let you claim ALL or NONE. User needs to claim 1, 2, or 3 units separately.

**Files:**
- Modify: `src/components/claim/ItemCard.tsx`
- Modify: `src/hooks/useSplitSession.ts`

### Step 1: Add `setClaimQuantity` to useSplitSession

In `src/hooks/useSplitSession.ts`, after the `claimItem` function, add:

```typescript
const setClaimQuantity = useCallback((itemId: string, personId: string, qty: number) => {
  setSession((s) => {
    const existing = s.claims.find((c) => c.itemId === itemId);
    if (!existing) {
      // Create a new claim with this quantity
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
      // Remove person from claim
      const newPersonIds = existing.personIds.filter((id) => id !== personId);
      if (newPersonIds.length === 0) {
        return { ...s, claims: s.claims.filter((c) => c.itemId !== itemId) };
      }
      const newQPP = { ...existing.quantityPerPerson };
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
    // Update quantity for person
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
```

Add `setClaimQuantity` to the return object of `useSplitSession`.

Also update `SplitSessionContext.tsx` to expose it if it's spread from the hook (check — if it uses `...hook` spread it's automatic; if explicit, add it).

### Step 2: Update claimItem to set quantity=1 by default for multi-unit items

In `useSplitSession.ts`, find `claimItem`. When ADDING a person to a claim on a multi-unit item, set `quantityPerPerson[personId] = 1`:

```typescript
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
        // unclaim
        const newPersonIds = existing.personIds.filter((id) => id !== personId);
        if (newPersonIds.length === 0) {
          return { ...s, claims: s.claims.filter((c) => c.itemId !== itemId) };
        }
        const newQPP = existing.quantityPerPerson
          ? Object.fromEntries(Object.entries(existing.quantityPerPerson).filter(([k]) => k !== personId))
          : undefined;
        return {
          ...s,
          claims: s.claims.map((c) =>
            c.itemId === itemId ? { ...c, personIds: newPersonIds, quantityPerPerson: newQPP } : c
          ),
        };
      }

      // add person
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
```

### Step 3: Add stepper UI to ItemCard

In `src/components/claim/ItemCard.tsx`, add two new props:

```typescript
interface ItemCardProps {
  // ... existing props ...
  myQuantity?: number;       // how many units active person has claimed
  onSetQuantity?: (qty: number) => void;  // called when stepper changes
}
```

Inside the component, after the existing `subLabel` logic, add stepper rendering. Replace the quantity label section:

```tsx
{/* Quantity display / stepper */}
<div className="flex-1 min-w-0">
  <div className="flex items-baseline gap-1">
    {item.quantity > 1 && !claimedByActive && (
      <span className="text-xs text-muted">{item.quantity}×</span>
    )}
    <span className="text-sm font-medium text-primary truncate">{item.name}</span>
  </div>
  {subLabel !== null && (
    <div className="flex items-center gap-1 mt-0.5">
      <Users className="w-3 h-3 text-muted" />
      <span className="text-xs text-muted">{subLabel}</span>
    </div>
  )}
  {/* Quantity stepper — shown only when claimed by active person and item has qty > 1 */}
  {claimedByActive && item.quantity > 1 && onSetQuantity && (
    <div
      className="flex items-center gap-2 mt-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onSetQuantity(Math.max(0, (myQuantity ?? 1) - 1)); }}
        className="w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center"
      >
        −
      </button>
      <span className="text-xs font-semibold text-primary">{myQuantity ?? 1} of {item.quantity}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onSetQuantity(Math.min(item.quantity, (myQuantity ?? 1) + 1)); }}
        className="w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center"
      >
        +
      </button>
    </div>
  )}
</div>
```

### Step 4: Wire stepper in ClaimScreen

In `ClaimScreen.tsx`, destructure `setClaimQuantity` from `useSession()`. Pass props to ItemCard:

```tsx
<ItemCard
  key={item.id}
  item={item}
  claim={claim}
  activePerson={activePerson}
  people={people}
  currency={currency}
  myQuantity={claim?.quantityPerPerson?.[activePerson.id]}
  onTap={() => claimItem(item.id, activePerson.id)}
  onLongPress={() => setSharedItem(item)}
  onSetQuantity={(qty) => setClaimQuantity(item.id, activePerson.id, qty)}
  hideClaimants={privateMode}
/>
```

### Step 5: Update splitCalculator for quantityPerPerson on shared items

In `src/services/splitCalculator.ts`, the shared path currently ignores `quantityPerPerson`:
```typescript
amount = item.totalPrice / claim.personIds.length;
```

Replace with:
```typescript
if (claim.quantityPerPerson && claim.quantityPerPerson[personId] !== undefined) {
  // Use explicit quantity (handles partial-quantity shared claims)
  amount = item.unitPrice * claim.quantityPerPerson[personId];
} else {
  // Fallback: equal split
  amount = item.totalPrice / claim.personIds.length;
}
```

### Step 6: Type-check and commit
```bash
cd ai-split-the-recipe && npx tsc --noEmit
git add src/components/claim/ItemCard.tsx src/hooks/useSplitSession.ts src/services/splitCalculator.ts src/screens/ClaimScreen.tsx
git commit -m "feat: per-person quantity stepper on multi-unit items"
```

---

## Task 3: SharedModal — partial quantity sharing

**Problem:** "Beer ×3, I split one with Bob" — user needs to specify HOW MANY units the shared group is sharing, not just WHO shares.

**Files:**
- Modify: `src/components/claim/SharedModal.tsx`
- Modify: `src/hooks/useSplitSession.ts`
- Modify: `src/screens/ClaimScreen.tsx`

### Step 1: Update SharedModal to accept and show quantity stepper

In `SharedModal.tsx`, update the interface and add `sharedUnits` state:

```typescript
interface SharedModalProps {
  open: boolean;
  item: ReceiptItem | null;
  people: Person[];
  currentPersonIds: string[];
  onConfirm: (personIds: string[], sharedUnits: number) => void;  // ← add sharedUnits
  onClose: () => void;
}
```

Inside the component, add state:
```typescript
const [sharedUnits, setSharedUnits] = useState(1);

useEffect(() => {
  setSelected(new Set(currentPersonIds));
  setSharedUnits(1);
}, [open, currentPersonIds.join(',')]);
```

Before the people list, add a units stepper (only when `item.quantity > 1`):
```tsx
{item && item.quantity > 1 && (
  <div className="mb-4 p-4 bg-surface border border-border rounded-2xl">
    <p className="text-xs text-muted font-medium mb-3">How many units are being shared?</p>
    <div className="flex items-center justify-center gap-4">
      <button
        onClick={() => setSharedUnits((u) => Math.max(1, u - 1))}
        className="w-8 h-8 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center"
      >
        −
      </button>
      <span className="text-lg font-bold text-primary">{sharedUnits} of {item.quantity}</span>
      <button
        onClick={() => setSharedUnits((u) => Math.min(item.quantity, u + 1))}
        className="w-8 h-8 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center"
      >
        +
      </button>
    </div>
  </div>
)}
```

Update confirm button to pass `sharedUnits`:
```tsx
onClick={() => { onConfirm(Array.from(selected), sharedUnits); onClose(); }}
```

### Step 2: Update setSharedClaim in useSplitSession to handle sharedUnits

Add a new function `setSharedClaimWithQuantity` (or update `setSharedClaim` signature):

```typescript
const setSharedClaim = useCallback((itemId: string, personIds: string[], sharedUnits = 1) => {
  setSession((s) => {
    const filtered = s.claims.filter((c) => c.itemId !== itemId);
    if (personIds.length === 0) return { ...s, claims: filtered };

    // Distribute shared units equally as fractions
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
```

### Step 3: Update ClaimScreen to pass sharedUnits to setSharedClaim

In `ClaimScreen.tsx`, the onConfirm handler:
```tsx
onConfirm={(ids, sharedUnits) => sharedItem && setSharedClaim(sharedItem.id, ids, sharedUnits)}
```

### Step 4: Type-check and commit
```bash
cd ai-split-the-recipe && npx tsc --noEmit
git add src/components/claim/SharedModal.tsx src/hooks/useSplitSession.ts src/screens/ClaimScreen.tsx
git commit -m "feat: SharedModal supports partial quantity sharing (Beer x3 split 1 with Bob)"
```

---

## Task 4: Expose setClaimQuantity in context

**Context:** `SplitSessionContext.tsx` wraps the hook. If it spreads all return values automatically, no change needed. If it explicitly lists them, `setClaimQuantity` must be added.

### Step 1: Check context
```bash
grep -n "setSharedClaim\|setClaimQuantity\|SplitSessionHook" src/context/SplitSessionContext.tsx
```

If `SplitSessionContext` just returns `useSession()` directly (via `useSplitSession`), no change needed. If it manually lists functions, add `setClaimQuantity` to the list.

### Step 2: Final type-check
```bash
cd ai-split-the-recipe && npx tsc --noEmit
```

Expected: 0 errors.

### Step 3: Final commit
```bash
git add src/context/SplitSessionContext.tsx
git commit -m "chore: expose setClaimQuantity via context if needed"
```
