import type { DebtItem } from '@gestion/contracts';
import { newId } from '@gestion/domain';
import { Alert, Badge, Button, Card, Checkbox, DataTable, Field, Input, Select } from '@gestion/ui';
import { useEffect, useRef, useState } from 'react';
import { call } from '../../lib/api';
import { tryAmount } from '../../lib/format';
import { useLicense } from '../../lib/license';
import { useCurrency } from '../../lib/useCurrency';
import { useLoad } from '../../lib/useLoad';

const statusLabels: Record<DebtItem['status'], string> = { PENDING: 'En attente', PARTIAL: 'Partiellement payé', PAID: 'Entièrement payé', OVERDUE: 'En retard' };

export function DebtsPage() {
  const { currency, money } = useCurrency();
  const [openOnly, setOpenOnly] = useState(true);
  const [rows, setRows] = useState<DebtItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { license } = useLicense();
  const canRemind = license?.features.includes('reminders') ?? false;
  const [reminding, setReminding] = useState<DebtItem | null>(null);
  const [reminder, setReminder] = useState({ dueDate: '', note: '' });
  const [paying, setPaying] = useState<DebtItem | null>(null);
  const [amount, setAmount] = useState('');
  const [methodId, setMethodId] = useState('');
  const paymentId = useRef(newId());
  const { data: methodData } = useLoad(() => call('paymentMethods.list', undefined));
  const methods = (methodData ?? []).filter((method) => method.isActive);
  const activeMethod = methodId || methods[0]?.id || '';

  const load = () => call('debts.list', { openOnly, customerId: null }).then(setRows).catch((cause: Error) => setError(cause.message));
  useEffect(() => void load(), [openOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = () => {
    if (!paying) return;
    setError(null);
    const value = tryAmount(amount, currency);
    if (!value || value <= 0n) {
      setError('Montant invalide.');
      return;
    }
    call('debts.pay', { id: paymentId.current, debtId: paying.id, amount: value, methodId: activeMethod })
      .then(() => {
        paymentId.current = newId();
        setPaying(null);
        setAmount('');
        return load();
      })
      .catch((cause: Error) => setError(cause.message));
  };

  const totalDue = rows.reduce((sum, row) => sum + row.remaining, 0n);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Checkbox label="Dettes en cours uniquement" checked={openOnly} onChange={(event) => setOpenOnly(event.target.checked)} />
        <p className="text-sm">Total restant dû : <span data-testid="total-due" className="font-semibold tabular-nums">{money(totalDue)}</span></p>
      </div>
      {error && <Alert>{error}</Alert>}
      {paying && (
        <Card title={`Encaisser un paiement de ${paying.customerName}`}>
          <p className="mb-3 text-sm text-muted">Vente {paying.saleNumber}, solde restant : {money(paying.remaining)}</p>
          <div className="grid grid-cols-[1fr_1fr_auto_auto] items-end gap-3">
            <Field label="Montant"><Input value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
            <Field label="Mode de paiement">
              <Select value={activeMethod} onChange={(event) => setMethodId(event.target.value)}>
                {methods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
              </Select>
            </Field>
            <Button onClick={pay}>Encaisser</Button>
            <Button variant="secondary" onClick={() => setPaying(null)}>Fermer</Button>
          </div>
        </Card>
      )}
      {reminding && (
        <Card title={`Programmer un rappel pour ${reminding.customerName}`}>
          <div className="grid grid-cols-[12rem_1fr_auto_auto] items-end gap-3">
            <Field label="Date du rappel"><Input type="date" value={reminder.dueDate} onChange={(event) => setReminder({ ...reminder, dueDate: event.target.value })} /></Field>
            <Field label="Remarque (facultatif)"><Input value={reminder.note} onChange={(event) => setReminder({ ...reminder, note: event.target.value })} /></Field>
            <Button
              disabled={!reminder.dueDate}
              onClick={() => call('reminders.create', { debtId: reminding.id, dueDate: reminder.dueDate, note: reminder.note.trim() || null }).then(() => { setReminding(null); setReminder({ dueDate: '', note: '' }); }).catch((cause: Error) => setError(cause.message))}
            >
              Programmer
            </Button>
            <Button variant="secondary" onClick={() => setReminding(null)}>Fermer</Button>
          </div>
        </Card>
      )}
      <Card title="Dettes clients">
        <DataTable<DebtItem>
          rows={rows}
          rowKey={(row) => row.id}
          empty="Aucune dette."
          columns={[
            { header: 'Client', render: (row) => row.customerName },
            { header: 'Vente', render: (row) => row.saleNumber },
            { header: 'Échéance', render: (row) => row.dueDate ?? 'Non définie' },
            { header: 'Total', align: 'right', render: (row) => money(row.total) },
            { header: 'Payé', align: 'right', render: (row) => money(row.paid) },
            { header: 'Restant', align: 'right', render: (row) => money(row.remaining) },
            { header: 'Statut', render: (row) => <Badge tone={row.status === 'PAID' ? 'success' : 'danger'}>{statusLabels[row.status]}</Badge> },
            {
              header: 'Actions',
              align: 'right',
              render: (row) => row.status !== 'PAID' && (
                <div className="flex justify-end gap-2">
                  {canRemind && <Button variant="secondary" onClick={() => setReminding(row)}>Rappel</Button>}
                  {canRemind && <Button variant="secondary" onClick={() => { setError(null); call('debts.whatsapp', { debtId: row.id }).catch((cause: Error) => setError(cause.message)); }}>WhatsApp</Button>}
                  <Button variant="secondary" onClick={() => { setAmount(''); setPaying(row); }}>Encaisser</Button>
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
