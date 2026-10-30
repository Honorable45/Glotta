import type { StoreItem } from '@gestion/contracts';
import { Alert, Badge, Button, Card, DataTable, Field, Input } from '@gestion/ui';
import { useState } from 'react';
import { call } from '../../lib/api';
import { useLoad } from '../../lib/useLoad';

export function StoresPage() {
  const { data, error, reload, setError } = useLoad(() => call('stores.list', undefined));
  const [name, setName] = useState('');
  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      <Card title="Nouvelle boutique">
        <form
          className="grid grid-cols-[1fr_auto] items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            call('stores.save', { id: null, name: name.trim() }).then(() => { setName(''); return reload(); }).catch((cause: Error) => setError(cause.message));
          }}
        >
          <Field label="Nom de la boutique"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <Button type="submit" disabled={!name.trim()}>Ajouter</Button>
        </form>
      </Card>
      <Card title="Boutiques">
        <DataTable<StoreItem>
          rows={data ?? []}
          rowKey={(row) => row.id}
          empty="Aucune boutique."
          columns={[
            { header: 'Nom', render: (row) => row.name },
            { header: 'Ce poste', render: (row) => row.isCurrent && <Badge tone="success">Boutique de ce poste</Badge> },
            {
              header: 'Actions',
              align: 'right',
              render: (row) => !row.isCurrent && (
                <Button variant="secondary" onClick={() => { setError(null); call('stores.setCurrent', { id: row.id }).then(reload).catch((cause: Error) => setError(cause.message)); }}>Utiliser sur ce poste</Button>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
