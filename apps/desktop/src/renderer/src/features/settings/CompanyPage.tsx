import { companyInputSchema, type CompanyInput } from '@gestion/contracts';
import { Alert, Button, Card } from '@gestion/ui';
import { useEffect, useState } from 'react';
import { call } from '../../lib/api';
import { useLoad } from '../../lib/useLoad';
import { CompanyFields } from '../setup/CompanyFields';

export function CompanyPage() {
  const { data, error, setError } = useLoad(() => call('company.get', undefined));
  const [form, setForm] = useState<CompanyInput | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!data) return;
    const { id: _id, sector: _sector, ...input } = data;
    setForm(input);
  }, [data]);

  if (!form) return error ? <Alert>{error}</Alert> : null;

  const save = () => {
    setSaved(false);
    setError(null);
    const parsed = companyInputSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Vérifiez les informations saisies.');
      return;
    }
    call('company.update', parsed.data).then(() => setSaved(true)).catch((cause: Error) => setError(cause.message));
  };

  return (
    <Card title="Informations de l'entreprise">
      <CompanyFields value={form} onChange={(next) => { setSaved(false); setForm(next); }} />
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      <div className="mt-5 flex items-center gap-3">
        <Button onClick={save}>Enregistrer</Button>
        {saved && <span role="status" className="text-sm text-success">Enregistré</span>}
      </div>
    </Card>
  );
}
