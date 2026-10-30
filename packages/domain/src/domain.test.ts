import { describe, expect, it } from 'vitest';
import { formatAmount, formatQuantity, newId, parseAmount, parseQuantity } from './index';

const clean = (text: string) => text.replace(/[  ]/g, ' ');

describe('montants', () => {
  it('lit les saisies usuelles sans flottant', () => {
    expect(parseAmount('2 500', 'XOF')).toBe(2500n);
    expect(parseAmount('12,50', 'EUR')).toBe(1250n);
    expect(parseAmount('0.07', 'EUR')).toBe(7n);
    expect(parseAmount('-300', 'XOF')).toBe(-300n);
    expect(parseAmount('5000000000', 'XOF')).toBe(5000000000n);
  });
  it('rejette les saisies invalides', () => {
    for (const bad of ['', 'abc', '12,5', '1.2.3']) expect(() => parseAmount(bad, 'XOF')).toThrow();
    expect(() => parseAmount('1,234', 'EUR')).toThrow();
    expect(() => parseAmount('1', 'ZZZ')).toThrow();
  });
  it('formate selon la devise', () => {
    expect(clean(formatAmount(2500n, 'XOF'))).toBe('2 500 FCFA');
    expect(clean(formatAmount(-1250n, 'EUR'))).toBe('-12,50 EUR');
  });
});

describe('quantités', () => {
  it('gère les fractions', () => {
    expect(parseQuantity('1,5')).toBe(1500n);
    expect(parseQuantity('3')).toBe(3000n);
    expect(formatQuantity(1500n)).toBe('1,5');
    expect(formatQuantity(3000n)).toBe('3');
    expect(formatQuantity(-250n)).toBe('-0,25');
    expect(() => parseQuantity('1,2345')).toThrow();
  });
});

describe('identifiants', () => {
  it('sont uniques et triables', () => {
    const a = newId();
    const b = newId();
    expect(a).not.toBe(b);
    expect(a[14]).toBe('7');
  });
});
