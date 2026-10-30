import type { Report, ReportKind } from '@gestion/contracts';
import { formatQuantity } from '@gestion/domain';
import { Alert, Button, Card, DataTable, Field, Select } from '@gestion/ui';
import { useEffect, useState } from 'react';
import { call } from '../../lib/api';
import { usePeriod } from '../../lib/period';
import { useLicense } from '../../lib/license';
import { useCurrency } from '../../lib/useCurrency';

const advanced: ReportKind[] = ['salesByEmployee', 'margins', 'topProducts', 'cash'];
const kinds: { value: ReportKind; label: string }[] = [
  { value: 'salesByStore', label: 'Performances par boutique' },
  { value: 'dailySales', label: 'Ventes quotidiennes' },
  { value: 'monthlySales', label: 'Ventes mensuelles' },
  { value: 'salesByEmployee', label: 'Ventes par employé' },
  { value: 'salesByProduct', label: 'Ventes par produit' },
  { value: 'topProducts', label: 'Produits les plus vendus' },
  { value: 'expenses', label: 'Dépenses' },
  { value: 'receivables', label: 'Créances' },
  { value: 'stock', label: 'État des stocks' },
  { value: 'margins', label: 'Marges estimées' },
  { value: 'cash', label: 'Résultats de caisse' },
];

export function ReportsPage() {
  const { money } = useCurrency();
  const { period, control } = usePeriod('month');
  const { license } = useLicense();
  const has = (feature: string) => license?.features.includes(feature) ?? false;
  const available = kinds.filter((item) => (item.value !== 'salesByStore' || has('consolidated')) && (!advanced.includes(item.value) || has('advanced_reports')));
  const [kind, setKind] = useState<ReportKind>('dailySales');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!period) return;
    let active = true;
    setError(null);
    call('reports.run', { kind, period }).then((next) => { if (active) setReport(next); }).catch((cause: Error) => setError(cause.message));
    return () => { active = false; };
  }, [kind, period]);

  const cell = (value: string | bigint | undefined, type: string) =>
    typeof value === 'bigint' ? (type === 'money' ? money(value) : formatQuantity(value)) : value ?? '';

  const exportAs = (format: 'csv' | 'xlsx' | 'pdf') => {
    if (!period) return;
    setSaved(null);
    setError(null);
    call('reports.export', { kind, period, format })
      .then(({ path }) => { if (path) setSaved(`Enregistré : ${path}`); })
      .catch((cause: Error) => setError(cause.message));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-64"><Field label="Rapport"><Select value={kind} onChange={(event) => setKind(event.target.value as ReportKind)}>{available.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field></div>
        {control}
      </div>
      {error && <Alert>{error}</Alert>}
      {report && (
        <Card title={report.title}>
          <DataTable
            rows={report.totals ? [...report.rows, report.totals] : report.rows}
            rowKey={(row) => report.columns.map((column) => String(row[column.key])).join('|') + (row === report.totals ? 'total' : '')}
            empty="Aucune donnée sur cette période."
            columns={report.columns.map((column) => ({
              header: column.label,
              ...(column.kind === 'text' ? {} : { align: 'right' as const }),
              render: (row: Report['rows'][number]) => (row === report.totals ? <strong>{cell(row[column.key], column.kind)}</strong> : cell(row[column.key], column.kind)),
            }))}
          />
          <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
            {has('export_files') && <Button variant="secondary" onClick={() => exportAs('pdf')}>Exporter en PDF</Button>}
            {has('export_files') && <Button variant="secondary" onClick={() => exportAs('xlsx')}>Exporter en Excel</Button>}
            <Button variant="secondary" onClick={() => exportAs('csv')}>Exporter en CSV</Button>
            {saved && <span role="status" className="ml-2 min-w-0 truncate text-sm text-success">{saved}</span>}
          </div>
        </Card>
      )}
    </div>
  );
}
