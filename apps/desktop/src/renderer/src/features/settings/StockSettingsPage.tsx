import type { StockSettings } from '@gestion/contracts';
import { Alert, Button, Card, Checkbox, Field, Input } from '@gestion/ui';
import { useEffect, useState } from 'react';
import { call } from '../../lib/api';
import { useLoad } from '../../lib/useLoad';

export function StockSettingsPage() {
  const { data, error, setError } = useLoad(() => call('stockSettings.get', undefined));
  const [form, setForm] = useState<StockSettings | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (data) setForm(data); }, [data]);
  if (!form) return error ? <Alert>{error}</Alert> : null;

  return (
    <Card title="Paramètres de stock">
      <div className="flex max-w-sm flex-col gap-4">
        <Field label="Seuil d'alerte par défaut">
          <Input
            type="number"
            min={0}
            value={form.lowStockThreshold}
            onChange={(event) => { setSaved(false); setForm({ ...form, lowStockThreshold: Math.max(0, Math.trunc(Number(event.target.value))) }); }}
          />
        </Field>
        <Checkbox
          label="Autoriser les ventes hors stock"
          checked={form.allowOutOfStockSales}
          onChange={(event) => { setSaved(false); setForm({ ...form, allowOutOfStockSales: event.target.checked }); }}
        />
      </div>
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      <div className="mt-5 flex items-center gap-3">
        <Button onClick={() => { setError(null); call('stockSettings.save', form).then(() => setSaved(true)).catch((cause: Error) => setError(cause.message)); }}>Enregistrer</Button>
        {saved && <span role="status" className="text-sm text-success">Enregistré</span>}
      </div>
    </Card>
  );
}
