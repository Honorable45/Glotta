import type { PaymentMethodItem } from '@gestion/contracts';
import { Alert, Badge, Button, Card, DataTable, Field, Input } from '@gestion/ui';
import { useState } from 'react';
import { call } from '../../lib/api';
import { useLoad } from '../../lib/useLoad';

export function PaymentMethodsPage() {
  const { data, error, reload, setError } = useLoad(() => call('paymentMethods.list', undefined));
  const [name, setName] = useState('');
  const run = (action: Promise<unknown>, after?: () => void) => {
    setError(null);
    action.then(() => { after?.(); return reload(); }).catch((cause: Error) => setError(cause.message));
  };
  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      <Card title="Nouveau mode de paiement">
        <form
          className="grid grid-cols-[1fr_auto] items-end gap-3"
          onSubmit={(event) => { event.preventDefault(); run(call('paymentMethods.save', { id: null, name: name.trim(), isActive: true, isCash: false }), () => setName('')); }}
        >
          <Field label="Nom"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <Button type="submit" disabled={!name.trim()}>Ajouter</Button>
        </form>
      </Card>
      <Card title="Modes de paiement">
        <DataTable<PaymentMethodItem>
          rows={data ?? []}
          rowKey={(row) => row.id}
          empty="Aucun mode de paiement."
          columns={[
            { header: 'Nom', render: (row) => row.name },
            { header: 'État', render: (row) => <Badge tone={row.isActive ? 'success' : 'danger'}>{row.isActive ? 'Actif' : 'Désactivé'}</Badge> },
            { header: 'Tiroir-caisse', render: (row) => (row.isCash ? 'Oui' : 'Non') },
            {
              header: 'Actions',
              align: 'right',
              render: (row) => (
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => run(call('paymentMethods.save', { ...row, isCash: !row.isCash }))}>
                    {row.isCash ? 'Hors tiroir' : 'En tiroir'}
                  </Button>
                  <Button variant="secondary" onClick={() => run(call('paymentMethods.save', { ...row, isActive: !row.isActive }))}>
                    {row.isActive ? 'Désactiver' : 'Activer'}
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
