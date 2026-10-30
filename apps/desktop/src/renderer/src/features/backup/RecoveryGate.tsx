import { Alert, Button, Field, Input } from '@gestion/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { call } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useLoad } from '../../lib/useLoad';

/** Premier lancement : le code de récupération est montré, puis recopié, avant toute utilisation. */
export function RecoveryGate({ children }: { children: ReactNode }) {
  const { can } = useSession();
  const { data, error, reload } = useLoad(() => call('backup.codeStatus', undefined));
  const [code, setCode] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const needed = data?.confirmed === false && can('manage_settings');

  useEffect(() => {
    if (needed && !code) call('backup.revealCode', undefined).then((result) => setCode(result.code)).catch((cause: Error) => setFailure(cause.message));
  }, [needed, code]);

  if (error) return <div className="mx-auto mt-16 max-w-md"><Alert>{error}</Alert></div>;
  if (!data) return null;
  if (!needed) return children;
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <form
        className="flex w-full max-w-lg flex-col gap-4 rounded-lg border border-border bg-surface p-6"
        onSubmit={(event) => {
          event.preventDefault();
          setFailure(null);
          call('backup.confirmCode', { code: typed }).then(() => reload()).catch((cause: Error) => setFailure(cause.message));
        }}
      >
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Notez votre code de récupération</h1>
          <p className="mt-1 text-sm text-muted">C'est le seul moyen de restaurer vos sauvegardes si cet ordinateur est perdu ou remplacé. Personne d'autre ne le connaît, et il ne peut pas être retrouvé. Écrivez-le sur papier et gardez-le en lieu sûr.</p>
        </div>
        {code && <p data-testid="first-recovery-code" className="rounded-md bg-canvas px-3.5 py-3 text-center font-mono text-base tracking-wide">{code}</p>}
        <Field label="Recopiez le code pour confirmer"><Input autoComplete="off" value={typed} onChange={(event) => setTyped(event.target.value)} /></Field>
        {failure && <Alert>{failure}</Alert>}
        <Button type="submit" disabled={typed.trim().length < 10}>J'ai noté mon code</Button>
      </form>
    </div>
  );
}
