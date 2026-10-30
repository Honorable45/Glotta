import { Alert, Button, Card, Checkbox, DataTable, Field, Input, Textarea } from '@gestion/ui';
import { useState } from 'react';
import { api, fcfa, featureLabels, Neutral, useApi } from '../lib';

export interface Edition {
  code: string;
  name: string;
  description: string;
  price: number;
  maxUsers: number;
  maxStores: number;
  maxDevices: number;
  features: string[];
  majorVersion: number;
  syncQuotaMb: number;
  isActive: boolean;
}

const blank = { code: '', name: '', description: '', price: '', maxUsers: '1', maxStores: '1', maxDevices: '1', majorVersion: '1', syncQuotaMb: '0' };

function EditionForm({ initial, features, onDone, onCancel }: { initial: Edition | null; features: string[]; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState(initial ? { ...blank, code: initial.code, name: initial.name, description: initial.description, price: String(initial.price), maxUsers: String(initial.maxUsers), maxStores: String(initial.maxStores), maxDevices: String(initial.maxDevices), majorVersion: String(initial.majorVersion), syncQuotaMb: String(initial.syncQuotaMb) } : blank);
  const [selected, setSelected] = useState<string[]>(initial?.features ?? []);
  const [isActive, setActive] = useState(initial?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const field = (key: keyof typeof blank) => ({ value: form[key], onChange: (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value }) });
  const number = (key: keyof typeof blank) => ({ inputMode: 'numeric' as const, ...field(key) });
  const submit = () => {
    setError(null);
    const body = { name: form.name, description: form.description, price: Number(form.price), maxUsers: Number(form.maxUsers), maxStores: Number(form.maxStores), maxDevices: Number(form.maxDevices), majorVersion: Number(form.majorVersion), syncQuotaMb: Number(form.syncQuotaMb), features: selected, isActive };
    (initial ? api(`/admin/editions/${initial.code}`, 'PUT', body) : api('/admin/editions', 'POST', { code: form.code, ...body })).then(onDone).catch((cause: Error) => setError(cause.message));
  };
  return (
    <Card title={initial ? `Modifier ${initial.name}` : 'Nouvelle édition'}>
      <div className="grid gap-3 sm:grid-cols-3">
        {!initial && <Field label="Code" hint="Lettres et chiffres, sans espace."><Input {...field('code')} /></Field>}
        <Field label="Nom de l'édition"><Input {...field('name')} /></Field>
        <Field label="Prix de vente (FCFA)"><Input {...number('price')} /></Field>
        <Field label="Ordinateurs par licence"><Input {...number('maxDevices')} /></Field>
        <Field label="Utilisateurs"><Input {...number('maxUsers')} /></Field>
        <Field label="Boutiques"><Input {...number('maxStores')} /></Field>
        <Field label="Grande version couverte"><Input {...number('majorVersion')} /></Field>
        <Field label="Stockage de synchronisation (Mo)"><Input {...number('syncQuotaMb')} /></Field>
      </div>
      <div className="mt-3"><Field label="Description"><Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field></div>
      <fieldset className="mt-3">
        <legend className="mb-2 text-sm font-medium">Fonctions incluses</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {features.map((feature) => (
            <Checkbox key={feature} label={featureLabels[feature] ?? feature} checked={selected.includes(feature)} onChange={(event) => setSelected(event.target.checked ? [...selected, feature] : selected.filter((item) => item !== feature))} />
          ))}
        </div>
      </fieldset>
      <div className="mt-3"><Checkbox label="En vente" checked={isActive} onChange={(event) => setActive(event.target.checked)} /></div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      <p className="mt-3 text-sm text-muted">Les licences déjà vendues gardent les conditions de leur vente.</p>
      <div className="mt-3 flex gap-2">
        <Button disabled={!form.name.trim() || !form.price} onClick={submit}>Enregistrer l'édition</Button>
        <Button variant="secondary" onClick={onCancel}>Annuler</Button>
      </div>
    </Card>
  );
}

export function EditionsPage({ role }: { role: string }) {
  const { data, error, reload } = useApi<{ editions: Edition[]; features: string[] }>('/admin/editions');
  const [editing, setEditing] = useState<Edition | 'new' | null>(null);
  const owner = role === 'OWNER';
  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      {editing && data && <EditionForm key={editing === 'new' ? 'new' : editing.code} initial={editing === 'new' ? null : editing} features={data.features} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); void reload(); }} />}
      <Card title="Éditions et tarifs">
        {owner && <div className="mb-3"><Button onClick={() => setEditing('new')}>Nouvelle édition</Button></div>}
        <DataTable<Edition>
          rows={data?.editions ?? []}
          rowKey={(row) => row.code}
          empty="Aucune édition. Créez-en une avant votre première vente."
          columns={[
            { header: 'Édition', render: (row) => <>{row.name}<span className="block text-xs text-muted">Version {row.majorVersion}.x</span></> },
            { header: 'Prix', align: 'right', render: (row) => fcfa(row.price) },
            { header: 'Ordinateurs', align: 'right', render: (row) => row.maxDevices },
            { header: 'Utilisateurs', align: 'right', render: (row) => row.maxUsers },
            { header: 'État', render: (row) => <Neutral>{row.isActive ? 'En vente' : 'Retirée'}</Neutral> },
            ...(owner ? [{ header: 'Actions', align: 'right' as const, render: (row: Edition) => <Button variant="secondary" onClick={() => setEditing(row)}>Modifier</Button> }] : []),
          ]}
        />
      </Card>
    </div>
  );
}
