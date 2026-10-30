import { Alert, Button, Field, Input } from '@gestion/ui';
import { useState } from 'react';
import { call } from '../../lib/api';

export function JoinForm({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ licenseKey: '', code: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <form
        className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-border bg-surface p-6"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          call('sync.join', { licenseKey: form.licenseKey.trim(), code: form.code })
            .then(onDone)
            .catch((cause: Error) => setError(cause.message))
            .finally(() => setBusy(false));
        }}
      >
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Rejoindre une entreprise existante</h1>
          <p className="mt-1 text-sm text-muted">La synchronisation doit être activée sur le poste principal. Le code de récupération se trouve dans son écran Sauvegardes.</p>
        </div>
        <Field label="Clé de licence"><Input autoComplete="off" value={form.licenseKey} onChange={(event) => setForm({ ...form, licenseKey: event.target.value })} /></Field>
        <Field label="Code de récupération"><Input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></Field>
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-between">
          <Button variant="secondary" onClick={onBack}>Retour</Button>
          <Button type="submit" disabled={busy || !form.licenseKey || !form.code}>{busy ? 'Récupération en cours' : 'Rejoindre'}</Button>
        </div>
      </form>
    </div>
  );
}
