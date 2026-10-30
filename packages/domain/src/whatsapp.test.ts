import { describe, expect, it } from 'vitest';
import { normalizePhone, reminderMessage, whatsappUrl } from './whatsapp';

describe('WhatsApp', () => {
  it('normalise les numéros', () => {
    expect(normalizePhone('90 12 34 56')).toBe('22890123456');
    expect(normalizePhone('+228 90-12-34-56')).toBe('22890123456');
    expect(normalizePhone('0022890123456')).toBe('22890123456');
    expect(normalizePhone('+33 6 12 34 56 78')).toBe('33612345678');
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
  });
  it('compose le message prévu et encode le lien', () => {
    const message = reminderMessage({ customerName: 'Afi & Co', amount: '1 500 FCFA', company: 'Boutique' });
    expect(message).toContain("Bonjour Afi & Co,");
    expect(message).toContain('1 500 FCFA');
    expect(message.endsWith('Boutique.')).toBe(true);
    const url = new URL(whatsappUrl('22890123456', message));
    expect(url.origin + url.pathname).toBe('https://wa.me/22890123456');
    expect(url.searchParams.get('text')).toBe(message);
  });
});
