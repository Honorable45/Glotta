import { Alert, Button, Card, DataTable, DetailList, Field, Input, Textarea } from '@gestion/ui';
import { useState } from 'react';
import { api, date, fcfa, LicenseStatus, receiptName, SaleStatus, useApi } from '../lib';

export interface Customer {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
  _count: { licenses: number; sales: number };
}

const blank = { name: '', contactName: '', email: '', phone: '', address: '', notes: '' };

function CustomerForm({ initial, onDone, onCancel }: { initial: Customer | null; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState(initial ? { name: initial.name, contactName: initial.contactName ?? '', email: initial.email ?? '', phone: initial.phone ?? '', address: initial.address ?? '', notes: initial.notes ?? '' } : blank);
  const [error, setError] = useState<string | null>(null);
  const field = (key: keyof typeof blank) => ({ value: form[key], onChange: (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value }) });
  return (
    <Card title={initial ? `Modifier ${initial.name}` : 'Nouveau client'}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          (initial ? api(`/admin/customers/${initial.id}`, 'PUT', form) : api('/admin/customers', 'POST', form)).then(onDone).catch((cause: Error) => setError(cause.message));
        }}
      >
        <Field label="Nom du client"><Input {...field('name')} /></Field>
        <Field label="Personne à contacter"><Input {...field('contactName')} /></Field>
        <Field label="Téléphone"><Input {...field('phone')} /></Field>
        <Field label="Email"><Input type="email" {...field('email')} /></Field>
        <Field label="Adresse"><Input {...field('address')} /></Field>
        <Field label="Notes"><Textarea {...field('notes')} /></Field>
        {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={!form.name.trim()}>Enregistrer le client</Button>
          <Button variant="secondary" onClick={onCancel}>Annuler</Button>
        </div>
      </form>
    </Card>
  );
}

interface CustomerDetail extends Customer {
  licenses: { id: string; keyHint: string; editionName: string; status: string; isTrial: boolean; createdAt: string }[];
  sales: { id: string; number: number; status: string; amount: number; kind: string; createdAt: string; editionCode: string }[];
}

function CustomerCard({ id, onClose, onEdit, onOpenLicense }: { id: string; onClose: () => void; onEdit: (customer: CustomerDetail) => void; onOpenLicense: (id: string) => void }) {
  const { data, error } = useApi<CustomerDetail>(`/admin/customers/${id}`);
  if (!data) return error ? <Alert>{error}</Alert> : null;
  return (
    <Card title={data.name}>
      <DetailList
        items={[
          { label: 'Contact', value: data.contactName ?? '' },
          { label: 'Téléphone', value: data.phone ?? '' },
          { label: 'Email', value: data.email ?? '' },
          { label: 'Adresse', value: data.address ?? '' },
          { label: 'Notes', value: data.notes ?? '' },
        ].filter((item) => item.value)}
      />
      <h3 className="mb-1 mt-5 text-sm font-semibold">Licences</h3>
      <DataTable
        rows={data.licenses}
        rowKey={(row) => row.id}
        empty="Aucune licence."
        columns={[
          { header: 'Clé', render: (row) => <button type="button" className="font-mono underline" onClick={() => onOpenLicense(row.id)}>…{row.keyHint}</button> },
          { header: 'Édition', render: (row) => `${row.editionName}${row.isTrial ? ' (essai)' : ''}` },
          { header: 'État', render: (row) => <LicenseStatus status={row.status} /> },
        ]}
      />
      <h3 className="mb-1 mt-5 text-sm font-semibold">Ventes</h3>
      <DataTable
        rows={data.sales}
        rowKey={(row) => row.id}
        empty="Aucune vente."
        columns={[
          { header: 'Numéro', render: (row) => receiptName(row.number) },
          { header: 'Date', render: (row) => date(row.createdAt) },
          { header: 'État', render: (row) => <SaleStatus status={row.status} /> },
          { header: 'Montant', align: 'right', render: (row) => fcfa(row.amount) },
        ]}
      />
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={() => onEdit(data)}>Modifier</Button>
        <Button variant="secondary" onClick={onClose}>Fermer</Button>
      </div>
    </Card>
  );
}

export function CustomersPage({ onOpenLicense }: { onOpenLicense: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const { data, error, reload } = useApi<Customer[]>(`/admin/customers?search=${encodeURIComponent(search)}`);
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      {editing && (
        <CustomerForm
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onDone={() => { setEditing(null); void reload(); }}
        />
      )}
      {opened && <CustomerCard key={opened} id={opened} onClose={() => setOpened(null)} onEdit={(customer) => { setOpened(null); setEditing(customer); }} onOpenLicense={onOpenLicense} />}
      <Card title="Clients">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1"><Input aria-label="Rechercher un client" placeholder="Nom, téléphone ou email" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          <Button onClick={() => setEditing('new')}>Nouveau client</Button>
        </div>
        <DataTable<Customer>
          rows={data ?? []}
          rowKey={(row) => row.id}
          empty="Aucun client."
          columns={[
            { header: 'Client', render: (row) => <button type="button" className="text-left font-medium underline" onClick={() => setOpened(row.id)}>{row.name}</button> },
            { header: 'Téléphone', render: (row) => row.phone ?? '' },
            { header: 'Licences', align: 'right', render: (row) => row._count.licenses },
            { header: 'Ventes', align: 'right', render: (row) => row._count.sales },
          ]}
        />
      </Card>
    </div>
  );
}
