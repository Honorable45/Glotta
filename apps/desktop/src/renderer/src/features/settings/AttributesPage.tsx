import type { Attribute, AttributeInput } from '@gestion/contracts';
import type { AttributeType } from '@gestion/domain';
import { Alert, Button, Card, Checkbox, DataTable, Field, Input, Select } from '@gestion/ui';
import { useState } from 'react';
import { call } from '../../lib/api';
import { attributeTypeLabels } from '../../lib/labels';
import { useLoad } from '../../lib/useLoad';

type Form = Omit<AttributeInput, 'options'> & { options: string };
const empty: Form = { id: null, name: '', type: 'TEXT', required: false, options: '', categoryIds: [] };

export function AttributesPage() {
  const { data, error, reload, setError } = useLoad(() =>
    Promise.all([call('attributes.list', undefined), call('categories.list', undefined)]),
  );
  const [form, setForm] = useState<Form>(empty);
  const [attributes, categories] = data ?? [[], []];

  const run = (action: Promise<unknown>) => {
    setError(null);
    action.then(() => { setForm(empty); return reload(); }).catch((cause: Error) => setError(cause.message));
  };
  const save = () => {
    const options = form.options.split(',').map((item) => item.trim()).filter(Boolean);
    if (form.type === 'SELECT' && options.length === 0) {
      setError('Indiquez les choix de la liste, séparés par des virgules.');
      return;
    }
    run(call('attributes.save', { ...form, name: form.name.trim(), options }));
  };
  const toggleCategory = (id: string, on: boolean) =>
    setForm({ ...form, categoryIds: on ? [...form.categoryIds, id] : form.categoryIds.filter((other) => other !== id) });

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      <Card title={form.id ? 'Modifier la caractéristique' : 'Nouvelle caractéristique'}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nom"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Type">
            <Select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as AttributeType })}>
              {Object.entries(attributeTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          {form.type === 'SELECT' && (
            <div className="col-span-2">
              <Field label="Choix" hint="Séparés par des virgules.">
                <Input value={form.options} onChange={(event) => setForm({ ...form, options: event.target.value })} />
              </Field>
            </div>
          )}
          <div className="col-span-2">
            <p className="mb-2 text-sm font-medium">Catégories concernées</p>
            {categories.length === 0 && <p className="text-sm text-muted">Créez d'abord une catégorie.</p>}
            <div className="grid grid-cols-3 gap-2">
              {categories.map((category) => (
                <Checkbox
                  key={category.id}
                  label={category.name}
                  checked={form.categoryIds.includes(category.id)}
                  onChange={(event) => toggleCategory(category.id, event.target.checked)}
                />
              ))}
            </div>
          </div>
          <Checkbox label="Obligatoire" checked={form.required} onChange={(event) => setForm({ ...form, required: event.target.checked })} />
        </div>
        <div className="mt-5 flex gap-2">
          <Button disabled={!form.name.trim()} onClick={save}>Enregistrer</Button>
          {form.id && <Button variant="secondary" onClick={() => setForm(empty)}>Annuler</Button>}
        </div>
      </Card>
      <Card title="Caractéristiques">
        <DataTable<Attribute>
          rows={attributes}
          rowKey={(row) => row.id}
          empty="Aucune caractéristique pour le moment."
          columns={[
            { header: 'Nom', render: (row) => row.name },
            { header: 'Type', render: (row) => attributeTypeLabels[row.type] },
            { header: 'Catégories', render: (row) => row.categoryIds.map((id) => categories.find((category) => category.id === id)?.name).filter(Boolean).join(', ') },
            {
              header: 'Actions',
              align: 'right',
              render: (row) => (
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setForm({ ...row, options: row.options.join(', ') })}>Modifier</Button>
                  <Button variant="secondary" onClick={() => run(call('attributes.archive', { id: row.id }))}>Archiver</Button>
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
