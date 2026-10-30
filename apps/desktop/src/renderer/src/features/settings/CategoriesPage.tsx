import type { Category } from '@gestion/contracts';
import { Alert, Button, Card, DataTable, Field, Input, Select } from '@gestion/ui';
import { useState } from 'react';
import { call } from '../../lib/api';
import { useLoad } from '../../lib/useLoad';

const empty = { id: null as string | null, name: '', parentId: null as string | null };

export function CategoriesPage() {
  const { data, error, reload, setError } = useLoad(() => call('categories.list', undefined));
  const [form, setForm] = useState(empty);
  const rows = data ?? [];
  const nameOf = (id: string | null) => rows.find((row) => row.id === id)?.name ?? '';

  const run = (action: Promise<unknown>) => {
    setError(null);
    action.then(() => { setForm(empty); return reload(); }).catch((cause: Error) => setError(cause.message));
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      <Card title={form.id ? 'Modifier la catégorie' : 'Nouvelle catégorie'}>
        <form
          className="grid grid-cols-[1fr_1fr_auto] items-end gap-3"
          onSubmit={(event) => { event.preventDefault(); run(call('categories.save', { ...form, name: form.name.trim() })); }}
        >
          <Field label="Nom"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Catégorie parente">
            <Select value={form.parentId ?? ''} onChange={(event) => setForm({ ...form, parentId: event.target.value || null })}>
              <option value="">Aucune</option>
              {rows.filter((row) => row.id !== form.id).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </Select>
          </Field>
          <div className="flex gap-2">
            {form.id && <Button variant="secondary" onClick={() => setForm(empty)}>Annuler</Button>}
            <Button type="submit" disabled={!form.name.trim()}>Enregistrer</Button>
          </div>
        </form>
      </Card>
      <Card title="Catégories">
        <DataTable<Category>
          rows={rows}
          rowKey={(row) => row.id}
          empty="Aucune catégorie pour le moment."
          columns={[
            { header: 'Nom', render: (row) => row.name },
            { header: 'Parente', render: (row) => nameOf(row.parentId) },
            {
              header: 'Actions',
              align: 'right',
              render: (row) => (
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setForm(row)}>Modifier</Button>
                  <Button variant="secondary" onClick={() => run(call('categories.archive', { id: row.id }))}>Archiver</Button>
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
