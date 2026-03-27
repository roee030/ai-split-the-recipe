import type { ReceiptItem } from '../types/receipt.types';
import type { ItemClaim, TipConfig, PersonTotal } from '../types/split.types';

export function calculatePersonTotal(
  personId: string,
  claims: ItemClaim[],
  items: ReceiptItem[],
  tip: TipConfig,
  tax: number,
  serviceCharge: number,
  grandSubtotal: number,
  totalPeopleCount: number
): PersonTotal {
  let subtotal = 0;
  const lineItems: PersonTotal['items'] = [];

  for (const claim of claims.filter((c) => c.personIds.includes(personId))) {
    const item = items.find((i) => i.id === claim.itemId);
    if (!item) continue;

    const shared = claim.personIds.length > 1;
    let amount: number;

    if (!shared) {
      const myQty = claim.quantityPerPerson?.[personId] ?? item.quantity;
      amount = item.unitPrice * myQty;
    } else {
      if (claim.quantityPerPerson && claim.quantityPerPerson[personId] !== undefined) {
        amount = item.unitPrice * claim.quantityPerPerson[personId];
      } else {
        amount = item.totalPrice / claim.personIds.length;
      }
    }

    subtotal += amount;
    lineItems.push({ name: item.name, amount, shared });
  }

  const grandSubtotalSafe = grandSubtotal || 1;

  let tipAmount = 0;
  if (tip.mode === 'percent') {
    const totalTip = grandSubtotalSafe * (tip.value / 100);
    tipAmount =
      tip.splitMode === 'proportional'
        ? (subtotal / grandSubtotalSafe) * totalTip
        : totalTip / totalPeopleCount;
  } else {
    tipAmount =
      tip.splitMode === 'proportional'
        ? (subtotal / grandSubtotalSafe) * tip.value
        : tip.value / totalPeopleCount;
  }

  const taxAmount = grandSubtotal ? (subtotal / grandSubtotalSafe) * tax : 0;
  const serviceAmount = grandSubtotal ? (subtotal / grandSubtotalSafe) * serviceCharge : 0;

  return {
    personId,
    subtotal,
    tipAmount,
    taxAmount,
    serviceAmount,
    total: subtotal + tipAmount + taxAmount + serviceAmount,
    items: lineItems,
  };
}

export function calculateAllTotals(
  personIds: string[],
  claims: ItemClaim[],
  items: ReceiptItem[],
  tip: TipConfig,
  tax: number,
  serviceCharge: number
): Record<string, PersonTotal> {
  const grandSubtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
  const result: Record<string, PersonTotal> = {};

  for (const pid of personIds) {
    result[pid] = calculatePersonTotal(
      pid,
      claims,
      items,
      tip,
      tax,
      serviceCharge,
      grandSubtotal,
      personIds.length
    );
  }

  return result;
}
