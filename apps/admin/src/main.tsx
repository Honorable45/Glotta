import { Alert, Button, Field, Input } from '@gestion/ui';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, setToken } from './lib';
import { CustomersPage } from './pages/customers';
import { EditionsPage } from './pages/editions';
import { LicensesPage } from './pages/licenses';
import { ActivationsPage, AuditPage, DashboardPage, LogsPage, ReleasesPage, SettingsPage, TicketsPage } from './pages/others';
import { SalesPage } from './pages/sales';
import './styles.css';

function Login({ onDone }: { onDone: (role: string) => void }) {
  const [form, setForm] = useState({ email: '', password: '', totp: '' });
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border bg-surface p-6"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          api<{ token: string; role: string }>('/admin/login', 'POST', form)
            .then((result) => { setToken(result.token); onDone(result.role); })
            .catch((cause: Error) => setError(cause.message));
        }}
      >
        <h1 className="text-lg font-semibold tracking-tight">Glotta : licences</h1>
        <Field label="Email"><Input type="email" autoComplete="username" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
        <Field label="Mot de passe"><Input type="password" autoComplete="current-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></Field>
        <Field label="Code d'authentification"><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={form.totp} onChange={(event) => setForm({ ...form, totp: event.target.value })} /></Field>
        {error && <Alert>{error}</Alert>}
        <Button type="submit">Se connecter</Button>
      </form>
    </div>
  );
}

const sections = [
  { key: 'dashboard', label: 'Tableau de bord' },
  { key: 'customers', label: 'Clients' },
  { key: 'sales', label: 'Ventes' },
  { key: 'licenses', label: 'Licences' },
  { key: 'activations', label: 'Activations' },
  { key: 'editions', label: 'Éditions et tarifs' },
  { key: 'tickets', label: 'Assistance' },
  { key: 'releases', label: 'Versions' },
  { key: 'audit', label: "Journal d'audit" },
  { key: 'logs', label: 'Journaux techniques' },
  { key: 'settings', label: 'Paramètres' },
];

function App() {
  const [role, setRole] = useState<string | null>(null);
  const [section, setSection] = useState('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [license, setLicense] = useState<string | null>(null);
  if (!role) return <Login onDone={setRole} />;
  const logout = () => void api('/admin/logout', 'POST', {}).finally(() => { setToken(null); setRole(null); });
  const openLicense = (id: string) => { setLicense(id); setSection('licenses'); };
  const current = sections.find((item) => item.key === section)!;
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <header className="flex items-center justify-between border-b border-border bg-sidebar px-4 py-2.5 md:hidden">
        <p className="text-sm font-semibold">{current.label}</p>
        <Button variant="secondary" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>Menu</Button>
      </header>
      <aside className={`${menuOpen ? 'flex' : 'hidden'} shrink-0 flex-col gap-0.5 border-b border-border bg-sidebar p-3 md:flex md:w-52 md:border-b-0 md:border-r`}>
        <p className="mb-3 hidden px-2 text-sm font-semibold md:block">Glotta : licences</p>
        <nav aria-label="Sections" className="flex flex-col gap-0.5">
          {sections.map((item) => (
            <button key={item.key} type="button" className={`rounded-md px-2.5 py-2 text-left text-sm ${item.key === section ? 'bg-selected font-medium text-selected-text' : 'text-muted hover:bg-canvas'}`} onClick={() => { setSection(item.key); setMenuOpen(false); }}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="mt-3 md:mt-auto"><Button variant="secondary" className="w-full" onClick={logout}>Se déconnecter</Button></div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-7">
        <div className="mx-auto max-w-5xl">
          {section === 'dashboard' && <DashboardPage />}
          {section === 'customers' && <CustomersPage onOpenLicense={openLicense} />}
          {section === 'sales' && <SalesPage role={role} onOpenLicense={openLicense} />}
          {section === 'licenses' && <LicensesPage focus={license} onFocus={setLicense} />}
          {section === 'activations' && <ActivationsPage onOpenLicense={openLicense} />}
          {section === 'editions' && <EditionsPage role={role} />}
          {section === 'tickets' && <TicketsPage />}
          {section === 'releases' && <ReleasesPage role={role} />}
          {section === 'audit' && <AuditPage />}
          {section === 'logs' && <LogsPage />}
          {section === 'settings' && <SettingsPage role={role} />}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
