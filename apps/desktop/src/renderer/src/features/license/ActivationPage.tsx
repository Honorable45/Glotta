import { Alert, Button, Field, Input, SegmentedControl } from '@gestion/ui';
import { useState } from 'react';
import { call } from '../../lib/api';
import { useLicense } from '../../lib/license';
import { useSession } from '../../lib/session';

export function ActivationPage() {
  const { license, setLicense } = useLicense();
  const { can } = useSession();
  const [mode, setMode] = useState<'signup' | 'activate'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  let body;
  if (!license?.configured) {
    body = <Alert>Le serveur des abonnements n'est pas configuré dans cette version. Contactez l'assistance.</Alert>;
  } else if (!can('manage_settings')) {
    body = <p className="text-sm text-muted">Ce poste n'est pas encore activé. Demandez au propriétaire de se connecter pour l'activer.</p>;
  } else {
    body = (
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          call(mode === 'signup' ? 'license.signup' : 'license.activate', { email: email.trim(), password })
            .then(setLicense)
            .catch((cause: Error) => setError(cause.message))
            .finally(() => setBusy(false));
        }}
      >
        <SegmentedControl
          label="Type de compte"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'signup', label: 'Démarrer un essai' },
            { value: 'activate', label: "J'ai déjà un compte" },
          ]}
        />
        <Field label="Email"><Input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
        <Field label="Mot de passe du compte" hint="8 caractères minimum."><Input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" disabled={busy || !email || !password}>{mode === 'signup' ? "Démarrer l'essai gratuit" : 'Activer ce poste'}</Button>
      </form>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6">
        <h1 className="mb-1 text-lg font-semibold tracking-tight">Activation du logiciel</h1>
        <p className="mb-5 text-sm text-muted">Une connexion à Internet est nécessaire pour cette étape. Ensuite, le logiciel fonctionne aussi hors ligne.</p>
        {body}
      </div>
    </div>
  );
}
