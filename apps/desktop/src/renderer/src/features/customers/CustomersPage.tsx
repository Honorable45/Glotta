import { customerInputSchema, type Customer, type CustomerInput } from '@gestion/contracts';
import { Alert, Badge, Button, Card, DataTable, DetailList, Field, Input } from '@gestion/ui';
import { useEffect, useState } from 'react';
import { call } from '../../lib/api';
import { formatDateTime, saleStatusLabels } from '../../lib/format';
import { useCurrency } from '../../lib/useCurrency';
import { useLoad } from '../../lib/useLoad';

const empty: CustomerInput = { id: null, name: '', phone: null, whatsapp: null, address: null };

function CustomerDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { money } = useCurrency();
  const { data, error } = useLoad(() => call('customers.get', { id }));
  if (!data) return error ? <Alert>{error}</Alert> : null;
  return (
    <div className="flex flex-col gap-4">
      <div><Button variant="secondary" onClick={onBack}>Retour à la liste</Button></div>
      <Card title={data.name}>
        <DetailList
          items={[
            { label: 'Téléphone', value: data.phone ?? 'Non renseigné' },
            { label: 'WhatsApp', value: data.whatsapp ?? 'Non renseigné' },
            { label: 'Adresse', value: data.address ?? 'Non renseignée' },
            { label: 'Solde dû', value: data.balance > 0n ? <Badge tone="danger">{money(data.balance)}</Badge> : money(0n) },
          ]}
        />
      </Card>
      <Card title="Historique des achats">
        <DataTable
          rows={data.sales}
          rowKey={(sale) => sale.id}
          empty="Aucun achat."
          columns={[
            { header: 'Numéro', render: (sale) => sale.number },
            { header: 'Date', render: (sale) => formatDateTime(sale.occurredAt) },
            { header: 'État', render: (sale) => saleStatusLabels[sale.status] ?? sale.status },
            { header: 'Total', align: 'right', render: (sale) => money(sale.netTotal) },
            { header: 'Payé', align: 'right', render: (sale) => money(sale.netPaid) },
          ]}
        />
      </Card>
    </div>
  );
}

export function CustomersPage() {
  const { money } = useCurrency();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Customer[]>([]);
  const [form, setForm] = useState<CustomerInput>(empty);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => call('customers.list', { search }).then(setRows).catch((cause: Error) => setError(cause.message));
  useEffect(() => { if (!selected) void load(); }, [search, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  if (selected) return <CustomerDetail id={selected} onBack={() => setSelected(null)} />;

  const save = () => {
    setError(null);
    const parsed = customerInputSchema.safeParse({ ...form, name: form.name.trim() });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Vérifiez les informations saisies.');
      return;
    }
    call('customers.save', parsed.data).then(() => { setForm(empty); return load(); }).catch((cause: Error) => setError(cause.message));
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      <Card title={form.id ? 'Modifier le client' : 'Nouveau client'}>
        <div className="grid grid-cols-4 gap-3">
          <Field label="Nom"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Téléphone"><Input value={form.phone ?? ''} onChange={(event) => setForm({ ...form, phone: event.target.value.trim() || null })} /></Field>
          <Field label="WhatsApp"><Input value={form.whatsapp ?? ''} onChange={(event) => setForm({ ...form, whatsapp: event.target.value.trim() || null })} /></Field>
          <Field label="Adresse"><Input value={form.address ?? ''} onChange={(event) => setForm({ ...form, address: event.target.value || null })} /></Field>
        </div>
        <div className="mt-4 flex gap-2">
          <Button disabled={!form.name.trim()} onClick={save}>Enregistrer</Button>
          {form.id && <Button variant="secondary" onClick={() => setForm(empty)}>Annuler</Button>}
        </div>
      </Card>
      <Card title="Clients">
        <Input aria-label="Rechercher un client" placeholder="Nom ou téléphone" className="mb-3 max-w-sm" value={search} onChange={(event) => setSearch(event.target.value)} />
        <DataTable<Customer>
          rows={rows}
          rowKey={(row) => row.id}
          empty="Aucun client."
          columns={[
            { header: 'Nom', render: (row) => <button type="button" className="font-medium text-primary hover:underline" onClick={() => setSelected(row.id)}>{row.name}</button> },
            { header: 'Téléphone', render: (row) => row.phone ?? '' },
            { header: 'Solde dû', align: 'right', render: (row) => (row.balance > 0n ? <Badge tone="danger">{money(row.balance)}</Badge> : money(0n)) },
            {
              header: 'Actions',
              align: 'right',
              render: (row) => (
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setForm({ id: row.id, name: row.name, phone: row.phone, whatsapp: row.whatsapp, address: row.address })}>Modifier</Button>
                  <Button variant="secondary" onClick={() => call('customers.setArchived', { id: row.id, archived: true }).then(load).catch((cause: Error) => setError(cause.message))}>Archiver</Button>
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
