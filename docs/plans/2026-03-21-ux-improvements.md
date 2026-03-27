# UX Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the shared-item unclaimed bug, redesign Who's Here with solo flow, add pass-the-phone private claiming, improve receipt parsing (keep original language, better dish grouping), and add inline edit mode for manual items.

**Architecture:** All changes are client-side. State lives in `useSplitSession`. Screens are in `src/screens/`. The solo flow is handled by routing logic: if `people.length === 1`, skip ClaimScreen and go Home→Review→People→Tip→Summary. Private mode is a local boolean state on ClaimScreen, not persisted.

**Tech Stack:** React + TypeScript, Framer Motion, Tailwind CSS, Lucide React

---

## Task 1: Fix shared-item "unclaimed" visual bug

**Problem:** Items claimed via SharedModal show no visible indicator when the active person isn't one of the sharers, making them look unclaimed.

**Files:**
- Modify: `src/components/claim/ItemCard.tsx`

**Step 1: Open ItemCard.tsx and find the shared badge section (lines 73-78)**

Current code only shows "Shared ÷ N" when `sharedBy` is truthy (personIds.length > 1). An item with 1 sharer shows nothing.

**Step 2: Replace the shared badge to always show when item is claimed by others**

```tsx
// Replace lines 73-78 in ItemCard.tsx
{isClaimed && !claimedByActive && (
  <div className="flex items-center gap-1 mt-0.5">
    <Users className="w-3 h-3 text-muted" />
    <span className="text-xs text-muted">
      {sharedBy ? `Shared ÷ ${sharedBy.length}` : 'Claimed'}
    </span>
  </div>
)}
{claimedByActive && sharedBy && (
  <div className="flex items-center gap-1 mt-0.5">
    <Users className="w-3 h-3 text-muted" />
    <span className="text-xs text-muted">Shared ÷ {sharedBy.length}</span>
  </div>
)}
```

**Step 3: Also ensure the Continue button is never blocked by visually-confusing unclaimed items**

In `useSplitSession.ts` line 165-167, the logic is already correct (any claim = claimed). No change needed there.

**Step 4: Commit**
```bash
git add src/components/claim/ItemCard.tsx
git commit -m "fix: always show claimed badge on items taken by others"
```

---

## Task 2: AI prompt — keep original language + better dish grouping

**Files:**
- Modify: `src/services/geminiVision.ts`
- Modify: `src/screens/ReviewScreen.tsx` (remove Hebrew nameOriginal display)
- Modify: `src/services/receiptParser.ts` (drop nameOriginal mapping)

**Step 1: Update the PROMPT constant in geminiVision.ts**

Replace the current `PROMPT` with:

```typescript
const PROMPT = `Parse this receipt image. Return JSON only — no markdown, no explanation.
{"restaurantName":string|null,"items":[{"id":string,"name":string,"quantity":number,"unitPrice":number,"totalPrice":number,"category":"food"|"drink"|"dessert"|"other"}],"subtotal":number|null,"tax":number|null,"taxPercent":number|null,"serviceCharge":number|null,"total":number|null,"currency":"ILS"|"USD"|"EUR"|"GBP"|"other","confidence":"high"|"medium"|"low"}

Rules:
- Keep item names EXACTLY as printed on the receipt — do not translate, do not change language
- If a line is a modifier/extra/note for the previous dish (e.g. sauce, topping, special instruction), merge it into that dish's name or add it as a parenthetical, do not create a separate item
- Merge duplicate items — combine quantities
- Quantity: look for ×N, xN, כמות N, or repeated lines
- unitPrice = totalPrice / quantity
- מע"מ=tax, שירות=service charge, סה"כ=total, הנחה=discount (negative amount)
- Return empty items array if receipt is unreadable`;
```

Note: `nameOriginal` is removed from the schema.

**Step 2: Update ParsedReceipt type to remove nameOriginal**

In `src/types/receipt.types.ts`, find the `ParsedReceiptItem` interface and remove the `nameOriginal` field:

```typescript
export interface ParsedReceiptItem {
  id: string;
  name: string;
  // nameOriginal removed — name stays in original language
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  category: 'food' | 'drink' | 'dessert' | 'other';
}
```

**Step 3: Update receiptParser.ts to remove nameOriginal mapping**

Find where `nameOriginal` is mapped and remove it:
```typescript
// In parseReceiptToItems, remove nameOriginal from the mapped object
name: item.name,
// remove: nameOriginal: item.nameOriginal ?? item.name,
```

**Step 4: Update ReviewScreen.tsx to remove the Hebrew nameOriginal display block**

Remove lines 132-136:
```tsx
// DELETE this block entirely:
{containsHebrew(item.nameOriginal) && item.nameOriginal !== item.name && (
  <p dir="rtl" className="text-xs text-muted mt-0.5 font-mono">
    {item.nameOriginal}
  </p>
)}
```

Also remove the `containsHebrew` import if no longer used.

**Step 5: Update ReceiptItem type in receipt.types.ts**

```typescript
export interface ReceiptItem {
  id: string;
  name: string;
  // nameOriginal removed
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  category: 'food' | 'drink' | 'dessert' | 'other';
  isEdited: boolean;
}
```

**Step 6: Commit**
```bash
git add src/services/geminiVision.ts src/types/receipt.types.ts src/services/receiptParser.ts src/screens/ReviewScreen.tsx
git commit -m "feat: keep original receipt language, improve dish grouping prompt"
```

---

## Task 3: Manual item add — inline edit mode with auto-focus

**Problem:** Clicking "Add item manually" adds a blank item but doesn't auto-focus the name input. The edit mode is already in ReviewScreen but needs to auto-open for new items.

**Files:**
- Modify: `src/screens/ReviewScreen.tsx`

**Step 1: Change the Add item button handler to set editingId immediately**

Find this in ReviewScreen.tsx:
```tsx
onClick={() => addItem(createManualItem())}
```

Replace with a handler that adds the item AND immediately enters edit mode:
```tsx
function handleAddManual() {
  const item = createManualItem();
  addItem(item);
  setEditingId(item.id);
}
```

And change the button:
```tsx
onClick={handleAddManual}
```

**Step 2: Add `onKeyDown` to name input to move focus to price on Enter**

In the edit mode block, update the name input to use a ref and add onKeyDown:
```tsx
// Add at top of component:
const priceInputRef = useRef<HTMLInputElement>(null);

// Update name input:
<input
  className="w-full text-sm font-medium text-primary bg-surface border border-border rounded-lg px-3 py-2"
  value={item.name}
  onChange={(e) => updateItem(item.id, { name: e.target.value })}
  placeholder="Item name"
  autoFocus
  onKeyDown={(e) => {
    if (e.key === 'Enter') priceInputRef.current?.focus();
  }}
/>

// Update price input to use ref:
<input
  ref={priceInputRef}
  type="number"
  ...
  onKeyDown={(e) => {
    if (e.key === 'Enter') setEditingId(null);
  }}
/>
```

**Step 3: Commit**
```bash
git add src/screens/ReviewScreen.tsx
git commit -m "feat: auto-focus name then price when adding manual item"
```

---

## Task 4: Who's Here? redesign — "Me" + guests + solo flow

**Files:**
- Modify: `src/screens/PeopleScreen.tsx`
- Modify: `src/hooks/useSplitSession.ts` (add `ensureMe` on mount)
- Modify: `src/screens/ReviewScreen.tsx` (change Continue button navigation)

**Step 1: Auto-add "Me" when entering PeopleScreen**

In `PeopleScreen.tsx`, add a `useEffect` that adds "Me" if people is empty:

```tsx
import { useState, useEffect } from 'react';
// inside PeopleScreen:
useEffect(() => {
  if (people.length === 0) {
    addPerson('Me');
  }
}, []); // runs once on mount
```

**Step 2: Redesign PeopleScreen layout**

Replace the current single-section layout with two sections:

```tsx
return (
  <ScreenContainer>
    <div className="px-5 pt-12 pb-4">
      <button onClick={() => setScreen('review')} className="text-muted mb-4">
        <ArrowLeft className="w-6 h-6" />
      </button>
      <h2 className="font-display text-2xl font-bold text-primary">Who's here?</h2>
      <p className="text-muted text-sm mt-1">Start with yourself, then add your group</p>
    </div>

    <div className="flex-1 overflow-y-auto px-5 pb-32 space-y-6">

      {/* ME section */}
      <div>
        <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">That's me</p>
        {people[0] && (
          <motion.div
            layout
            className="flex items-center gap-3 p-4 rounded-2xl border-2 bg-accent-soft"
            style={{ borderColor: people[0].color }}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
              style={{ backgroundColor: people[0].color }}
            >
              {people[0].avatar}
            </div>
            <input
              className="flex-1 text-sm font-semibold text-primary bg-transparent outline-none"
              value={people[0].name}
              onChange={(e) => updatePersonName(people[0].id, e.target.value)}
              placeholder="Your name"
            />
            <span className="text-xs text-muted">👤 you</span>
          </motion.div>
        )}
      </div>

      {/* GUESTS section */}
      <div>
        <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
          Who's joining? <span className="font-normal normal-case">({people.length - 1} {people.length - 1 === 1 ? 'person' : 'people'})</span>
        </p>

        <AnimatePresence mode="popLayout">
          {people.slice(1).map((person) => (
            <PersonChip
              key={person.id}
              person={person}
              onRemove={() => removePerson(person.id)}
              onNameChange={(name) => updatePersonName(person.id, name)}
            />
          ))}
        </AnimatePresence>

        {/* Add guest input */}
        <div className="flex gap-3 mt-3">
          <input
            className="flex-1 px-4 py-3 bg-surface border border-border rounded-2xl text-sm text-primary outline-none focus:border-accent"
            placeholder="Add a name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <motion.button
            onClick={() => handleAdd()}
            disabled={!newName.trim()}
            className="w-12 h-12 rounded-2xl bg-accent flex items-center justify-center text-white disabled:opacity-40"
            whileTap={{ scale: 0.95 }}
          >
            <UserPlus className="w-5 h-5" />
          </motion.button>
        </div>

        {/* Quick add buttons */}
        <div className="flex gap-2 mt-3">
          {[2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => handleQuickAdd(n)}
              className="px-3 py-1.5 bg-surface border border-border rounded-full text-xs text-muted font-medium"
            >
              +{n} guests
            </button>
          ))}
        </div>
      </div>
    </div>

    {/* CTA — solo flow goes directly to tip, group goes to claim */}
    <div className="fixed bottom-0 left-0 right-0 p-5 bg-bg/90 backdrop-blur-sm border-t border-border">
      {people.length === 1 ? (
        <div className="space-y-2">
          <motion.button
            onClick={() => setScreen('tip')}
            className="w-full flex items-center justify-center gap-2 py-4 bg-primary text-white font-semibold rounded-2xl"
            whileTap={{ scale: 0.97 }}
          >
            Just me — see my total
            <ChevronRight className="w-5 h-5" />
          </motion.button>
          <p className="text-center text-xs text-muted">or add people above to split</p>
        </div>
      ) : (
        <motion.button
          onClick={() => setScreen('claim')}
          className="w-full flex items-center justify-center gap-2 py-4 bg-primary text-white font-semibold rounded-2xl"
          whileTap={{ scale: 0.97 }}
        >
          Split with {people.length} people
          <ChevronRight className="w-5 h-5" />
        </motion.button>
      )}
    </div>
  </ScreenContainer>
);
```

**Step 3: Handle solo flow in TipScreen and SummaryScreen**

When `people.length === 1` and the user goes directly to tip:
- TipScreen: already works, no change needed (tip is applied to the whole subtotal)
- SummaryScreen: `calculatePersonTotal` already computes per-person correctly

In `useSplitSession.ts`, add a helper that auto-claims all items for "Me" when in solo mode. Add this to `setScreen`:

Actually simpler: in `SummaryScreen`, when `people.length === 1`, calculate total using all items (no claims needed). Update `splitCalculator.ts` to handle this:

```typescript
// In splitCalculator.ts, if no claims exist for a person but they're the only person,
// treat all items as theirs
if (claims.length === 0 && totalPeopleCount === 1) {
  subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
}
```

**Step 4: Commit**
```bash
git add src/screens/PeopleScreen.tsx src/services/splitCalculator.ts
git commit -m "feat: redesign Who's Here with Me/guests sections and solo flow"
```

---

## Task 5: Pass-the-phone private claiming mode

**Files:**
- Modify: `src/screens/ClaimScreen.tsx`

**Step 1: Add `privateMode` state and `coverShown` state**

```tsx
const [privateMode, setPrivateMode] = useState(false);
const [showCover, setShowCover] = useState(false);
```

**Step 2: Add private mode toggle in the header**

```tsx
// Add next to the title:
<button
  onClick={() => setPrivateMode((v) => !v)}
  className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
    privateMode ? 'bg-primary text-white border-primary' : 'border-border text-muted'
  }`}
>
  {privateMode ? '🔒 Private' : '👁 Open'}
</button>
```

**Step 3: Modify the next/prev functions to show cover when private mode is on**

```tsx
function next() {
  const nextIndex = (activePersonIndex + 1) % people.length;
  setActivePersonIndex(nextIndex);
  if (privateMode) setShowCover(true);
}
function prev() {
  const prevIndex = (activePersonIndex - 1 + people.length) % people.length;
  setActivePersonIndex(prevIndex);
  if (privateMode) setShowCover(true);
}
```

**Step 4: Add the cover screen overlay**

```tsx
<AnimatePresence>
  {showCover && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-bg z-50 flex flex-col items-center justify-center gap-6 px-8"
    >
      <div
        className="w-20 h-20 rounded-full flex items-center justify-center text-white text-3xl font-bold"
        style={{ backgroundColor: activePerson.color }}
      >
        {activePerson.avatar}
      </div>
      <div className="text-center">
        <h2 className="font-display text-2xl font-bold text-primary">
          Pass to {activePerson.name}
        </h2>
        <p className="text-muted text-sm mt-2">
          Hand the phone to {activePerson.name}
        </p>
      </div>
      <motion.button
        onClick={() => setShowCover(false)}
        className="w-full max-w-xs py-4 bg-primary text-white font-semibold rounded-2xl"
        whileTap={{ scale: 0.97 }}
      >
        I'm ready — show my items
      </motion.button>
    </motion.div>
  )}
</AnimatePresence>
```

**Step 5: In private mode, hide avatar stacks on ItemCard**

Pass `privateMode` down to `ItemCard` and conditionally hide the avatar stack:

```tsx
// In ItemCard props, add:
hideClaimants?: boolean;

// In ItemCard render, wrap avatar stack:
{claim && !hideClaimants && (
  <div className="flex -space-x-1">
    ...avatars...
  </div>
)}
```

**Step 6: Commit**
```bash
git add src/screens/ClaimScreen.tsx src/components/claim/ItemCard.tsx
git commit -m "feat: add pass-the-phone private claiming mode"
```

---

## Task 6: Final cleanup and type-check

**Step 1: Run TypeScript check**
```bash
cd ai-split-the-recipe && npx tsc --noEmit
```
Fix any type errors from removing `nameOriginal`.

**Step 2: Check for remaining `nameOriginal` references**
```bash
grep -r "nameOriginal" src/
```
Remove any remaining references.

**Step 3: Run the app and test all 6 flows**
- [ ] Shared item shows "Claimed" badge when another person views it
- [ ] Receipt scanned with Hebrew stays in Hebrew
- [ ] Modifier lines merged into parent dish
- [ ] Add item → name auto-focuses → Enter moves to price → Enter commits
- [ ] Who's Here: "Me" auto-added, solo flow goes to tip directly
- [ ] Private mode: cover screen shows between people

**Step 4: Final commit**
```bash
git add -A
git commit -m "chore: cleanup after UX improvements — pass type check"
```
