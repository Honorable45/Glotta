import type { ReminderItem } from '@gestion/contracts';
import { Alert, Badge, Button, Card, Checkbox, DataTable } from '@gestion/ui';
import { useEffect, useState } from 'react';
import { call } from '../../lib/api';
import { useCurrency } from '../../lib/useCurrency';

const stateLabels: Record<ReminderItem['state'], string> = { PLANNED: 'À faire', OPENED: 'WhatsApp ouvert', DONE: 'Effectué' };

export function RemindersPage() {
  const { money } = useCurrency();
  const [includeDone, setIncludeDone] = useState(false);
  const [rows, setRows] = useState<ReminderItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = () => call('reminders.list', { includeDone }).then(setRows).catch((cause: Error) => setError(cause.message));
  useEffect(() => void load(), [includeDone]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = (action: Promise<unknown>) => { setError(null); action.then(load).catch((cause: Error) => setError(cause.message)); };
  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      <p className="text-sm text-muted">Le bouton ouvre WhatsApp avec le message prêt. Envoyez-le, puis marquez le rappel comme effectué.</p>
      <Card title="Rappels de paiement">
        <div className="mb-3"><Checkbox label="Afficher les rappels effectués" checked={includeDone} onChange={(event) => setIncludeDone(event.target.checked)} /></div>
        <DataTable<ReminderItem>
          rows={rows}
          rowKey={(row) => row.id}
          empty="Aucun rappel. Programmez-en un depuis l'écran Dettes."
          columns={[
            { header: 'Date', render: (row) => (row.overdue ? <Badge tone="danger">{row.dueDate}, en retard</Badge> : row.dueDate) },
            { header: 'Client', render: (row) => <>{row.customerName}{row.note && <span className="block text-xs text-muted">{row.note}</span>}</> },
            { header: 'Restant dû', align: 'right', render: (row) => money(row.remaining) },
            { header: 'État', render: (row) => stateLabels[row.state] },
            {
              header: 'Actions',
              align: 'right',
              render: (row) => row.state !== 'DONE' && (
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" disabled={!row.hasWhatsapp} onClick={() => run(call('reminders.whatsapp', { id: row.id }))}>Envoyer un rappel WhatsApp</Button>
                  <Button variant="secondary" onClick={() => run(call('reminders.markDone', { id: row.id }))}>Marquer comme effectué</Button>
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
