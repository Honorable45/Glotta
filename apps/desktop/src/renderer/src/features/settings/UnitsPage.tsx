import type { Unit, UnitInput } from '@gestion/contracts';
import { Alert, Button, Card, Checkbox, DataTable, Field, Input } from '@gestion/ui';
import { useState } from 'react';
import { call } from '../../lib/api';
import { useLoad } from '../../lib/useLoad';

const empty: UnitInput = { id: null, name: '', symbol: '', allowsDecimal: false };

export function UnitsPage() {
  const { data, error, reload, setError } = useLoad(() => call('units.list', undefined));
  const [form, setForm] = useState(empty);
  const run = (action: Promise<unknown>) => {
    setError(null);
    action.then(() => { setForm(empty); return reload(); }).catch((cause: Error) => setError(cause.message));
  };
  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      <Card title={form.id ? "Modifier l'unité" : 'Nouvelle unité'}>
        <form className="grid grid-cols-[1fr_8rem_auto_auto] items-end gap-3" onSubmit={(event) => { event.preventDefault(); run(call('units.save', form)); }}>
          <Field label="Nom"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Symbole"><Input value={form.symbol} maxLength={10} onChange={(event) => setForm({ ...form, symbol: event.target.value })} /></Field>
          <div className="pb-2"><Checkbox label="Fractions" checked={form.allowsDecimal} onChange={(event) => setForm({ ...form, allowsDecimal: event.target.checked })} /></div>
          <Button type="submit" disabled={!form.name.trim() || !form.symbol.trim()}>Enregistrer</Button>
        </form>
      </Card>
      <Card title="Unités">
        <DataTable<Unit>
          rows={data ?? []}
          rowKey={(row) => row.id}
          empty="Aucune unité."
          columns={[
            { header: 'Nom', render: (row) => row.name },
            { header: 'Symbole', render: (row) => row.symbol },
            { header: 'Fractions', render: (row) => (row.allowsDecimal ? 'Oui' : 'Non') },
            {
              header: 'Actions',
              align: 'right',
              render: (row) => (
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setForm(row)}>Modifier</Button>
                  <Button variant="secondary" onClick={() => run(call('units.archive', { id: row.id }))}>Archiver</Button>
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
