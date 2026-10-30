import { Alert, Button, Card, DataTable, DetailList, Field, Input } from '@gestion/ui';
import { useState } from 'react';
import { call } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';

export function BackupPage() {
  const { data, error, reload, setError } = useLoad(() => call('backup.status', undefined));
  const [code, setCode] = useState<string | null>(null);
  const [restoreCode, setRestoreCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const run = (action: Promise<unknown>, success?: string) => {
    setError(null);
    setMessage(null);
    action.then(() => { if (success) setMessage(success); return reload(); }).catch((cause: Error) => setError(cause.message));
  };
  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      {message && <p role="status" className="rounded-md bg-success-bg px-3.5 py-2.5 text-sm text-success">{message}</p>}
      <Card title="Sauvegardes">
        <DetailList
          items={[
            { label: 'Dernière sauvegarde', value: data?.lastBackupAt ? formatDateTime(data.lastBackupAt) : 'Aucune' },
            { label: 'Dossier', value: <span className="break-all font-normal">{data?.folder ?? ''}</span> },
          ]}
        />
        <p className="mt-3 text-sm text-muted">Une sauvegarde chiffrée est créée chaque jour. Choisissez un dossier sur une clé USB ou un disque externe pour vous protéger de la perte de l'ordinateur.</p>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => run(call('backup.create', undefined), 'Sauvegarde créée.')}>Sauvegarder maintenant</Button>
          <Button variant="secondary" onClick={() => run(call('backup.chooseFolder', undefined))}>Choisir le dossier</Button>
        </div>
      </Card>
      <Card title="Code de récupération">
        <p className="mb-3 text-sm text-muted">Ce code est le seul moyen de restaurer une sauvegarde sur un autre ordinateur. Personne d'autre ne le connaît : notez-le sur papier et gardez-le en lieu sûr.</p>
        {code ? <p data-testid="recovery-code" className="rounded-md bg-canvas px-3.5 py-3 font-mono text-base tracking-wide">{code}</p> : (
          <Button variant="secondary" onClick={() => { setError(null); call('backup.revealCode', undefined).then((result) => setCode(result.code)).catch((cause: Error) => setError(cause.message)); }}>Afficher le code</Button>
        )}
      </Card>
      <Card title="Restaurer une sauvegarde">
        <p className="mb-3 text-sm text-muted">Les données actuelles sont remplacées par celles de la sauvegarde. Elles sont conservées à part, et le logiciel redémarre ensuite.</p>
        <div className="flex items-end gap-3">
          <div className="flex-1"><Field label="Code de récupération"><Input value={restoreCode} onChange={(event) => setRestoreCode(event.target.value)} /></Field></div>
          <Button variant="secondary" disabled={restoreCode.trim().length < 10} onClick={() => run(call('backup.restore', { code: restoreCode }))}>Choisir le fichier et restaurer</Button>
        </div>
      </Card>
      <Card title="Sauvegardes disponibles">
        <DataTable
          rows={data?.files ?? []}
          rowKey={(file) => file.name}
          empty="Aucune sauvegarde dans ce dossier."
          columns={[
            { header: 'Fichier', render: (file) => <span className="font-mono text-xs">{file.name}</span> },
            { header: 'Date', render: (file) => formatDateTime(file.createdAt) },
            { header: 'Taille', align: 'right', render: (file) => `${Math.ceil(file.size / 1024)} Ko` },
          ]}
        />
      </Card>
    </div>
  );
}
