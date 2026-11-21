import { type EventRow, round2 } from './events';
import { getRate } from './fx';

/** Extra cost when the seller charges in a foreign currency. Demo value, shown to the user as its own line. */
export const FOREIGN_SPREAD = 0.015;
export const SINDIBAD_FEE_MAD = 0;
export const MAX_QUANTITY = 8;

export type CostLine = { label: string; amountMad?: number; note?: string };

// shortcut: totals use JS floats rounded to 2 decimals, switch to integer minor units before real money moves
export async function computeTotal(event: EventRow, tierName: string | undefined, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new Error(`Quantity must be between 1 and ${MAX_QUANTITY}.`);
  }
  const tier = tierName
    ? event.tiers.find((t) => t.name.toLowerCase() === tierName.toLowerCase())
    : [...event.tiers].sort((a, b) => a.price - b.price)[0];
  if (!tier) throw new Error(`Unknown ticket type "${tierName}". Available: ${event.tiers.map((t) => t.name).join(', ')}.`);

  const { madPerUnit, recordedAt } = await getRate(event.currency);
  const foreign = event.currency !== 'MAD';
  const ticketsMad = round2(tier.price * quantity * madPerUnit);
  const spreadMad = foreign ? round2(ticketsMad * FOREIGN_SPREAD) : 0;
  const feeMad = SINDIBAD_FEE_MAD;
  const totalMad = round2(ticketsMad + spreadMad + feeMad);

  const lines: CostLine[] = [
    { label: `${quantity} × ${tier.name} · ${tier.price.toLocaleString('en-US')} ${event.currency}`, amountMad: ticketsMad },
  ];
  if (foreign) {
    lines.push({ label: `Rate 1 ${event.currency} = ${madPerUnit} MAD`, note: `recorded ${recordedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC` });
    lines.push({ label: `Conversion spread (${FOREIGN_SPREAD * 100}%)`, amountMad: spreadMad });
  }
  lines.push({ label: 'Sindibad fee', amountMad: feeMad });

  return {
    tier: tier.name,
    quantity,
    unitPriceLocal: tier.price,
    currency: event.currency,
    fxMadPerUnit: madPerUnit,
    fxRecordedAt: recordedAt.toISOString(),
    ticketsMad,
    spreadMad,
    feeMad,
    totalMad,
    lines,
  };
}
export type Total = Awaited<ReturnType<typeof computeTotal>>;
