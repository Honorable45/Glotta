import { parseAmount, parseQuantity } from '@gestion/domain';

export function tryAmount(text: string, currency: string): bigint | null {
  try {
    return parseAmount(text, currency);
  } catch {
    return null;
  }
}

export function tryQuantity(text: string): bigint | null {
  try {
    return parseQuantity(text);
  } catch {
    return null;
  }
}

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

export const saleStatusLabels: Record<string, string> = { COMPLETED: 'Validée', CANCELLED: 'Annulée' };

export const movementLabels: Record<string, string> = {
  IN: 'Entrée',
  OUT: 'Sortie',
  SALE: 'Vente',
  RETURN: 'Retour',
  INVENTORY: 'Inventaire',
};
