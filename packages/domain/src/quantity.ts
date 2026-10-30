/** Les quantités sont stockées en millièmes : 1,5 kg = 1500. */
const FACTOR = 1000n;

export function parseQuantity(input: string): bigint {
  const match = /^(\d+)(?:[.,](\d{1,3}))?$/.exec(input.trim());
  if (!match) throw new Error(`Quantité invalide : ${input}`);
  return BigInt(match[1] ?? '0') * FACTOR + BigInt((match[2] ?? '').padEnd(3, '0'));
}

export function formatQuantity(quantity: bigint): string {
  const sign = quantity < 0n ? '-' : '';
  const absolute = quantity < 0n ? -quantity : quantity;
  const fraction = (absolute % FACTOR).toString().padStart(3, '0').replace(/0+$/, '');
  return `${sign}${absolute / FACTOR}${fraction ? `,${fraction}` : ''}`;
}
