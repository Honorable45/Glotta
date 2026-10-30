import { Alert, Badge, Button, Card, DataTable, DetailList, Field, Input, Select } from '@gestion/ui';
import { StrictMode, useCallback, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

// Le jeton reste en mémoire : fermer l'onglet ferme la session.
let token: string | null = null;

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(data.error ?? 'Erreur du serveur.');
  return data;
}

function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    return api<T>(path).then(setData).catch((cause: Error) => setError(cause.message));
  }, [path]);
  useEffect(() => void reload(), [reload]);
  return { data, error, setError, reload };
}

const fcfa = (value: number) => `${new Intl.NumberFormat('fr-FR').format(value)} FCFA`;
const date = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');

function Login({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ email: '', password: '', totp: '' });
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <form
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border bg-surface p-6"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          api<{ token: string }>('/admin/login', 'POST', form)
            .then((result) => { token = result.token; onDone(); })
            .catch((cause: Error) => setError(cause.message));
        }}
      >
        <h1 className="text-lg font-semibold tracking-tight">Administration de la plateforme</h1>
        <Field label="Email"><Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
        <Field label="Mot de passe"><Input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></Field>
        <Field label="Code d'authentification"><Input inputMode="numeric" maxLength={6} value={form.totp} onChange={(event) => setForm({ ...form, totp: event.target.value })} /></Field>
        {error && <Alert>{error}</Alert>}
        <Button type="submit">Se connecter</Button>
      </form>
    </div>
  );
}

interface Tenant {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  subscription: { planCode: string; expiresAt: string; isTrial: boolean; suspendedAt: string | null } | null;
  _count: { devices: number };
}

function Tenants() {
  const { data, error, setError, reload } = useApi<Tenant[]>('/admin/tenants');
  const [acting, setActing] = useState<Tenant | null>(null);
  const [form, setForm] = useState({ action: 'extend', reason: '', days: '30', planCode: 'PRO' });
  const submit = () => {
    if (!acting) return;
    const body = { action: form.action, reason: form.reason, ...(form.action === 'extend' ? { days: Number(form.days) } : {}), ...(form.action === 'setPlan' ? { planCode: form.planCode } : {}) };
    api(`/admin/tenants/${acting.id}/subscription`, 'POST', body)
      .then(() => { setActing(null); setForm({ ...form, reason: '' }); return reload(); })
      .catch((cause: Error) => setError(cause.message));
  };
  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      {acting && (
        <Card title={`Abonnement de ${acting.name}`}>
          <div className="grid grid-cols-4 items-end gap-3">
            <Field label="Action">
              <Select value={form.action} onChange={(event) => setForm({ ...form, action: event.target.value })}>
                <option value="extend">Prolonger</option>
                <option value="suspend">Suspendre</option>
                <option value="resume">Réactiver</option>
                <option value="setPlan">Changer de formule</option>
              </Select>
            </Field>
            {form.action === 'extend' && <Field label="Jours"><Input value={form.days} onChange={(event) => setForm({ ...form, days: event.target.value })} /></Field>}
            {form.action === 'setPlan' && (
              <Field label="Formule">
                <Select value={form.planCode} onChange={(event) => setForm({ ...form, planCode: event.target.value })}>
                  {['STARTER', 'PRO', 'BUSINESS'].map((code) => <option key={code}>{code}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Motif (journalisé)"><Input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></Field>
            <div className="flex gap-2">
              <Button disabled={form.reason.trim().length < 3} onClick={submit}>Appliquer</Button>
              <Button variant="secondary" onClick={() => setActing(null)}>Fermer</Button>
            </div>
          </div>
        </Card>
      )}
      <Card title="Entreprises inscrites">
        <DataTable<Tenant>
          rows={data ?? []}
          rowKey={(row) => row.id}
          empty="Aucune entreprise."
          columns={[
            { header: 'Entreprise', render: (row) => <>{row.name}<span className="block text-xs text-muted">{row.email}</span></> },
            { header: 'Formule', render: (row) => `${row.subscription?.planCode ?? ''}${row.subscription?.isTrial ? ' (essai)' : ''}` },
            { header: 'Expiration', render: (row) => (row.subscription ? date(row.subscription.expiresAt) : '') },
            { header: 'Postes', align: 'right', render: (row) => row._count.devices },
            { header: 'État', render: (row) => <Badge tone={row.subscription?.suspendedAt ? 'danger' : 'success'}>{row.subscription?.suspendedAt ? 'Suspendu' : 'Actif'}</Badge> },
            { header: 'Actions', align: 'right', render: (row) => <Button variant="secondary" onClick={() => setActing(row)}>Gérer</Button> },
          ]}
        />
      </Card>
    </div>
  );
}

interface Plan { code: string; name: string; price: number; maxUsers: number; maxStores: number; isActive: boolean }

function PlanRow({ plan, onSaved, onError }: { plan: Plan; onSaved: () => void; onError: (message: string) => void }) {
  const [form, setForm] = useState({ price: String(plan.price), maxUsers: String(plan.maxUsers), maxStores: String(plan.maxStores) });
  return (
    <div className="grid grid-cols-[8rem_1fr_1fr_1fr_auto] items-end gap-3">
      <p className="pb-2 text-sm font-medium">{plan.name}</p>
      <Field label="Prix mensuel"><Input aria-label={`Prix ${plan.name}`} value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></Field>
      <Field label="Utilisateurs"><Input value={form.maxUsers} onChange={(event) => setForm({ ...form, maxUsers: event.target.value })} /></Field>
      <Field label="Boutiques"><Input value={form.maxStores} onChange={(event) => setForm({ ...form, maxStores: event.target.value })} /></Field>
      <Button
        variant="secondary"
        onClick={() => api(`/admin/plans/${plan.code}`, 'PUT', { name: plan.name, isActive: plan.isActive, price: Number(form.price), maxUsers: Number(form.maxUsers), maxStores: Number(form.maxStores) }).then(onSaved).catch((cause: Error) => onError(cause.message))}
      >
        Enregistrer
      </Button>
    </div>
  );
}

function Plans() {
  const plans = useApi<Plan[]>('/admin/plans');
  const settings = useApi<{ trialDays: number; graceDays: number; offlineDays: number }>('/admin/settings');
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (settings.data) setForm(Object.fromEntries(Object.entries(settings.data).map(([key, value]) => [key, String(value)]))); }, [settings.data]);
  const labels: Record<string, string> = { trialDays: "Jours d'essai", graceDays: 'Jours de grâce', offlineDays: 'Jours hors ligne maximum' };
  return (
    <div className="flex flex-col gap-4">
      {(plans.error ?? settings.error) && <Alert>{plans.error ?? settings.error}</Alert>}
      <Card title="Formules">
        <div className="flex flex-col gap-3">
          {(plans.data ?? []).map((plan) => <PlanRow key={plan.code} plan={plan} onSaved={() => void plans.reload()} onError={plans.setError} />)}
        </div>
      </Card>
      {form && (
        <Card title="Durées">
          <div className="grid grid-cols-3 gap-3">
            {Object.keys(labels).map((key) => <Field key={key} label={labels[key]!}><Input value={form[key] ?? ''} onChange={(event) => { setSaved(false); setForm({ ...form, [key]: event.target.value }); }} /></Field>)}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={() => api('/admin/settings', 'PUT', Object.fromEntries(Object.entries(form).map(([key, value]) => [key, Number(value)]))).then(() => setSaved(true)).catch((cause: Error) => settings.setError(cause.message))}>Enregistrer</Button>
            {saved && <span role="status" className="text-sm text-success">Enregistré</span>}
          </div>
        </Card>
      )}
    </div>
  );
}

function Stats() {
  const { data, error } = useApi<{ tenants: number; active: number; trials: number; suspended: number; revenue: number }>('/admin/stats');
  if (!data) return error ? <Alert>{error}</Alert> : null;
  return (
    <Card title="Statistiques générales">
      <DetailList
        items={[
          { label: 'Entreprises inscrites', value: data.tenants },
          { label: 'Abonnements payants actifs', value: data.active },
          { label: "Périodes d'essai en cours", value: data.trials },
          { label: 'Abonnements suspendus', value: data.suspended },
          { label: 'Paiements confirmés', value: fcfa(data.revenue) },
        ]}
      />
    </Card>
  );
}

function Payments() {
  const { data, error } = useApi<{ id: string; amount: number; status: string; provider: string; createdAt: string; planCode: string; tenant: { name: string } }[]>('/admin/payments');
  return (
    <Card title="Paiements">
      {error && <Alert>{error}</Alert>}
      <DataTable
        rows={data ?? []}
        rowKey={(row) => row.id}
        empty="Aucun paiement."
        columns={[
          { header: 'Date', render: (row) => date(row.createdAt) },
          { header: 'Entreprise', render: (row) => row.tenant.name },
          { header: 'Formule', render: (row) => row.planCode },
          { header: 'Prestataire', render: (row) => row.provider },
          { header: 'État', render: (row) => row.status },
          { header: 'Montant', align: 'right', render: (row) => fcfa(row.amount) },
        ]}
      />
    </Card>
  );
}

function Tickets() {
  const { data, error, setError, reload } = useApi<{ id: string; subject: string; message: string; status: string; reply: string | null; tenant: { name: string } }[]>('/admin/tickets');
  const [replies, setReplies] = useState<Record<string, string>>({});
  return (
    <Card title="Demandes d'assistance">
      {error && <Alert>{error}</Alert>}
      {(data ?? []).length === 0 && <p className="py-6 text-center text-sm text-muted">Aucune demande.</p>}
      <ul className="divide-y divide-border">
        {(data ?? []).map((ticket) => (
          <li key={ticket.id} className="py-3 text-sm">
            <p className="font-medium">{ticket.subject} · {ticket.tenant.name}</p>
            <p className="mb-2 whitespace-pre-wrap text-muted">{ticket.message}</p>
            {ticket.reply ? <p>Réponse : {ticket.reply}</p> : (
              <div className="flex gap-2">
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

function Releases() {
  const [form, setForm] = useState({ version: '', url: '', sha512: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <Card title="Publier une mise à jour">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Version"><Input placeholder="1.2.0" value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} /></Field>
        <Field label="Adresse HTTPS de l'installateur"><Input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} /></Field>
        <Field label="Empreinte SHA-512"><Input value={form.sha512} onChange={(event) => setForm({ ...form, sha512: event.target.value })} /></Field>
        <Field label="Notes"><Input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={() => { setError(null); setSaved(null); api('/admin/releases', 'POST', form).then(() => setSaved(`Version ${form.version} publiée`)).catch((cause: Error) => setError(cause.message)); }}>Publier</Button>
        {saved && <span role="status" className="text-sm text-success">{saved}</span>}
      </div>
    </Card>
  );
}

function Logs() {
  const { data, error } = useApi<{ id: string; level: string; message: string; createdAt: string }[]>('/admin/logs');
  return (
    <Card title="Journaux techniques">
      {error && <Alert>{error}</Alert>}
      <DataTable
        rows={data ?? []}
        rowKey={(row) => row.id}
        empty="Aucun événement."
        columns={[
          { header: 'Date', render: (row) => new Date(row.createdAt).toLocaleString('fr-FR') },
          { header: 'Niveau', render: (row) => row.level },
          { header: 'Message', render: (row) => <span className="block max-w-2xl truncate font-mono text-xs">{row.message}</span> },
        ]}
      />
    </Card>
  );
}

const sections: { key: string; label: string; element: ReactNode }[] = [
  { key: 'stats', label: 'Statistiques', element: <Stats /> },
  { key: 'tenants', label: 'Entreprises', element: <Tenants /> },
  { key: 'plans', label: 'Formules', element: <Plans /> },
  { key: 'payments', label: 'Paiements', element: <Payments /> },
  { key: 'tickets', label: 'Assistance', element: <Tickets /> },
  { key: 'releases', label: 'Mises à jour', element: <Releases /> },
  { key: 'logs', label: 'Journaux', element: <Logs /> },
];

function App() {
  const [signedIn, setSignedIn] = useState(false);
  const [section, setSection] = useState('stats');
  if (!signedIn) return <Login onDone={() => setSignedIn(true)} />;
  const logout = () => void api('/admin/logout', 'POST', {}).finally(() => { token = null; setSignedIn(false); });
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-border bg-sidebar p-3">
        <p className="mb-3 px-2 text-sm font-semibold">Administration</p>
        {sections.map((item) => (
          <button key={item.key} type="button" className={`rounded-md px-2.5 py-2 text-left text-sm ${item.key === section ? 'bg-selected font-medium text-selected-text' : 'text-muted hover:bg-canvas'}`} onClick={() => setSection(item.key)}>
            {item.label}
          </button>
        ))}
        <div className="mt-auto"><Button variant="secondary" className="w-full" onClick={logout}>Se déconnecter</Button></div>
      </aside>
      <main className="min-w-0 flex-1 p-7"><div className="mx-auto max-w-5xl">{sections.find((item) => item.key === section)?.element}</div></main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
