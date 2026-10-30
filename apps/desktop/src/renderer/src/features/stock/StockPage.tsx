import type { InventoryCount, Product } from '@gestion/contracts';
import { formatQuantity } from '@gestion/domain';
import { Alert, Badge, Button, Card, Checkbox, DataTable, Field, Input, Select, SegmentedControl } from '@gestion/ui';
import { useEffect, useState } from 'react';
import { call } from '../../lib/api';
import { formatDateTime, movementLabels, tryAmount, tryQuantity } from '../../lib/format';
import { useCurrency } from '../../lib/useCurrency';
import { useLoad } from '../../lib/useLoad';

function LevelsTab() {
  const { currency } = useCurrency();
  const [lowOnly, setLowOnly] = useState(false);
  const [rows, setRows] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ variantId: '', direction: 'IN' as 'IN' | 'OUT', quantity: '', unitCost: '', reason: '', serials: '' });

  const load = () => call('products.list', { search: '', categoryId: null, archived: false, lowOnly }).then(setRows).catch((cause: Error) => setError(cause.message));
  useEffect(() => void load(), [lowOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = rows.flatMap((product) => product.variants.map((variant) => ({ ...variant, product })));
  const selected = options.find((option) => option.id === form.variantId);

  const submit = () => {
    setError(null);
    setSaved(false);
    const serials = form.serials.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
    const quantity = selected?.product.trackSerial ? BigInt(serials.length) * 1000n : tryQuantity(form.quantity);
    if (!selected || !quantity) {
      setError(selected?.product.trackSerial ? 'Saisissez au moins un numéro de série.' : 'Choisissez un produit et une quantité valide.');
      return;
    }
    const unitCost = form.unitCost.trim() ? tryAmount(form.unitCost, currency) : null;
    if (form.unitCost.trim() && unitCost === null) {
      setError("Coût d'achat invalide.");
      return;
    }
    call('stock.move', { variantId: selected.id, direction: form.direction, quantity, unitCost, reason: form.reason, serials })
      .then(() => {
        setSaved(true);
        setForm({ ...form, quantity: '', unitCost: '', reason: '', serials: '' });
        return load();
      })
      .catch((cause: Error) => setError(cause.message));
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      <Card title="Entrée ou sortie de stock">
        <div className="grid grid-cols-4 items-start gap-3">
          <div className="col-span-2">
            <Field label="Produit">
              <Select value={form.variantId} onChange={(event) => setForm({ ...form, variantId: event.target.value })}>
                <option value="">Choisir</option>
                {options.map((option) => <option key={option.id} value={option.id}>{option.product.name} {option.label}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Opération">
            <Select value={form.direction} onChange={(event) => setForm({ ...form, direction: event.target.value as 'IN' | 'OUT' })}>
              <option value="IN">Entrée</option>
              <option value="OUT">Sortie</option>
            </Select>
          </Field>
          {selected?.product.trackSerial ? (
            <Field label="Numéros de série" hint="Séparés par un espace ou une virgule.">
              <Input value={form.serials} onChange={(event) => setForm({ ...form, serials: event.target.value })} />
            </Field>
          ) : (
            <Field label="Quantité"><Input value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field>
          )}
          <div className="col-span-2"><Field label="Motif"><Input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></Field></div>
          {form.direction === 'IN' && <Field label="Coût d'achat unitaire (facultatif)" hint="Met à jour le prix d'achat."><Input value={form.unitCost} onChange={(event) => setForm({ ...form, unitCost: event.target.value })} /></Field>}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button disabled={!form.reason.trim()} onClick={submit}>Enregistrer</Button>
          {saved && <span role="status" className="text-sm text-success">Enregistré</span>}
        </div>
      </Card>
      <Card title="État du stock">
        <div className="mb-3"><Checkbox label="Stock faible uniquement" checked={lowOnly} onChange={(event) => setLowOnly(event.target.checked)} /></div>
        <DataTable
          rows={options.filter((option) => !lowOnly || option.isLow)}
          rowKey={(option) => option.id}
          empty="Aucun produit à afficher."
          columns={[
            { header: 'Produit', render: (option) => `${option.product.name} ${option.label}` },
            { header: 'Quantité', align: 'right', render: (option) => (option.isLow ? <Badge tone="danger">{formatQuantity(option.quantity)} {option.product.unitSymbol}</Badge> : `${formatQuantity(option.quantity)} ${option.product.unitSymbol}`) },
          ]}
        />
      </Card>
    </div>
  );
}

function MovementsTab() {
  const { data, error } = useLoad(() => call('stock.movements', { variantId: null }));
  return (
    <Card title="Derniers mouvements">
      {error && <Alert>{error}</Alert>}
      <DataTable
        rows={data ?? []}
        rowKey={(row) => row.id}
        empty="Aucun mouvement."
        columns={[
          { header: 'Date', render: (row) => formatDateTime(row.occurredAt) },
          { header: 'Produit', render: (row) => `${row.productName} ${row.variantLabel}` },
          { header: 'Type', render: (row) => movementLabels[row.type] ?? row.type },
          { header: 'Motif', render: (row) => row.reason ?? '' },
          { header: 'Quantité', align: 'right', render: (row) => formatQuantity(row.quantity) },
        ]}
      />
    </Card>
  );
}

function InventoryTab() {
  const { data, error, reload, setError } = useLoad(() => call('inventory.current', undefined));
  const [result, setResult] = useState<string | null>(null);
  const count: InventoryCount | null = data ?? null;
  const run = (action: Promise<unknown>) => {
    setError(null);
    action.then(reload).catch((cause: Error) => setError(cause.message));
  };
  if (!count) {
    return (
      <Card title="Inventaire">
        {error && <div className="mb-3"><Alert>{error}</Alert></div>}
        {result && <p role="status" className="mb-3 text-sm text-success">{result}</p>}
        <p className="mb-3 text-sm text-muted">Comptez vos articles et corrigez les écarts. Les articles à numéro de série se contrôlent par leurs numéros.</p>
        <Button onClick={() => { setResult(null); run(call('inventory.start', undefined)); }}>Démarrer un inventaire</Button>
      </Card>
    );
  }
  return (
    <Card title={`Inventaire du ${formatDateTime(count.startedAt)}`}>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      <DataTable
        rows={count.lines}
        rowKey={(line) => line.id}
        empty="Aucun article à compter."
        columns={[
          { header: 'Produit', render: (line) => `${line.productName} ${line.variantLabel}` },
          { header: 'Théorique', align: 'right', render: (line) => formatQuantity(line.expected) },
          {
            header: 'Compté',
            align: 'right',
            render: (line) => (
              <Input
                aria-label={`Quantité comptée de ${line.productName}`}
                className="ml-auto w-24! text-right"
                defaultValue={line.counted === null ? '' : formatQuantity(line.counted)}
                onBlur={(event) => {
                  const text = event.target.value.trim();
                  const counted = text ? tryQuantity(text) : null;
                  if (text && counted === null) {
                    setError(`Quantité invalide pour ${line.productName}.`);
                    return;
                  }
                  run(call('inventory.setCounted', { lineId: line.id, counted }));
                }}
              />
            ),
          },
        ]}
      />
      <div className="mt-4">
        <Button onClick={() => { setError(null); call('inventory.close', undefined).then(({ adjusted }) => { setResult(`Inventaire clôturé : ${adjusted} écart(s) corrigé(s).`); return reload(); }).catch((cause: Error) => setError(cause.message)); }}>
          Clôturer l'inventaire
        </Button>
      </div>
    </Card>
  );
}

export function StockPage() {
  const [tab, setTab] = useState<'levels' | 'movements' | 'inventory'>('levels');
  return (
    <div className="flex flex-col gap-4">
      <div>
        <SegmentedControl
          label="Vue du stock"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'levels', label: 'État du stock' },
            { value: 'movements', label: 'Mouvements' },
            { value: 'inventory', label: 'Inventaire' },
          ]}
        />
      </div>
      {tab === 'levels' && <LevelsTab />}
      {tab === 'movements' && <MovementsTab />}
      {tab === 'inventory' && <InventoryTab />}
    </div>
  );
}
