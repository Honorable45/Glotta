import { Alert, Button, Card, Field, Input } from '@gestion/ui';
import { useState } from 'react';
import { call } from '../../lib/api';

export function AccountPage() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  return (
    <Card title="Modifier mon mot de passe">
      <div className="flex max-w-sm flex-col gap-4">
        <Field label="Mot de passe actuel"><Input type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} /></Field>
        <Field label="Nouveau mot de passe" hint="8 caractères minimum."><Input type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} /></Field>
        {error && <Alert>{error}</Alert>}
        <div className="flex items-center gap-3">
          <Button
            disabled={!current || !next}
            onClick={() => {
              setError(null);
              setSaved(false);
              call('auth.changePassword', { current, next })
                .then(() => { setSaved(true); setCurrent(''); setNext(''); })
                .catch((cause: Error) => setError(cause.message));
            }}
          >
            Enregistrer
          </Button>
          {saved && <span role="status" className="text-sm text-success">Enregistré</span>}
        </div>
      </div>
    </Card>
  );
}
