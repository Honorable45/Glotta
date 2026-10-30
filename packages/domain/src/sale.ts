/** Division entière arrondie au plus proche, moitié vers le haut. Valeurs positives. */
export function divideRound(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

const QUANTITY_FACTOR = 1000n;
const BP_FACTOR = 10_000n;

export interface CartLine {
  quantity: bigint;
  unitPrice: bigint;
  lineDiscount: bigint;
  taxRateBp: number;
}

export interface ComputedLine {
  gross: bigint;
  cartDiscount: bigint;
  tax: bigint;
  lineTotal: bigint;
}

export interface SaleTotals {
  subtotal: bigint;
  discount: bigint;
  tax: bigint;
  total: bigint;
  lines: ComputedLine[];
}

/**
 * Calcule une vente. Les prix sont taxes comprises : la taxe est extraite du montant net.
 * La remise globale est répartie au prorata pour que marges et taxes restent justes ligne par ligne.
 */
export function computeSale(lines: CartLine[], cartDiscount: bigint): SaleTotals {
  if (cartDiscount < 0n) throw new Error('Remise négative.');
  const nets = lines.map((line) => {
    if (line.quantity <= 0n) throw new Error('Quantité invalide.');
    if (line.unitPrice < 0n || line.lineDiscount < 0n) throw new Error('Montant négatif.');
    const gross = divideRound(line.unitPrice * line.quantity, QUANTITY_FACTOR);
    if (line.lineDiscount > gross) throw new Error('La remise dépasse le montant de la ligne.');
    return { gross, net: gross - line.lineDiscount };
  });
  const netSum = nets.reduce((sum, line) => sum + line.net, 0n);
  if (cartDiscount > netSum) throw new Error('La remise dépasse le total.');

  // La dernière ligne non nulle absorbe l'arrondi : la somme des parts vaut exactement la remise.
  let lastNonZero = -1;
  nets.forEach((line, index) => { if (line.net > 0n) lastNonZero = index; });
  let allocated = 0n;
  const computed = nets.map((line, index): ComputedLine => {
    let share = 0n;
    if (netSum > 0n) {
      share = index === lastNonZero ? cartDiscount - allocated : divideRound(cartDiscount * line.net, netSum);
      if (share > line.net) share = line.net;
    }
    allocated += share;
    const lineTotal = line.net - share;
    const rate = BigInt(lines[index]!.taxRateBp);
    const tax = rate === 0n ? 0n : divideRound(lineTotal * rate, BP_FACTOR + rate);
    return { gross: line.gross, cartDiscount: share, tax, lineTotal };
  });

  const subtotal = nets.reduce((sum, line) => sum + line.gross, 0n);
  const total = computed.reduce((sum, line) => sum + line.lineTotal, 0n);
  return {
    subtotal,
    discount: subtotal - total,
    tax: computed.reduce((sum, line) => sum + line.tax, 0n),
    total,
    lines: computed,
  };
}

/** Coût d'une quantité, pour calculer la marge. */
export function costOf(quantity: bigint, unitCost: bigint): bigint {
  return divideRound(quantity * unitCost, QUANTITY_FACTOR);
}

/** Valeur d'une part de ligne retournée. Le dernier retour solde exactement la ligne. */
export function returnValue(line: { quantity: bigint; lineTotal: bigint }, alreadyQuantity: bigint, alreadyAmount: bigint, quantity: bigint): bigint {
  if (quantity <= 0n) throw new Error('Quantité invalide.');
  if (alreadyQuantity + quantity > line.quantity) throw new Error('Quantité retournée supérieure à la quantité vendue.');
  if (alreadyQuantity + quantity === line.quantity) return line.lineTotal - alreadyAmount;
  return divideRound(line.lineTotal * quantity, line.quantity);
}

export type DebtStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE';

export function debtStatus(input: { total: bigint; paid: bigint; dueDate: string | null; today: string }): DebtStatus {
  if (input.paid >= input.total) return 'PAID';
  if (input.dueDate && input.dueDate < input.today) return 'OVERDUE';
  return input.paid > 0n ? 'PARTIAL' : 'PENDING';
}

/** Minuscules sans accents : la recherche tolère « telephone » pour « Téléphone ». */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/** Contrôle une valeur saisie selon le type de la caractéristique. Renvoie un message ou null. */
export function validateAttributeValue(attribute: { name: string; type: string; options: string[] }, value: string): string | null {
  switch (attribute.type) {
    case 'NUMBER':
      return /^-?\d+([.,]\d+)?$/.test(value) ? null : `${attribute.name} doit être un nombre.`;
    case 'MONEY':
      return /^\d+([.,]\d{1,2})?$/.test(value) ? null : `${attribute.name} doit être un montant.`;
    case 'DATE':
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? null : `${attribute.name} doit être une date.`;
    case 'BOOLEAN':
      return value === 'true' || value === 'false' ? null : `${attribute.name} est invalide.`;
    case 'SELECT':
      return attribute.options.includes(value) ? null : `${attribute.name} : choix inconnu.`;
    default:
      return null;
  }
}
