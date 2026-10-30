/** Indicatif appliqué aux numéros locaux : le produit vise d'abord le Togo. */
const DEFAULT_COUNTRY_CODE = '228';

/** Renvoie des chiffres au format international, ou null si le numéro est inutilisable. */
export function normalizePhone(phone: string): string | null {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  let normalized: string;
  if (trimmed.startsWith('+')) normalized = digits;
  else if (digits.startsWith('00')) normalized = digits.slice(2);
  else if (digits.length === 8) normalized = DEFAULT_COUNTRY_CODE + digits;
  else normalized = digits;
  return normalized.length >= 10 && normalized.length <= 15 ? normalized : null;
}

export function reminderMessage(input: { customerName: string; amount: string; company: string }): string {
  return [
    `Bonjour ${input.customerName},`,
    '',
    `Nous vous rappelons qu'il reste un montant de ${input.amount} à régler sur votre achat auprès de ${input.company}.`,
    '',
    'Nous vous remercions pour votre confiance.',
    '',
    'Cordialement,',
    `${input.company}.`,
  ].join('\n');
}

export const whatsappUrl = (phone: string, message: string) => `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
