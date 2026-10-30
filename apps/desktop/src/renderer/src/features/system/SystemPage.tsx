import type { SystemStatus } from '@gestion/contracts';
import { Badge, Button, Card, DetailList } from '@gestion/ui';
import { useCallback, useEffect, useState } from 'react';
import { call } from '../../lib/api';

const check = (ok: boolean, good: string, bad: string) => <Badge tone={ok ? 'success' : 'danger'}>{ok ? good : bad}</Badge>;

export function SystemPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [update, setUpdate] = useState<string | null>(null);
  const checkUpdate = () => {
    setUpdate(null);
    call('system.checkUpdate', undefined)
      .then((result) => setUpdate(result.available ? `Version ${result.version} ouverte dans votre navigateur.` : 'Votre logiciel est à jour.'))
      .catch((cause: Error) => setUpdate(cause.message));
  };

  const load = useCallback(() => {
    setError(null);
    call('system.getStatus', undefined).then(setStatus).catch((cause: Error) => setError(cause.message));
  }, []);
  useEffect(load, [load]);

  if (error) {
    return (
      <div role="alert" className="flex items-center justify-between rounded-lg border border-border bg-danger-bg px-5 py-4 text-sm text-danger">
        {error}
        <Button variant="secondary" onClick={load}>Réessayer</Button>
      </div>
    );
  }
  if (!status) return <p className="text-sm text-muted">Vérification en cours</p>;

  return (
    <div className="flex flex-col gap-4">
      <Card title="Base de données">
        <DetailList
          items={[
            { label: 'Chiffrement', value: check(status.databaseEncrypted, 'Chiffrée', 'Non chiffrée') },
            { label: 'Intégrité', value: check(status.integrityOk, 'Intègre', 'Endommagée') },
            { label: 'Migrations appliquées', value: status.appliedMigrations },
          ]}
        />
      </Card>
      <Card title="Traçabilité">
        <DetailList
          items={[
            { label: "Journal d'activité", value: check(status.auditChainOk, 'Non altéré', 'Altéré') },
            { label: 'Opérations journalisées', value: status.auditEntries },
            { label: 'Événements à synchroniser', value: status.pendingSyncEvents },
          ]}
        />
      </Card>
      <Card title="Application">
        <DetailList
          items={[
            { label: 'Version', value: status.appVersion },
            { label: 'Identifiant du poste', value: <span className="font-mono text-xs">{status.deviceId}</span> },
          ]}
        />
        <div className="mt-4 flex items-center gap-3">
          <Button variant="secondary" onClick={checkUpdate}>Rechercher une mise à jour</Button>
          {update && <span role="status" className="text-sm text-muted">{update}</span>}
        </div>
      </Card>
    </div>
  );
}
