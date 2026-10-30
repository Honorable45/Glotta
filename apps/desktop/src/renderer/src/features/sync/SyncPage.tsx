import { Alert, Button, Card, DataTable, DetailList } from '@gestion/ui';
import { call } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';

export function SyncPage() {
  const { data, error, reload, setError } = useLoad(() => call('sync.status', undefined));
  const run = (action: Promise<unknown>) => {
    setError(null);
    action.then(reload).catch((cause: Error) => setError(cause.message));
  };
  if (!data) return error ? <Alert>{error}</Alert> : null;
  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      {data.lastError && <Alert>{data.lastError} Vos données restent en sécurité sur ce poste et partiront à la reconnexion.</Alert>}
      <Card title="Synchronisation entre postes">
        {data.enabled ? (
          <>
            <DetailList
              items={[
                { label: 'Dernière synchronisation', value: data.lastSyncAt ? formatDateTime(data.lastSyncAt) : 'Jamais' },
                { label: 'Changements en attente', value: <span data-testid="pending">{data.pending}</span> },
              ]}
            />
            <div className="mt-4"><Button onClick={() => run(call('sync.run', undefined))}>Synchroniser maintenant</Button></div>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">Reliez plusieurs ordinateurs à la même entreprise. Vos données sont chiffrées avant de quitter ce poste : le serveur ne peut pas les lire. Conservez votre code de récupération, disponible dans l'écran Sauvegardes.</p>
            <Button onClick={() => run(call('sync.enable', undefined))}>Activer la synchronisation</Button>
          </>
        )}
      </Card>
      <Card title="Points à vérifier">
        <DataTable
          rows={data.conflicts}
          rowKey={(row) => row.id}
          empty="Aucun conflit."
          columns={[
            { header: 'Date', render: (row) => formatDateTime(row.occurredAt) },
            { header: 'Description', render: (row) => row.message },
            { header: 'Action', align: 'right', render: (row) => <Button variant="secondary" onClick={() => run(call('sync.resolveConflict', { id: row.id }))}>Marquer comme traité</Button> },
          ]}
        />
      </Card>
    </div>
  );
}
