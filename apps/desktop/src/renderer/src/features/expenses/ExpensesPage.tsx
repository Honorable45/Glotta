import type { ExpenseItem } from '@gestion/contracts';
import { Alert, Badge, Button, Card, Checkbox, DataTable, Field, Input, Select } from '@gestion/ui';
import { useEffect, useState } from 'react';
import { call } from '../../lib/api';
import { tryAmount } from '../../lib/format';
import { usePeriod } from '../../lib/period';
import { useCurrency } from '../../lib/useCurrency';
import { useLoad } from '../../lib/useLoad';

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

export function ExpensesPage() {
  const { currency, money } = useCurrency();
  const { period, control } = usePeriod('month');
  const categories = useLoad(() => call('expenseCategories.list', undefined));
  const [rows, setRows] = useState<ExpenseItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const empty = { label: '', categoryId: '', amount: '', date: today(), comment: '', paidFromCash: false };
  const [form, setForm] = useState(empty);
  const [newCategory, setNewCategory] = useState('');
  const activeCategory = form.categoryId || categories.data?.[0]?.id || '';

  const load = () => { if (period) call('expenses.list', period).then(setRows).catch((cause: Error) => setError(cause.message)); };
  useEffect(load, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    setError(null);
    const amount = tryAmount(form.amount, currency);
    if (!amount || amount <= 0n) {
      setError('Montant invalide.');
      return;
    }
    call('expenses.create', { label: form.label.trim(), categoryId: activeCategory, amount, date: form.date, comment: form.comment.trim() || null, paidFromCash: form.paidFromCash })
      .then(() => { setForm(empty); load(); })
      .catch((cause: Error) => setError(cause.message));
  };

  const total = rows.filter((row) => !row.voidedAt).reduce((sum, row) => sum + row.amount, 0n);

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      <Card title="Nouvelle dépense">
        <div className="grid grid-cols-4 gap-3">
          <Field label="Libellé"><Input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} /></Field>
          <Field label="Catégorie">
            <Select value={activeCategory} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
              {(categories.data ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
          </Field>
          <Field label="Montant"><Input value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></Field>
          <Field label="Date"><Input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field>
          <div className="col-span-2"><Field label="Commentaire (facultatif)"><Input value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} /></Field></div>
          <div className="col-span-2 flex items-center pt-6"><Checkbox label="Payée avec l'argent de la caisse" checked={form.paidFromCash} onChange={(event) => setForm({ ...form, paidFromCash: event.target.checked })} /></div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button disabled={!form.label.trim() || !activeCategory} onClick={save}>Enregistrer</Button>
          <span className="flex-1" />
          <Input aria-label="Nouvelle catégorie de dépense" placeholder="Nouvelle catégorie" className="w-56!" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} />
          <Button
            variant="secondary"
            disabled={!newCategory.trim()}
            onClick={() => call('expenseCategories.save', { id: null, name: newCategory.trim() }).then(() => { setNewCategory(''); return categories.reload(); }).catch((cause: Error) => setError(cause.message))}
          >
            Ajouter la catégorie
          </Button>
        </div>
      </Card>
      {control}
      <Card title={`Dépenses : ${money(total)}`}>
        <DataTable<ExpenseItem>
          rows={rows}
          rowKey={(row) => row.id}
          empty="Aucune dépense sur cette période."
          columns={[
            { header: 'Date', render: (row) => row.date },
            { header: 'Libellé', render: (row) => <>{row.label}{row.comment && <span className="block text-xs text-muted">{row.comment}</span>}</> },
            { header: 'Catégorie', render: (row) => row.categoryName },
            { header: 'Montant', align: 'right', render: (row) => money(row.amount) },
            {
              header: 'Actions',
              align: 'right',
              render: (row) => row.voidedAt
                ? <Badge tone="danger">Annulée</Badge>
                : <Button variant="secondary" onClick={() => call('expenses.void', { id: row.id, reason: 'Annulée par l’utilisateur' }).then(load).catch((cause: Error) => setError(cause.message))}>Annuler</Button>,
            },
          ]}
        />
      </Card>
    </div>
  );
}
