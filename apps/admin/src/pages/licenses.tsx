import { Alert, Button, Card, DataTable, DetailList, Field, Input, Select, Textarea } from '@gestion/ui';
import { useState } from 'react';
import { api, date, dateTime, fcfa, featureLabels, LicenseStatus, receiptName, SaleStatus, saveText, useApi } from '../lib';
import type { Customer } from './customers';
import type { Edition } from './editions';

interface LicenseRow {
  id: string;
  keyHint: string;
  editionName: string;
  status: string;
  statusReason: string | null;
  isTrial: boolean;
  trialEndsAt: string | null;
  maxDevices: number;
  maxMajorVersion: number;
  createdAt: string;
  customer: { id: string; name: string };
  _count: { activations: number };
}

interface LicenseDetail extends Omit<LicenseRow, '_count'> {
  features: string[];
  maxUsers: number;
  maxStores: number;
  syncQuotaMb: number;
  syncBytes: number;
  activations: { id: string; deviceName: string; appVersion: string; method: string; lastSeenAt: string | null; releasedAt: string | null; releaseReason: string | null; createdAt: string }[];
  events: { id: string; type: string; details: unknown; createdAt: string }[];
  sales: { id: string; number: number; status: string; amount: number; kind: string }[];
}

const eventLabels: Record<string, string> = {
  'license.create': 'Licence créée, en attente',
  'license.issue': 'Licence délivrée après paiement',
  'license.trial': 'Essai créé',
  'license.suspend': 'Suspendue',
  'license.resume': 'Réactivée',
  'license.revoke': 'Révoquée',
  'license.upgrade': 'Mise à niveau',
  'license.upgrade.refund': 'Mise à niveau remboursée',
  'activation.create': 'Poste activé',
  'activation.transfer': 'Transfert depuis le poste',
  'activation.release': 'Poste libéré',
};

function LicenseCard({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, error, setError, reload } = useApi<LicenseDetail>(`/admin/licenses/${id}`);
  const [key, setKey] = useState<string | null>(null);
  const [action, setAction] = useState<'suspend' | 'resume' | 'revoke' | null>(null);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  if (!data) return error ? <Alert>{error}</Alert> : null;
  const refresh = () => { setAction(null); setReleasing(null); setReason(''); onChanged(); return reload(); };
  const fail = (cause: Error) => setError(cause.message);
  return (
    <Card title={`Licence …${data.keyHint}`}>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      <DetailList
        items={[
          { label: 'Client', value: data.customer.name },
          { label: 'Édition', value: `${data.editionName}${data.isTrial ? ' (essai)' : ''}` },
          { label: 'État', value: <LicenseStatus status={data.status} /> },
          ...(data.statusReason ? [{ label: 'Motif', value: data.statusReason }] : []),
          ...(data.trialEndsAt ? [{ label: "Fin de l'essai", value: date(data.trialEndsAt) }] : []),
          { label: 'Ordinateurs', value: `${data.activations.filter((row) => !row.releasedAt).length} sur ${data.maxDevices}` },
          { label: 'Versions couvertes', value: `jusqu'à ${data.maxMajorVersion}.x` },
          { label: 'Utilisateurs et boutiques', value: `${data.maxUsers} et ${data.maxStores}` },
          { label: 'Fonctions', value: <span className="font-normal">{data.features.map((feature) => featureLabels[feature] ?? feature).join(', ') || 'De base'}</span> },
          ...(data.syncQuotaMb > 0 ? [{ label: 'Stockage de synchronisation', value: `${(data.syncBytes / 1048576).toFixed(1)} Mo sur ${data.syncQuotaMb} Mo` }] : []),
        ]}
      />
      <div className="mt-4 flex flex-wrap gap-2">
        {data.status !== 'PENDING' && !key && <Button onClick={() => api<{ key: string }>(`/admin/licenses/${id}/reveal-key`, 'POST', {}).then((result) => setKey(result.key)).catch(fail)}>Afficher la clé</Button>}
        {data.status === 'ACTIVE' && <Button variant="secondary" onClick={() => setAction('suspend')}>Suspendre</Button>}
        {data.status === 'SUSPENDED' && <Button variant="secondary" onClick={() => setAction('resume')}>Réactiver</Button>}
        {(data.status === 'ACTIVE' || data.status === 'SUSPENDED') && <Button variant="secondary" onClick={() => setAction('revoke')}>Révoquer</Button>}
        <Button variant="secondary" onClick={onClose}>Fermer</Button>
      </div>
      {data.status === 'PENDING' && <p className="mt-3 text-sm text-muted">La clé sera disponible après confirmation du paiement.</p>}
      {key && <p data-testid="license-key" className="mt-3 break-all rounded-md bg-canvas px-3.5 py-3 font-mono text-base">{key}</p>}
      {(action || releasing) && (
        <div className="mt-4 flex flex-col gap-3 rounded-md border border-border p-3">
          <p className="text-sm">
            {action === 'suspend' && 'Le poste bloquera les nouvelles opérations à sa prochaine connexion. Les données restent consultables et exportables.'}
            {action === 'resume' && 'La licence redeviendra active à la prochaine connexion du poste.'}
            {action === 'revoke' && 'Révocation définitive. Le poste bloquera les nouvelles opérations à sa prochaine connexion. Ses données restent consultables et exportables.'}
            {releasing && 'La place de ce poste redevient disponible pour un autre ordinateur.'}
          </p>
          <Field label="Motif (journalisé)"><Input value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
          <div className="flex gap-2">
            <Button
              disabled={reason.trim().length < 3}
              onClick={() => (releasing ? api(`/admin/activations/${releasing}/release`, 'POST', { reason }) : api(`/admin/licenses/${id}/status`, 'POST', { action, reason })).then(refresh).catch(fail)}
            >
              Appliquer
            </Button>
            <Button variant="secondary" onClick={() => { setAction(null); setReleasing(null); }}>Annuler</Button>
          </div>
        </div>
      )}
      <h3 className="mb-1 mt-5 text-sm font-semibold">Ordinateurs activés</h3>
      <DataTable
        rows={data.activations}
        rowKey={(row) => row.id}
        empty="Aucun ordinateur activé."
        columns={[
          { header: 'Poste', render: (row) => <>{row.deviceName}<span className="block text-xs text-muted">Version {row.appVersion}, {row.method === 'OFFLINE' ? 'hors ligne' : 'en ligne'}</span></> },
          { header: 'Dernière connexion', render: (row) => dateTime(row.lastSeenAt) },
          { header: 'État', render: (row) => (row.releasedAt ? `Libéré : ${row.releaseReason ?? ''}` : 'En service') },
          { header: 'Actions', align: 'right', render: (row) => (row.releasedAt ? '' : <Button variant="secondary" onClick={() => setReleasing(row.id)}>Libérer</Button>) },
        ]}
      />
      <h3 className="mb-1 mt-5 text-sm font-semibold">Ventes</h3>
      <DataTable
        rows={data.sales}
        rowKey={(row) => row.id}
        empty={data.isTrial ? 'Essai sans vente.' : 'Aucune vente.'}
        columns={[
          { header: 'Numéro', render: (row) => receiptName(row.number) },
          { header: 'État', render: (row) => <SaleStatus status={row.status} /> },
          { header: 'Montant', align: 'right', render: (row) => fcfa(row.amount) },
        ]}
      />
      <h3 className="mb-1 mt-5 text-sm font-semibold">Historique</h3>
      <DataTable
        rows={data.events}
        rowKey={(row) => row.id}
        empty="Aucun événement."
        columns={[
          { header: 'Date', render: (row) => dateTime(row.createdAt) },
          { header: 'Événement', render: (row) => eventLabels[row.type] ?? row.type },
        ]}
      />
    </Card>
  );
}

function NewTrial({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const customers = useApi<Customer[]>('/admin/customers');
  const editions = useApi<{ editions: Edition[] }>('/admin/editions');
  const [form, setForm] = useState({ customerId: '', editionCode: '' });
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="Créer une licence d'essai">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Client">
          <Select value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}>
            <option value="">Choisir</option>
            {(customers.data ?? []).map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
          </Select>
        </Field>
        <Field label="Édition essayée">
          <Select value={form.editionCode} onChange={(event) => setForm({ ...form, editionCode: event.target.value })}>
            <option value="">Choisir</option>
            {(editions.data?.editions ?? []).map((edition) => <option key={edition.code} value={edition.code}>{edition.name}</option>)}
          </Select>
        </Field>
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      <div className="mt-3 flex gap-2">
        <Button disabled={!form.customerId || !form.editionCode} onClick={() => api('/admin/licenses/trial', 'POST', form).then(onDone).catch((cause: Error) => setError(cause.message))}>Créer l'essai</Button>
        <Button variant="secondary" onClick={onCancel}>Annuler</Button>
      </div>
    </Card>
  );
}

function OfflineActivation({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const [request, setRequest] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ token: string; fileName: string; deviceName: string } | null>(null);
  return (
    <Card title="Activation hors ligne">
      <p className="mb-3 text-sm text-muted">Collez le contenu du fichier de demande créé par le logiciel, ou choisissez ce fichier. Vous obtiendrez un fichier de licence signé à remettre au client.</p>
      <Field label="Demande d'activation"><Textarea value={request} onChange={(event) => setRequest(event.target.value)} /></Field>
      <input
        aria-label="Fichier de demande"
        type="file"
        accept=".gcdemande"
        className="mt-2 block max-w-full text-sm"
        onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setRequest); }}
      />
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      {result && (
        <div className="mt-3 flex flex-col gap-2">
          <p role="status" className="rounded-md bg-success-bg px-3.5 py-2.5 text-sm text-success">Poste « {result.deviceName} » activé.</p>
          <p data-testid="offline-token" className="max-h-32 overflow-auto break-all rounded-md bg-canvas p-3 font-mono text-xs">{result.token}</p>
          <div><Button onClick={() => saveText(result.token, result.fileName)}>Télécharger le fichier de licence</Button></div>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Button disabled={!request.trim()} onClick={() => { setError(null); api<{ token: string; fileName: string; deviceName: string }>('/admin/activations/offline', 'POST', { request }).then((value) => { setResult(value); onDone(); }).catch((cause: Error) => setError(cause.message)); }}>Générer la licence</Button>
        <Button variant="secondary" onClick={onCancel}>Fermer</Button>
      </div>
    </Card>
  );
}

export function LicensesPage({ focus, onFocus }: { focus: string | null; onFocus: (id: string | null) => void }) {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const { data, error, reload } = useApi<LicenseRow[]>(`/admin/licenses?search=${encodeURIComponent(search)}${status ? `&status=${status}` : ''}`);
  const [panel, setPanel] = useState<'trial' | 'offline' | null>(null);
  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      {panel === 'trial' && <NewTrial onCancel={() => setPanel(null)} onDone={() => { setPanel(null); void reload(); }} />}
      {panel === 'offline' && <OfflineActivation onCancel={() => setPanel(null)} onDone={() => void reload()} />}
      {focus && <LicenseCard key={focus} id={focus} onClose={() => onFocus(null)} onChanged={() => void reload()} />}
      <Card title="Licences">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1"><Input aria-label="Rechercher une licence" placeholder="Client ou fin de clé" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          <div className="w-40">
            <Select aria-label="Filtrer par état" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Toutes</option>
              <option value="PENDING">En attente</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspendue</option>
              <option value="REVOKED">Révoquée</option>
            </Select>
          </div>
          <Button variant="secondary" onClick={() => setPanel('trial')}>Créer un essai</Button>
          <Button variant="secondary" onClick={() => setPanel('offline')}>Activation hors ligne</Button>
        </div>
        <DataTable<LicenseRow>
          rows={data ?? []}
          rowKey={(row) => row.id}
          empty="Aucune licence."
          columns={[
            { header: 'Clé', render: (row) => <button type="button" className="font-mono underline" onClick={() => onFocus(row.id)}>…{row.keyHint}</button> },
            { header: 'Client', render: (row) => row.customer.name },
            { header: 'Édition', render: (row) => `${row.editionName}${row.isTrial ? ' (essai)' : ''}` },
            { header: 'Ordinateurs', align: 'right', render: (row) => `${row._count.activations} / ${row.maxDevices}` },
            { header: 'État', render: (row) => <LicenseStatus status={row.status} /> },
          ]}
        />
      </Card>
    </div>
  );
}
