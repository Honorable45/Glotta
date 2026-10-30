/** Nombre de décimales par devise. Les montants sont stockés en entiers dans cette unité. */
const CURRENCY_DECIMALS: Record<string, number> = { XOF: 0, XAF: 0, GNF: 0, EUR: 2, USD: 2 };

const CURRENCY_LABELS: Record<string, string> = { XOF: 'FCFA', XAF: 'FCFA' };

function decimalsOf(currency: string): number {
  const decimals = CURRENCY_DECIMALS[currency];
  if (decimals === undefined) throw new Error(`Devise non prise en charge : ${currency}`);
  return decimals;
}

/** Convertit une saisie (« 2 500 », « 12,50 ») en entier, sans passer par un flottant. */
export function parseAmount(input: string, currency: string): bigint {
  const decimals = decimalsOf(currency);
  const text = input.replace(/[\s  ]/g, '').replace(',', '.');
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`Montant invalide : ${input}`);
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > decimals) throw new Error(`Trop de décimales pour ${currency} : ${input}`);
  const minor = BigInt((whole ?? '') + fraction.padEnd(decimals, '0'));
  return sign ? -minor : minor;
}

export function formatAmount(amount: bigint, currency: string): string {
  const decimals = decimalsOf(currency);
  const factor = 10n ** BigInt(decimals);
  const absolute = amount < 0n ? -amount : amount;
  const whole = new Intl.NumberFormat('fr-FR').format(absolute / factor);
  const fraction = decimals ? `,${(absolute % factor).toString().padStart(decimals, '0')}` : '';
  return `${amount < 0n ? '-' : ''}${whole}${fraction} ${CURRENCY_LABELS[currency] ?? currency}`;
}
