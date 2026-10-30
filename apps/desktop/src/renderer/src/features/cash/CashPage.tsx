import { Alert, Badge, Button, Card, DataTable, DetailList, Field, Input, Select } from '@gestion/ui';
import { useState } from 'react';
import { call } from '../../lib/api';
import { formatDateTime, tryAmount } from '../../lib/format';
import { useCurrency } from '../../lib/useCurrency';
import { useLoad } from '../../lib/useLoad';

const movementLabels: Record<string, string> = { IN: 'Encaissement', OUT: 'Décaissement', WITHDRAWAL: 'Retrait', EXPENSE: 'Dépense' };

export function CashPage() {
  const { currency, money } = useCurrency();
  const { data, error, reload, setError } = useLoad(() => Promise.all([call('cash.current', undefined), call('cash.history', { limit: 30 })]));
  const [float, setFloat] = useState('');
  const [move, setMove] = useState({ type: 'IN' as 'IN' | 'OUT' | 'WITHDRAWAL', amount: '', reason: '' });
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  if (!data) return error ? <Alert>{error}</Alert> : null;
  const [current, history] = data;

  const run = (action: Promise<unknown>, after?: () => void) => {
    setError(null);
    action.then(() => { after?.(); return reload(); }).catch((cause: Error) => setError(cause.message));
  };
  const amountOf = (text: string) => {
    const value = tryAmount(text, currency);
    if (value === null || value < 0n) setError('Montant invalide.');
    return value !== null && value >= 0n ? value : null;
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      {!current ? (
        <Card title="Ouverture de caisse">
          <div className="flex items-end gap-3">
            <Field label="Solde initial"><Input value={float} onChange={(event) => setFloat(event.target.value)} /></Field>
            <Button onClick={() => { const value = amountOf(float); if (value !== null) run(call('cash.open', { openingFloat: value }), () => setFloat('')); }}>Ouvrir la caisse</Button>
          </div>
        </Card>
      ) : (
        <>
          <Card title={`Caisse ouverte depuis ${formatDateTime(current.openedAt)}`}>
            <DetailList
              items={[
                { label: 'Solde initial', value: money(current.openingFloat) },
                { label: 'Paiements en espèces, nets', value: money(current.cashSales) },
                { label: 'Encaissements', value: money(current.cashIn) },
                { label: 'Décaissements et retraits', value: money(current.cashOut) },
                { label: 'Solde attendu', value: <span data-testid="expected" className="font-semibold">{money(current.expected)}</span> },
              ]}
            />
          </Card>
          <Card title="Mouvement de caisse">
            <div className="grid grid-cols-[12rem_10rem_1fr_auto] items-end gap-3">
              <Field label="Type">
                <Select value={move.type} onChange={(event) => setMove({ ...move, type: event.target.value as typeof move.type })}>
                  <option value="IN">Encaissement</option>
                  <option value="OUT">Décaissement</option>
                  <option value="WITHDRAWAL">Retrait</option>
                </Select>
              </Field>
              <Field label="Montant"><Input value={move.amount} onChange={(event) => setMove({ ...move, amount: event.target.value })} /></Field>
              <Field label="Motif"><Input value={move.reason} onChange={(event) => setMove({ ...move, reason: event.target.value })} /></Field>
              <Button
                disabled={!move.reason.trim()}
                onClick={() => {
                  const value = amountOf(move.amount);
                  if (value) run(call('cash.move', { type: move.type, amount: value, reason: move.reason.trim() }), () => setMove({ ...move, amount: '', reason: '' }));
                }}
              >
                Enregistrer
              </Button>
            </div>
            {current.movements.length > 0 && (
              <div className="mt-4">
                <DataTable
                  rows={current.movements}
                  rowKey={(row) => row.id}
                  empty=""
                  columns={[
                    { header: 'Heure', render: (row) => formatDateTime(row.occurredAt) },
                    { header: 'Type', render: (row) => movementLabels[row.type] ?? row.type },
                    { header: 'Motif', render: (row) => row.reason },
                    { header: 'Montant', align: 'right', render: (row) => money(row.amount) },
                  ]}
                />
              </div>
            )}
          </Card>
          <Card title="Fermeture de caisse">
            <div className="grid grid-cols-[12rem_1fr_auto] items-end gap-3">
              <Field label="Montant compté"><Input value={counted} onChange={(event) => setCounted(event.target.value)} /></Field>
              <Field label="Remarque (facultatif)"><Input value={note} onChange={(event) => setNote(event.target.value)} /></Field>
              <Button onClick={() => { const value = amountOf(counted); if (value !== null) run(call('cash.close', { counted: value, note: note.trim() || null }), () => { setCounted(''); setNote(''); }); }}>Fermer la caisse</Button>
            </div>
          </Card>
        </>
      )}
      <Card title="Rapports de caisse">
        <DataTable
          rows={history}
          rowKey={(row) => row.id}
          empty="Aucune caisse clôturée."
          columns={[
            { header: 'Ouverture', render: (row) => formatDateTime(row.openedAt) },
            { header: 'Fermeture', render: (row) => (row.closedAt ? formatDateTime(row.closedAt) : '') },
            { header: 'Attendu', align: 'right', render: (row) => money(row.expected) },
            { header: 'Compté', align: 'right', render: (row) => money(row.counted ?? 0n) },
            { header: 'Écart', align: 'right', render: (row) => ((row.difference ?? 0n) === 0n ? money(0n) : <Badge tone="danger">{money(row.difference ?? 0n)}</Badge>) },
          ]}
        />
      </Card>
    </div>
  );
}
