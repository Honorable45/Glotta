import { Badge } from '@gestion/ui';
import { useCallback, useEffect, useState } from 'react';

// Le jeton reste en mémoire : fermer l'onglet ferme la session.
let token: string | null = null;
export const setToken = (value: string | null) => { token = value; };

async function send(path: string, method: string, body?: unknown) {
  return fetch(path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await send(path, method, body);
  const data = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(data.error ?? 'Erreur du serveur.');
  return data;
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Le navigateur lit le fichier après le clic : libérer tout de suite pourrait annuler le téléchargement.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadFile(path: string, fileName: string) {
  const response = await send(path, 'GET');
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? 'Téléchargement impossible.');
  saveBlob(await response.blob(), fileName);
}

export const saveText = (text: string, fileName: string) => saveBlob(new Blob([text], { type: 'text/plain' }), fileName);

export function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    return api<T>(path).then(setData).catch((cause: Error) => setError(cause.message));
  }, [path]);
  useEffect(() => void reload(), [reload]);
  return { data, error, setError, reload };
}

export const fcfa = (value: number) => `${new Intl.NumberFormat('fr-FR').format(value)} FCFA`;
export const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '');
export const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR') : '');
export const receiptName = (number: number) => `R-${String(number).padStart(6, '0')}`;

const licenseLabels: Record<string, string> = { PENDING: 'En attente', ACTIVE: 'Active', SUSPENDED: 'Suspendue', REVOKED: 'Révoquée' };
const saleLabels: Record<string, string> = { PENDING: 'En attente', PAID: 'Payé', CANCELLED: 'Annulé', REFUNDED: 'Remboursé' };

export function Neutral({ children }: { children: string }) {
  return <span className="inline-flex rounded bg-canvas px-2 py-0.5 text-xs font-medium text-muted">{children}</span>;
}

export function LicenseStatus({ status }: { status: string }) {
  const label = licenseLabels[status] ?? status;
  if (status === 'ACTIVE') return <Badge tone="success">{label}</Badge>;
  return status === 'PENDING' ? <Neutral>{label}</Neutral> : <Badge tone="danger">{label}</Badge>;
}

export function SaleStatus({ status }: { status: string }) {
  const label = saleLabels[status] ?? status;
  if (status === 'PAID') return <Badge tone="success">{label}</Badge>;
  return status === 'REFUNDED' ? <Badge tone="danger">{label}</Badge> : <Neutral>{label}</Neutral>;
}

export const featureLabels: Record<string, string> = {
  advanced_debts: 'Dettes avancées',
  reminders: 'Rappels',
  expenses: 'Dépenses',
  cash: 'Caisse',
  advanced_reports: 'Rapports avancés',
  export_files: 'Exports Excel et PDF',
  multi_store: 'Plusieurs boutiques',
  consolidated: 'Rapports consolidés',
  advanced_permissions: 'Permissions avancées',
  sync: 'Synchronisation',
};
