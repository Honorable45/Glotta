import { describe, expect, it } from 'vitest';
import { computeSale, costOf, debtStatus, normalizeSearch, returnValue, validateAttributeValue } from './index';

const line = (quantity: bigint, unitPrice: bigint, lineDiscount = 0n, taxRateBp = 0) => ({ quantity, unitPrice, lineDiscount, taxRateBp });

describe('calcul de vente', () => {
  it('calcule un total simple', () => {
    const r = computeSale([line(2000n, 2500n), line(1000n, 1000n)], 0n);
    expect([r.subtotal, r.discount, r.total]).toEqual([6000n, 0n, 6000n]);
  });
  it('gère les quantités fractionnaires et les arrondis', () => {
    expect(computeSale([line(1500n, 333n)], 0n).total).toBe(500n);
    expect(computeSale([line(250n, 1000n)], 0n).total).toBe(250n);
  });
  it('répartit la remise globale sans perdre un seul franc', () => {
    const r = computeSale([line(1000n, 1000n), line(1000n, 1000n), line(1000n, 1000n)], 100n);
    expect(r.lines.map((l) => l.cartDiscount)).toEqual([33n, 33n, 34n]);
    expect(r.total).toBe(2900n);
    expect(r.lines.reduce((s, l) => s + l.lineTotal, 0n)).toBe(r.total);
  });
  it('cumule remise de ligne et remise globale', () => {
    const r = computeSale([line(1000n, 1000n, 100n), line(1000n, 900n)], 180n);
    expect(r.subtotal).toBe(1900n);
    expect(r.total).toBe(1620n);
    expect(r.discount).toBe(280n);
  });
  it('ignore les lignes offertes dans la répartition', () => {
    const r = computeSale([line(1000n, 500n), line(1000n, 0n)], 100n);
    expect(r.lines.map((l) => l.cartDiscount)).toEqual([100n, 0n]);
  });
  it('extrait la taxe d’un prix taxes comprises', () => {
    expect(computeSale([line(1000n, 11800n, 0n, 1800)], 0n).tax).toBe(1800n);
    expect(computeSale([line(1000n, 11800n, 0n, 0)], 0n).tax).toBe(0n);
  });
  it('rejette les valeurs incohérentes', () => {
    expect(() => computeSale([line(0n, 100n)], 0n)).toThrow();
    expect(() => computeSale([line(1000n, -1n)], 0n)).toThrow();
    expect(() => computeSale([line(1000n, 100n, 101n)], 0n)).toThrow();
    expect(() => computeSale([line(1000n, 100n)], 101n)).toThrow();
    expect(() => computeSale([line(1000n, 100n)], -1n)).toThrow();
  });
  it('dépasse sans erreur les grands montants', () => {
    expect(computeSale([line(1000n, 5_000_000_000n)], 0n).total).toBe(5_000_000_000n);
  });
  it('calcule le coût pour la marge', () => {
    expect(costOf(1500n, 1000n)).toBe(1500n);
  });
});

describe('retours', () => {
  const sold = { quantity: 3000n, lineTotal: 1000n };
  it('solde exactement la ligne au dernier retour', () => {
    const first = returnValue(sold, 0n, 0n, 1000n);
    const second = returnValue(sold, 1000n, first, 1000n);
    const third = returnValue(sold, 2000n, first + second, 1000n);
    expect(first + second + third).toBe(1000n);
  });
  it('refuse de retourner plus que vendu', () => {
    expect(() => returnValue(sold, 2000n, 0n, 1001n)).toThrow();
    expect(() => returnValue(sold, 0n, 0n, 0n)).toThrow();
  });
});

describe('statut de dette', () => {
  const base = { total: 1000n, today: '2026-10-30', dueDate: null };
  it('suit les paiements et l’échéance', () => {
    expect(debtStatus({ ...base, paid: 0n })).toBe('PENDING');
    expect(debtStatus({ ...base, paid: 1n })).toBe('PARTIAL');
    expect(debtStatus({ ...base, paid: 1000n })).toBe('PAID');
    expect(debtStatus({ ...base, paid: 1n, dueDate: '2026-10-29' })).toBe('OVERDUE');
    expect(debtStatus({ ...base, paid: 0n, dueDate: '2026-10-30' })).toBe('PENDING');
    expect(debtStatus({ ...base, paid: 1000n, dueDate: '2026-01-01' })).toBe('PAID');
  });
});

describe('recherche et caractéristiques', () => {
  it('normalise les accents', () => {
    expect(normalizeSearch('  Téléphone ÉCRAN ')).toBe('telephone ecran');
  });
  it('valide selon le type', () => {
    const check = (type: string, value: string) => validateAttributeValue({ name: 'X', type, options: ['A'] }, value);
    expect(check('NUMBER', '12,5')).toBeNull();
    expect(check('NUMBER', 'abc')).not.toBeNull();
    expect(check('DATE', '2026-01-31')).toBeNull();
    expect(check('DATE', 'demain')).not.toBeNull();
    expect(check('SELECT', 'A')).toBeNull();
    expect(check('SELECT', 'B')).not.toBeNull();
    expect(check('BOOLEAN', 'true')).toBeNull();
    expect(check('MONEY', '10,50')).toBeNull();
    expect(check('TEXT', 'libre')).toBeNull();
  });
});
