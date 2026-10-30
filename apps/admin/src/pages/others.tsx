import { Alert, Button, Card, DataTable, DetailList, Field, Input, Select } from '@gestion/ui';
import { useEffect, useState } from 'react';
import { api, dateTime, fcfa, useApi } from '../lib';

export function DashboardPage() {
  const { data, error } = useApi<{ customers: number; activeLicenses: number; pendingLicenses: number; suspendedLicenses: number; revokedLicenses: number; trials: number; activations: number; pendingSales: number; revenue: number; monthRevenue: number }>('/admin/dashboard');
  if (!data) return error ? <Alert>{error}</Alert> : null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Ventes">
        <DetailList
          items={[
            { label: 'Encaissé ce mois-ci', value: fcfa(data.monthRevenue) },
            { label: 'Encaissé au total', value: fcfa(data.revenue) },
            { label: 'Ventes à confirmer', value: data.pendingSales },
            { label: 'Clients', value: data.customers },
          ]}
        />
      </Card>
      <Card title="Licences">
        <DetailList
          items={[
            { label: 'Actives', value: data.activeLicenses },
            { label: 'En attente', value: data.pendingLicenses },
            { label: 'Suspendues', value: data.suspendedLicenses },
            { label: 'Révoquées', value: data.revokedLicenses },
            { label: 'Essais', value: data.trials },
            { label: 'Ordinateurs activés', value: data.activations },
          ]}
        />
      </Card>
    </div>
  );
}

export function ActivationsPage({ onOpenLicense }: { onOpenLicense: (id: string) => void }) {
  const { data, error } = useApi<{ id: string; deviceName: string; appVersion: string; method: string; lastSeenAt: string | null; releasedAt: string | null; license: { id: string; keyHint: string; editionName: string; customer: { name: string } } }[]>('/admin/activations');
  return (
    <Card title="Activations">
      {error && <Alert>{error}</Alert>}
      <DataTable
        rows={data ?? []}
        rowKey={(row) => row.id}
        empty="Aucune activation."
        columns={[
          { header: 'Poste', render: (row) => <>{row.deviceName}<span className="block text-xs text-muted">Version {row.appVersion}</span></> },
          { header: 'Client', render: (row) => row.license.customer.name },
          { header: 'Licence', render: (row) => <button type="button" className="font-mono underline" onClick={() => onOpenLicense(row.license.id)}>…{row.license.keyHint}</button> },
          { header: 'Dernière connexion', render: (row) => dateTime(row.lastSeenAt) },
          { header: 'État', render: (row) => (row.releasedAt ? 'Libéré' : 'En service') },
        ]}
      />
    </Card>
  );
}

const actionLabels: Record<string, string> = {
  'admin.login': 'Connexion',
  'admin.create': 'Compte créé',
  'admin.disable': 'Compte désactivé',
  'admin.enable': 'Compte réactivé',
  'customer.create': 'Client créé',
  'customer.update': 'Client modifié',
  'edition.create': 'Édition créée',
  'edition.update': 'Édition modifiée',
  'sale.create': 'Vente créée',
  'sale.confirm': 'Paiement confirmé',
  'sale.cancel': 'Vente annulée',
  'sale.refund': 'Vente remboursée',
  'license.key.reveal': 'Clé affichée',
  'license.suspend': 'Licence suspendue',
  'license.resume': 'Licence réactivée',
  'license.revoke': 'Licence révoquée',
  'license.trial': 'Essai créé',
  'activation.release': 'Poste libéré',
  'activation.offline': 'Activation hors ligne',
  'settings.update': 'Paramètres modifiés',
  'ticket.reply': 'Réponse à une demande',
  'release.publish': 'Version publiée',
};

export function AuditPage() {
  const { data, error } = useApi<{ id: string; adminEmail: string; action: string; details: unknown; createdAt: string }[]>('/admin/audit');
  return (
    <Card title="Journal d'audit">
      {error && <Alert>{error}</Alert>}
      <DataTable
        rows={data ?? []}
        rowKey={(row) => row.id}
        empty="Aucune action."
        columns={[
          { header: 'Date', render: (row) => dateTime(row.createdAt) },
          { header: 'Administrateur', render: (row) => row.adminEmail },
          { header: 'Action', render: (row) => actionLabels[row.action] ?? row.action },
          { header: 'Détail', render: (row) => { const reason = (row.details as { reason?: string }).reason; return reason ?? ''; } },
        ]}
      />
    </Card>
  );
}

function Settings({ owner }: { owner: boolean }) {
  const { data, error, setError } = useApi<Record<string, string | number>>('/admin/settings');
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (data) setForm(Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)]))); }, [data]);
  const labels: Record<string, string> = { vendorName: 'Votre nom commercial', vendorAddress: 'Adresse', vendorPhone: 'Téléphone', vendorEmail: 'Email', trialDays: "Durée d'un essai (jours)" };
  if (!form) return error ? <Alert>{error}</Alert> : null;
  return (
    <Card title="Paramètres et mentions du reçu">
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.keys(labels).map((key) => <Field key={key} label={labels[key]!}><Input disabled={!owner} value={form[key] ?? ''} onChange={(event) => { setSaved(false); setForm({ ...form, [key]: event.target.value }); }} /></Field>)}
      </div>
      {owner && (
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={() => api('/admin/settings', 'PUT', { ...form, trialDays: Number(form['trialDays']) }).then(() => setSaved(true)).catch((cause: Error) => setError(cause.message))}>Enregistrer les paramètres</Button>
          {saved && <span role="status" className="text-sm text-success">Enregistré</span>}
        </div>
      )}
    </Card>
  );
}

function Admins() {
  const { data, error, setError, reload } = useApi<{ id: string; email: string; name: string; role: string; disabledAt: string | null }[]>('/admin/admins');
  const [form, setForm] = useState({ email: '', name: '', role: 'ADMIN', password: '' });
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <Card title="Administrateurs">
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      <DataTable
        rows={data ?? []}
        rowKey={(row) => row.id}
        empty="Aucun compte."
        columns={[
          { header: 'Compte', render: (row) => <>{row.name}<span className="block text-xs text-muted">{row.email}</span></> },
          { header: 'Rôle', render: (row) => (row.role === 'OWNER' ? 'Propriétaire' : 'Administrateur') },
          { header: 'Actions', align: 'right', render: (row) => <Button variant="secondary" onClick={() => api(`/admin/admins/${row.id}/disabled`, 'POST', { disabled: !row.disabledAt }).then(reload).catch((cause: Error) => setError(cause.message))}>{row.disabledAt ? 'Réactiver' : 'Désactiver'}</Button> },
        ]}
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Nom"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
        <Field label="Email du compte"><Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
        <Field label="Rôle"><Select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="ADMIN">Administrateur</option><option value="OWNER">Propriétaire</option></Select></Field>
        <Field label="Mot de passe initial" hint="12 caractères minimum."><Input type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></Field>
      </div>
      {secret && <p role="status" className="mt-3 break-all rounded-md bg-canvas px-3.5 py-3 text-sm">Clé à ajouter dans l'application d'authentification, affichée une seule fois : <span className="font-mono">{secret}</span></p>}
      <div className="mt-3"><Button disabled={!form.name || !form.email || form.password.length < 12} onClick={() => { setError(null); api<{ totpSecret: string }>('/admin/admins', 'POST', form).then((result) => { setSecret(result.totpSecret); setForm({ email: '', name: '', role: 'ADMIN', password: '' }); return reload(); }).catch((cause: Error) => setError(cause.message)); }}>Créer le compte</Button></div>
    </Card>
  );
}

export function SettingsPage({ role }: { role: string }) {
  const owner = role === 'OWNER';
  return <div className="flex flex-col gap-4"><Settings owner={owner} />{owner && <Admins />}</div>;
}

export function TicketsPage() {
  const { data, error, setError, reload } = useApi<{ id: string; subject: string; message: string; reply: string | null; customer: { name: string } }[]>('/admin/tickets');
  const [replies, setReplies] = useState<Record<string, string>>({});
  return (
    <Card title="Demandes d'assistance">
      {error && <Alert>{error}</Alert>}
      {(data ?? []).length === 0 && <p className="py-6 text-center text-sm text-muted">Aucune demande.</p>}
      <ul className="divide-y divide-border">
        {(data ?? []).map((ticket) => (
          <li key={ticket.id} className="py-3 text-sm">
            <p className="font-medium">{ticket.subject} · {ticket.customer.name}</p>
            <p className="mb-2 whitespace-pre-wrap text-muted">{ticket.message}</p>
            {ticket.reply ? <p>Réponse : {ticket.reply}</p> : (
              <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                <Input aria-label={`Réponse à ${ticket.subject}`} value={replies[ticket.id] ?? ''} onChange={(event) => setReplies({ ...replies, [ticket.id]: event.target.value })} />
                <Button disabled={!replies[ticket.id]?.trim()} onClick={() => api(`/admin/tickets/${ticket.id}/reply`, 'POST', { reply: replies[ticket.id] }).then(reload).catch((cause: Error) => setError(cause.message))}>Répondre</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ReleasesPage({ role }: { role: string }) {
  const [form, setForm] = useState({ version: '', url: '', sha512: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  if (role !== 'OWNER') return <Card title="Publier une version"><p className="text-sm text-muted">Réservé au propriétaire de la plateforme.</p></Card>;
  return (
    <Card title="Publier une version">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Version"><Input placeholder="1.2.0" value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} /></Field>
        <Field label="Adresse HTTPS de l'installateur"><Input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} /></Field>
        <Field label="Empreinte SHA-512"><Input value={form.sha512} onChange={(event) => setForm({ ...form, sha512: event.target.value })} /></Field>
        <Field label="Notes"><Input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={() => { setError(null); setSaved(null); api('/admin/releases', 'POST', form).then(() => setSaved(`Version ${form.version} publiée`)).catch((cause: Error) => setError(cause.message)); }}>Publier</Button>
        {saved && <span role="status" className="text-sm text-success">{saved}</span>}
      </div>
    </Card>
  );
}

export function LogsPage() {
  const { data, error } = useApi<{ id: string; level: string; message: string; createdAt: string }[]>('/admin/logs');
  return (
    <Card title="Journaux techniques">
      {error && <Alert>{error}</Alert>}
      <DataTable
        rows={data ?? []}
        rowKey={(row) => row.id}
        empty="Aucun événement."
        columns={[
          { header: 'Date', render: (row) => dateTime(row.createdAt) },
          { header: 'Niveau', render: (row) => row.level },
          { header: 'Message', render: (row) => <span className="block max-w-2xl break-all font-mono text-xs">{row.message}</span> },
        ]}
      />
    </Card>
  );
}
