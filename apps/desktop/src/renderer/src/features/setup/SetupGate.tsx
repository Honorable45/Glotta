import { Alert, Button } from '@gestion/ui';
import type { ReactNode } from 'react';
import { call } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useLoad } from '../../lib/useLoad';
import { SetupWizard } from './SetupWizard';

export function SetupGate({ children }: { children: ReactNode }) {
  const { data, error, reload } = useLoad(() => call('setup.getState', undefined));
  const { refresh } = useSession();
  if (error) {
    return (
      <div className="mx-auto mt-16 flex max-w-md flex-col gap-3">
        <Alert>{error}</Alert>
        <Button variant="secondary" onClick={() => void reload()}>Réessayer</Button>
      </div>
    );
  }
  if (!data) return null;
  return data.completed ? children : <SetupWizard onDone={() => void refresh().then(reload)} />;
}
