import { describe, expect, it } from 'vitest';
import { buildReceiptHtml } from './receipt';

const company = { id: 'c', name: 'A&B <script>x()</script>', logoData: null, address: 'Lomé', phone: '90', email: null, currency: 'XOF' as const, taxInfo: null, sector: 'general' };
const sale = {
  id: 's', number: 'V-1', status: 'COMPLETED', customerName: '<b>Afi</b>', netTotal: 2000n, netPaid: 500n, occurredAt: '2026-10-30T10:00:00.000Z',
  subtotal: 2500n, discount: 500n, tax: 0n, total: 2000n, cancelReason: null,
  lines: [{ id: 'l', productName: 'Savon"', variantLabel: '', quantity: 2000n, returnedQuantity: 0n, unitPrice: 1250n, lineDiscount: 0n, cartDiscount: 500n, lineTotal: 2000n, taxRateBp: 0, tax: 0n, serials: [{ id: 'x', serial: 'IMEI<1>' }] }],
  payments: [{ id: 'p', methodName: 'Flooz', amount: 500n, kind: 'PAYMENT', occurredAt: '' }],
  returns: [],
};

describe('ticket', () => {
  it('échappe tout texte saisi', () => {
    const html = buildReceiptHtml({ sale, company, format: 'thermal' });
    expect(html).not.toContain('<script>x()');
    expect(html).not.toContain('<b>Afi');
    expect(html).not.toContain('IMEI<1>');
    expect(html).toContain('A&amp;B');
  });
  it('affiche total, reste à payer et format', () => {
    const clean = (html: string) => html.replace(/[  ]/g, ' ');
    const thermal = clean(buildReceiptHtml({ sale, company, format: 'thermal' }));
    expect(thermal).toContain('2 000 FCFA');
    expect(thermal).toContain('Reste à payer');
    expect(thermal).toContain('1 500 FCFA');
    expect(thermal).toContain('80mm');
    expect(clean(buildReceiptHtml({ sale, company, format: 'a4' }))).toContain('Facture V-1');
  });
});
