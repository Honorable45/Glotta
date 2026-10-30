import { Alert, Button, Field, Input } from '@gestion/ui';
import { useState } from 'react';
import { call } from '../../lib/api';
import { useSession } from '../../lib/session';

export function LoginPage() {
  const { refresh } = useSession();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <form
        className="w-full max-w-sm rounded-lg border border-border bg-surface p-6"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          call('auth.login', { login, password })
            .then(refresh)
            .catch((cause: Error) => {
              setPassword('');
              setError(cause.message);
            })
            .finally(() => setBusy(false));
        }}
      >
        <h1 className="mb-5 text-lg font-semibold tracking-tight">Connexion</h1>
        <div className="flex flex-col gap-4">
          <Field label="Identifiant"><Input autoFocus autoComplete="username" value={login} onChange={(event) => setLogin(event.target.value)} /></Field>
          <Field label="Mot de passe"><Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" disabled={busy || !login || !password}>Se connecter</Button>
        </div>
      </form>
    </div>
  );
}
