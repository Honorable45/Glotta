import type { Dashboard } from '@gestion/contracts';
import { formatQuantity } from '@gestion/domain';
import { Alert, Button, Card, Checkbox, DataTable } from '@gestion/ui';
import { useEffect, useState } from 'react';
import { call } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { usePeriod } from '../../lib/period';
import { useCurrency } from '../../lib/useCurrency';
import { useLoad } from '../../lib/useLoad';

const widgets = [
  { key: 'revenueToday', label: "Chiffre d'affaires du jour" },
  { key: 'revenueMonth', label: "Chiffre d'affaires du mois" },
  { key: 'revenue', label: "Chiffre d'affaires de la période" },
  { key: 'collections', label: 'Encaissements' },
  { key: 'salesCount', label: 'Nombre de ventes' },
  { key: 'margin', label: 'Marge estimée' },
  { key: 'expenses', label: 'Dépenses' },
  { key: 'profit', label: 'Bénéfice estimé' },
  { key: 'receivables', label: 'Créances clients' },
  { key: 'trend', label: 'Évolution des ventes' },
  { key: 'recent', label: 'Dernières ventes' },
  { key: 'lowStock', label: 'Stock faible' },
] as const;

/** Une seule série : une colonne par période, sans légende, avec infobulle au survol. */
function TrendChart({ points, money }: { points: Dashboard['trend']; money: (value: bigint) => string }) {
  const [active, setActive] = useState<number | null>(null);
  if (points.length === 0) return <p className="py-10 text-center text-sm text-muted">Aucune vente sur cette période.</p>;
  const max = points.reduce((highest, point) => (point.revenue > highest ? point.revenue : highest), 1n);
  const height = (value: bigint) => (value <= 0n ? 0 : Math.max(2, Number((value * 1000n) / max) / 10));
  const shown = active === null ? null : points[active];
  return (
    <figure className="m-0">
      <p aria-live="polite" className="mb-2 h-5 text-xs tabular-nums text-muted">
        {shown ? `${shown.label} : ${money(shown.revenue)}` : `Maximum : ${money(max)}`}
      </p>
      <div className="flex h-40 items-end gap-0.5 border-b border-border" onMouseLeave={() => setActive(null)}>
        {points.map((point, index) => (
          <button
            key={point.label}
            type="button"
            aria-label={`${point.label} : ${money(point.revenue)}`}
            className="flex h-full min-w-0 max-w-14 flex-1 items-end focus-visible:outline-offset-0"
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
          >
            <span
              className={`block w-full rounded-t ${active === index ? 'bg-primary-hover' : 'bg-primary'}`}
              style={{ height: `${height(point.revenue)}%` }}
            />
          </button>
        ))}
      </div>
      <figcaption className="mt-1.5 flex justify-between text-xs text-muted">
        <span>{points[0]!.label}</span>
        {points.length > 1 && <span>{points[points.length - 1]!.label}</span>}
      </figcaption>
    </figure>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function DashboardPage() {
  const { money } = useCurrency();
  const { period, control } = usePeriod('month');
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const hiddenState = useLoad(() => call('dashboard.getHidden', undefined));
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => { if (hiddenState.data) setHidden(hiddenState.data); }, [hiddenState.data]);

  useEffect(() => {
    if (!period) return;
    let active = true;
    setError(null);
    call('dashboard.get', period).then((next) => { if (active) setData(next); }).catch((cause: Error) => setError(cause.message));
    return () => { active = false; };
  }, [period]);

  const visible = (key: string) => !hidden.includes(key);
  const toggle = (key: string, on: boolean) => {
    const next = on ? hidden.filter((item) => item !== key) : [...hidden, key];
    setHidden(next);
    call('dashboard.setHidden', { hidden: next }).catch((cause: Error) => setError(cause.message));
  };

  const stats: { key: string; label: string; value: string; hint?: string }[] = data
    ? [
        { key: 'revenueToday', label: "Chiffre d'affaires du jour", value: money(data.revenueToday) },
        { key: 'revenueMonth', label: "Chiffre d'affaires du mois", value: money(data.revenueMonth) },
        { key: 'revenue', label: "Chiffre d'affaires de la période", value: money(data.revenue), hint: 'Ventes nettes des retours' },
        { key: 'collections', label: 'Encaissements', value: money(data.collections), hint: 'Argent réellement reçu' },
        { key: 'salesCount', label: 'Nombre de ventes', value: String(data.salesCount) },
        ...(data.margin === null ? [] : [{ key: 'margin', label: 'Marge estimée', value: money(data.margin), hint: "Ventes moins coût d'achat" }]),
        { key: 'expenses', label: 'Dépenses', value: money(data.expenses) },
        ...(data.profit === null ? [] : [{ key: 'profit', label: 'Bénéfice estimé', value: money(data.profit), hint: 'Marge moins dépenses' }]),
        { key: 'receivables', label: 'Créances clients', value: money(data.receivables), hint: 'Total restant dû' },
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {control}
        <Button variant="secondary" onClick={() => setCustomizing(!customizing)}>Personnaliser</Button>
      </div>
      {!period && <p className="text-sm text-muted">Choisissez une date de début et une date de fin.</p>}
      {error && <Alert>{error}</Alert>}
      {customizing && (
        <Card title="Éléments affichés">
          <div className="grid grid-cols-3 gap-2">
            {widgets.map((widget) => (
              <Checkbox key={widget.key} label={widget.label} checked={visible(widget.key)} onChange={(event) => toggle(widget.key, event.target.checked)} />
            ))}
          </div>
        </Card>
      )}
      {data && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {stats.filter((stat) => visible(stat.key)).map((stat) => (
              <Stat key={stat.key} label={stat.label} value={stat.value} {...(stat.hint ? { hint: stat.hint } : {})} />
            ))}
          </div>
          {visible('trend') && <Card title="Évolution du chiffre d'affaires"><TrendChart points={data.trend} money={money} /></Card>}
          <div className="grid grid-cols-2 items-start gap-4">
            {visible('recent') && (
              <Card title="Dernières ventes">
                <DataTable
                  rows={data.recentSales}
                  rowKey={(sale) => sale.id}
                  empty="Aucune vente."
                  columns={[
                    { header: 'Numéro', render: (sale) => sale.number },
                    { header: 'Date', render: (sale) => formatDateTime(sale.occurredAt) },
                    { header: 'Total', align: 'right', render: (sale) => money(sale.netTotal) },
                  ]}
                />
              </Card>
            )}
            {visible('lowStock') && (
              <Card title="Stock faible">
                <DataTable
                  rows={data.lowStock}
                  rowKey={(item) => item.id}
                  empty="Aucun produit en stock faible."
                  columns={[
                    { header: 'Produit', render: (item) => item.name },
                    { header: 'Quantité', align: 'right', render: (item) => `${formatQuantity(item.quantity)} ${item.unitSymbol}` },
                  ]}
                />
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
