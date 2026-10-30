import { Alert, Button, Card, DataTable, Field, Input, Select } from '@gestion/ui';
import { useState } from 'react';
import { api, date, downloadFile, fcfa, receiptName, SaleStatus, useApi } from '../lib';
import type { Customer } from './customers';
import type { Edition } from './editions';

interface Sale {
  id: string;
  number: number;
  kind: string;
  amount: number;
  status: string;
  paymentMethod: string | null;
  paymentReference: string | null;
  paidAt: string | null;
  createdAt: string;
  licenseId: string;
  customer: { name: string };
  edition: { name: string };
  license: { keyHint: string };
}

function NewSale({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const customers = useApi<Customer[]>('/admin/customers');
  const editions = useApi<{ editions: Edition[] }>('/admin/editions');
  const [form, setForm] = useState({ customerId: '', editionCode: '', amount: '' });
  const [error, setError] = useState<string | null>(null);
  const available = (editions.data?.editions ?? []).filter((edition) => edition.isActive);
  const selected = available.find((edition) => edition.code === form.editionCode);
  return (
    <Card title="Nouvelle vente">
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          api('/admin/sales', 'POST', { customerId: form.customerId, editionCode: form.editionCode, ...(form.amount ? { amount: Number(form.amount) } : {}) }).then(onDone).catch((cause: Error) => setError(cause.message));
        }}
      >
        <Field label="Client">
          <Select value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}>
            <option value="">Choisir</option>
            {(customers.data ?? []).map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
          </Select>
        </Field>
        <Field label="Édition">
          <Select value={form.editionCode} onChange={(event) => setForm({ ...form, editionCode: event.target.value })}>
            <option value="">Choisir</option>
            {available.map((edition) => <option key={edition.code} value={edition.code}>{edition.name}</option>)}
          </Select>
        </Field>
        <Field label="Montant convenu" hint={selected ? `Tarif : ${fcfa(selected.price)}` : 'Le tarif de l’édition par défaut.'}>
          <Input inputMode="numeric" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value.replace(/\D/g, '') })} />
        </Field>
        {error && <div className="sm:col-span-3"><Alert>{error}</Alert></div>}
        <p className="text-sm text-muted sm:col-span-3">La vente reste en attente : aucune clé n'est disponible tant que vous n'avez pas confirmé le paiement.</p>
        <div className="flex gap-2 sm:col-span-3">
          <Button type="submit" disabled={!form.customerId || !form.editionCode}>Créer la vente</Button>
          <Button variant="secondary" onClick={onCancel}>Annuler</Button>
        </div>
      </form>
    </Card>
  );
}

function Confirm({ sale, onDone, onCancel }: { sale: Sale; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ paymentMethod: '', paymentReference: '', paidAt: new Date().toISOString().slice(0, 10) });
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title={`Confirmer le paiement de ${receiptName(sale.number)} : ${fcfa(sale.amount)}`}>
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          api(`/admin/sales/${sale.id}/confirm`, 'POST', form).then(onDone).catch((cause: Error) => setError(cause.message));
        }}
      >
        <Field label="Mode de paiement" hint="Espèces, Mobile Money, virement…"><Input value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value })} /></Field>
        <Field label="Référence du paiement"><Input value={form.paymentReference} onChange={(event) => setForm({ ...form, paymentReference: event.target.value })} /></Field>
        <Field label="Date du paiement"><Input type="date" value={form.paidAt} onChange={(event) => setForm({ ...form, paidAt: event.target.value })} /></Field>
        {error && <div className="sm:col-span-3"><Alert>{error}</Alert></div>}
        <p className="text-sm text-muted sm:col-span-3">Confirmez uniquement un paiement réellement reçu : cette action délivre la licence.</p>
        <div className="flex gap-2 sm:col-span-3">
          <Button type="submit" disabled={form.paymentMethod.trim().length < 2}>J'ai reçu le paiement</Button>
          <Button variant="secondary" onClick={onCancel}>Annuler</Button>
        </div>
      </form>
    </Card>
  );
}

function ReasonAction({ title, action, onConfirm, onCancel }: { title: string; action: string; onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <Card title={title}>
      <Field label="Motif (journalisé)"><Input value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
      <div className="mt-3 flex gap-2">
        <Button disabled={reason.trim().length < 3} onClick={() => onConfirm(reason)}>{action}</Button>
        <Button variant="secondary" onClick={onCancel}>Annuler</Button>
      </div>
    </Card>
  );
}

export function SalesPage({ role, onOpenLicense }: { role: string; onOpenLicense: (id: string) => void }) {
  const [status, setStatus] = useState('');
  const { data, error, setError, reload } = useApi<Sale[]>(`/admin/sales${status ? `?status=${status}` : ''}`);
  const [creating, setCreating] = useState(false);
  const [acting, setActing] = useState<{ sale: Sale; kind: 'confirm' | 'cancel' | 'refund' } | null>(null);
  const done = () => { setActing(null); void reload(); };
  const act = (sale: Sale, path: string, reason: string) => api(`/admin/sales/${sale.id}/${path}`, 'POST', { reason }).then(done).catch((cause: Error) => setError(cause.message));
  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      {creating && <NewSale onCancel={() => setCreating(false)} onDone={() => { setCreating(false); void reload(); }} />}
      {acting?.kind === 'confirm' && <Confirm key={acting.sale.id} sale={acting.sale} onCancel={() => setActing(null)} onDone={done} />}
      {acting?.kind === 'cancel' && <ReasonAction key={acting.sale.id} title={`Annuler ${receiptName(acting.sale.number)}`} action="Annuler la vente" onCancel={() => setActing(null)} onConfirm={(reason) => void act(acting.sale, 'cancel', reason)} />}
      {acting?.kind === 'refund' && <ReasonAction key={acting.sale.id} title={`Rembourser ${receiptName(acting.sale.number)}`} action="Rembourser et retirer le droit vendu" onCancel={() => setActing(null)} onConfirm={(reason) => void act(acting.sale, 'refund', reason)} />}
      <Card title="Ventes">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div className="w-44">
            <Select aria-label="Filtrer par état" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Toutes</option>
              <option value="PENDING">En attente</option>
              <option value="PAID">Payé</option>
              <option value="CANCELLED">Annulé</option>
              <option value="REFUNDED">Remboursé</option>
            </Select>
          </div>
          <Button onClick={() => setCreating(true)}>Nouvelle vente</Button>
        </div>
        <DataTable<Sale>
          rows={data ?? []}
          rowKey={(row) => row.id}
          empty="Aucune vente."
          columns={[
            { header: 'Numéro', render: (row) => <>{receiptName(row.number)}<span className="block text-xs text-muted">{date(row.paidAt ?? row.createdAt)}</span></> },
            { header: 'Client', render: (row) => row.customer.name },
            { header: 'Édition', render: (row) => <>{row.edition.name}{row.kind === 'UPGRADE' && <span className="block text-xs text-muted">Mise à niveau</span>}</> },
            { header: 'Licence', render: (row) => <button type="button" className="font-mono underline" onClick={() => onOpenLicense(row.licenseId)}>…{row.license.keyHint}</button> },
            { header: 'État', render: (row) => <SaleStatus status={row.status} /> },
            { header: 'Montant', align: 'right', render: (row) => fcfa(row.amount) },
            {
              header: 'Actions',
              align: 'right',
              render: (row) => (
                <div className="flex flex-wrap justify-end gap-1.5">
                  {row.status === 'PENDING' && <Button onClick={() => setActing({ sale: row, kind: 'confirm' })}>Confirmer le paiement</Button>}
                  {row.status === 'PENDING' && <Button variant="secondary" onClick={() => setActing({ sale: row, kind: 'cancel' })}>Annuler</Button>}
                  {(row.status === 'PAID' || row.status === 'REFUNDED') && <Button variant="secondary" onClick={() => void downloadFile(`/admin/sales/${row.id}/receipt`, `${receiptName(row.number)}.pdf`).catch((cause: Error) => setError(cause.message))}>Reçu PDF</Button>}
                  {row.status === 'PAID' && role === 'OWNER' && <Button variant="secondary" onClick={() => setActing({ sale: row, kind: 'refund' })}>Rembourser</Button>}
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
