import type { SaleDetail, SaleSummary } from '@gestion/contracts';
import { formatQuantity } from '@gestion/domain';
import { Alert, Badge, Button, Card, Checkbox, DataTable, Field, Input, Select } from '@gestion/ui';
import { useState } from 'react';
import { call } from '../../lib/api';
import { formatDateTime, saleStatusLabels, tryQuantity } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useCurrency } from '../../lib/useCurrency';
import { useLoad } from '../../lib/useLoad';

function SaleDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const { money } = useCurrency();
  const { can } = useSession();
  const { data, error, reload, setError } = useLoad(() => Promise.all([call('sales.get', { id }), call('paymentMethods.list', undefined)]));
  const [mode, setMode] = useState<'none' | 'return' | 'cancel'>('none');
  const [reason, setReason] = useState('');
  const [methodId, setMethodId] = useState('');
  const [picks, setPicks] = useState<Record<string, { quantity: string; restock: boolean; serialIds: string[] }>>({});
  if (!data) return error ? <Alert>{error}</Alert> : null;
  const [sale, methods] = data as [SaleDetail, Awaited<ReturnType<typeof call<'paymentMethods.list'>>>];
  const refundMethod = methodId || methods.find((method) => method.isActive)?.id || null;
  const closed = sale.status === 'CANCELLED';

  const finish = (action: Promise<unknown>) => {
    setError(null);
    action
      .then(() => {
        setMode('none');
        setReason('');
        setPicks({});
        return reload();
      })
      .catch((cause: Error) => setError(cause.message));
  };

  const submitReturn = () => {
    const lines = Object.entries(picks).flatMap(([saleLineId, pick]) => {
      const quantity = tryQuantity(pick.quantity);
      return quantity ? [{ saleLineId, quantity, restock: pick.restock, serialIds: pick.serialIds }] : [];
    });
    if (lines.length === 0) {
      setError('Sélectionnez au moins un article.');
      return;
    }
    finish(call('sales.return', { saleId: sale.id, reason, refundMethodId: refundMethod, lines }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={onBack}>Retour à la liste</Button>
        <span className="flex-1" />
        <Button variant="secondary" onClick={() => call('sales.print', { saleId: sale.id, format: 'thermal' }).catch((cause: Error) => setError(cause.message))}>Imprimer le reçu</Button>
        <Button variant="secondary" onClick={() => call('sales.print', { saleId: sale.id, format: 'a4' }).catch((cause: Error) => setError(cause.message))}>Facture A4</Button>
        {!closed && can('cancel_sale') && <Button variant="secondary" onClick={() => setMode('return')}>Enregistrer un retour</Button>}
        {!closed && can('cancel_sale') && <Button variant="secondary" onClick={() => setMode('cancel')}>Annuler la vente</Button>}
      </div>
      {error && <Alert>{error}</Alert>}

      {mode !== 'none' && (
        <Card title={mode === 'return' ? 'Retour d’articles' : 'Annulation de la vente'}>
          <div className="flex flex-col gap-4">
            {mode === 'return' && (
              <ul className="divide-y divide-border">
                {sale.lines.filter((line) => line.quantity > line.returnedQuantity).map((line) => {
                  const pick = picks[line.id];
                  const set = (next: Partial<NonNullable<typeof pick>>) =>
                    setPicks({ ...picks, [line.id]: { quantity: pick?.quantity ?? '', restock: pick?.restock ?? true, serialIds: pick?.serialIds ?? [], ...next } });
                  return (
                    <li key={line.id} className="grid grid-cols-[1fr_7rem_auto] items-center gap-3 py-2 text-sm">
                      <span>{line.productName} {line.variantLabel}<span className="block text-xs text-muted">Retournable : {formatQuantity(line.quantity - line.returnedQuantity)}</span></span>
                      <Input aria-label={`Quantité retournée de ${line.productName}`} placeholder="Quantité" disabled={line.serials.length > 0} value={pick?.quantity ?? ''} onChange={(event) => set({ quantity: event.target.value })} />
                      <Checkbox label="Remettre en stock" checked={pick?.restock ?? true} onChange={(event) => set({ restock: event.target.checked })} />
                      {line.serials.length > 0 && (
                        <div className="col-span-3 flex flex-wrap gap-3">
                          {line.serials.map((serial) => (
                            <Checkbox
                              key={serial.id}
                              label={serial.serial}
                              checked={pick?.serialIds.includes(serial.id) ?? false}
                              onChange={(event) => {
                                const serialIds = event.target.checked ? [...(pick?.serialIds ?? []), serial.id] : (pick?.serialIds ?? []).filter((other) => other !== serial.id);
                                set({ serialIds, quantity: String(serialIds.length) });
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Motif"><Input value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
              <Field label="Mode de remboursement" hint="Utilisé seulement si de l'argent est rendu.">
                <Select value={refundMethod ?? ''} onChange={(event) => setMethodId(event.target.value)}>
                  {methods.filter((method) => method.isActive).map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                </Select>
              </Field>
            </div>
            <div className="flex gap-2">
              <Button disabled={!reason.trim()} onClick={() => (mode === 'return' ? submitReturn() : finish(call('sales.cancel', { saleId: sale.id, reason, refundMethodId: refundMethod })))}>
                {mode === 'return' ? 'Confirmer le retour' : "Confirmer l'annulation"}
              </Button>
              <Button variant="secondary" onClick={() => setMode('none')}>Fermer</Button>
            </div>
          </div>
        </Card>
      )}

      <Card title={`Vente ${sale.number}`}>
        <p className="mb-3 flex items-center gap-2 text-sm text-muted">
          {formatDateTime(sale.occurredAt)}{sale.customerName && ` · ${sale.customerName}`}
          <Badge tone={closed ? 'danger' : 'success'}>{saleStatusLabels[sale.status] ?? sale.status}</Badge>
        </p>
        {sale.cancelReason && <p className="mb-3 text-sm">Motif d'annulation : {sale.cancelReason}</p>}
        <DataTable
          rows={sale.lines}
          rowKey={(line) => line.id}
          empty=""
          columns={[
            { header: 'Article', render: (line) => <>{line.productName} {line.variantLabel}{line.serials.length > 0 && <span className="block text-xs text-muted">{line.serials.map((serial) => serial.serial).join(', ')}</span>}</> },
            { header: 'Quantité', align: 'right', render: (line) => formatQuantity(line.quantity) },
            { header: 'Retourné', align: 'right', render: (line) => formatQuantity(line.returnedQuantity) },
            { header: 'Prix', align: 'right', render: (line) => money(line.unitPrice) },
            { header: 'Total', align: 'right', render: (line) => money(line.lineTotal) },
          ]}
        />
        <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Total net</dt><dd className="font-semibold tabular-nums">{money(sale.netTotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Payé</dt><dd className="tabular-nums">{money(sale.netPaid)}</dd></div>
          {sale.netTotal > sale.netPaid && <div className="flex justify-between text-danger"><dt>Reste dû</dt><dd className="tabular-nums">{money(sale.netTotal - sale.netPaid)}</dd></div>}
        </dl>
      </Card>

      <Card title="Historique des paiements">
        <DataTable
          rows={sale.payments}
          rowKey={(payment) => payment.id}
          empty="Aucun paiement."
          columns={[
            { header: 'Date', render: (payment) => formatDateTime(payment.occurredAt) },
            { header: 'Mode', render: (payment) => payment.methodName },
            { header: 'Type', render: (payment) => (payment.kind === 'REFUND' ? 'Remboursement' : 'Paiement') },
            { header: 'Montant', align: 'right', render: (payment) => money(payment.amount) },
          ]}
        />
      </Card>
    </div>
  );
}

export function SalesPage() {
  const { money } = useCurrency();
  const { data, error, reload } = useLoad(() => call('sales.list', { limit: 200 }));
  const [selected, setSelected] = useState<string | null>(null);
  if (selected) return <SaleDetailView id={selected} onBack={() => { setSelected(null); void reload(); }} />;
  return (
    <Card title="Dernières ventes">
      {error && <Alert>{error}</Alert>}
      <DataTable<SaleSummary>
        rows={data ?? []}
        rowKey={(sale) => sale.id}
        empty="Aucune vente enregistrée."
        columns={[
          { header: 'Numéro', render: (sale) => <button type="button" className="font-medium text-primary hover:underline" onClick={() => setSelected(sale.id)}>{sale.number}</button> },
          { header: 'Date', render: (sale) => formatDateTime(sale.occurredAt) },
          { header: 'Client', render: (sale) => sale.customerName ?? 'Client de passage' },
          { header: 'État', render: (sale) => <Badge tone={sale.status === 'CANCELLED' ? 'danger' : 'success'}>{saleStatusLabels[sale.status] ?? sale.status}</Badge> },
          { header: 'Total', align: 'right', render: (sale) => money(sale.netTotal) },
          { header: 'Payé', align: 'right', render: (sale) => money(sale.netPaid) },
        ]}
      />
    </Card>
  );
}
