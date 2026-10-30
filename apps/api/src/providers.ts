/**
 * Contrat d'un prestataire de paiement. Une notification n'est jamais crue sur parole :
 * seul `fetchStatus`, interrogé par le serveur, peut confirmer un paiement.
 */
export interface PaymentProvider {
  name: string;
  /** Crée le paiement chez le prestataire et renvoie la page où envoyer le client. */
  createPayment(input: { intentId: string; amount: number; description: string }): Promise<{ payUrl: string; providerRef: string | null }>;
  /** Extrait d'une notification l'identifiant du paiement, sans lui accorder de confiance. */
  intentIdFromWebhook(body: unknown): string | null;
  fetchStatus(input: { intentId: string; providerRef: string | null }): Promise<{ status: 'CONFIRMED' | 'PENDING' | 'FAILED'; amount: number | null; providerRef: string | null }>;
}
