import type { Product, ProductInput } from '@gestion/contracts';
import { formatQuantity } from '@gestion/domain';
import { Alert, Badge, Button, Card, Checkbox, DataTable, Field, Input, Select } from '@gestion/ui';
import { useEffect, useState } from 'react';
import { call } from '../../lib/api';
import { tryAmount, tryQuantity } from '../../lib/format';
import { useCurrency } from '../../lib/useCurrency';
import { useLoad } from '../../lib/useLoad';

interface VariantForm {
  id: string | null;
  label: string;
  sku: string;
  barcode: string;
  purchasePrice: string;
  salePrice: string;
  initialQuantity: string;
}
const emptyVariant = (): VariantForm => ({ id: null, label: '', sku: '', barcode: '', purchasePrice: '', salePrice: '', initialQuantity: '' });

function ProductForm({ product, onDone }: { product: Product | null; onDone: () => void }) {
  const { currency, money } = useCurrency();
  const { data } = useLoad(() => Promise.all([call('categories.list', undefined), call('units.list', undefined), call('attributes.list', undefined)]));
  const [categories, units, attributes] = data ?? [[], [], []];
  const [name, setName] = useState(product?.name ?? '');
  const [reference, setReference] = useState(product?.reference ?? '');
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? '');
  const [unitId, setUnitId] = useState(product?.unitId ?? '');
  const [tax, setTax] = useState(product ? String(product.taxRateBp / 100) : '0');
  const [threshold, setThreshold] = useState(product?.lowStockThreshold != null ? formatQuantity(product.lowStockThreshold) : '');
  const [trackSerial, setTrackSerial] = useState(product?.trackSerial ?? false);
  const [values, setValues] = useState<Record<string, string>>(product?.attributes ?? {});
  const [variants, setVariants] = useState<VariantForm[]>(
    product?.variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      sku: variant.sku ?? '',
      barcode: variant.barcode ?? '',
      purchasePrice: String(variant.purchasePrice),
      salePrice: String(variant.salePrice),
      initialQuantity: '',
    })) ?? [emptyVariant()],
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!unitId && units[0]) setUnitId(units[0].id);
  }, [units, unitId]);

  const relevant = attributes.filter((attribute) => categoryId && attribute.categoryIds.includes(categoryId));
  const setVariant = (index: number, patch: Partial<VariantForm>) => setVariants(variants.map((row, position) => (position === index ? { ...row, ...patch } : row)));

  const save = () => {
    setError(null);
    const taxRate = Number(tax.replace(',', '.'));
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      setError('Taux de taxe invalide.');
      return;
    }
    const lowStock = threshold.trim() ? tryQuantity(threshold) : null;
    if (threshold.trim() && lowStock === null) {
      setError("Seuil d'alerte invalide.");
      return;
    }
    const rows: ProductInput['variants'] = [];
    for (const row of variants) {
      const purchasePrice = tryAmount(row.purchasePrice, currency);
      const salePrice = tryAmount(row.salePrice, currency);
      const initialQuantity = row.initialQuantity.trim() ? tryQuantity(row.initialQuantity) : 0n;
      if (purchasePrice === null || salePrice === null || purchasePrice < 0n || salePrice < 0n) {
        setError('Renseignez un prix d’achat et un prix de vente valides.');
        return;
      }
      if (initialQuantity === null) {
        setError('Quantité initiale invalide.');
        return;
      }
      rows.push({ id: row.id, label: row.label, sku: row.sku.trim() || null, barcode: row.barcode.trim() || null, purchasePrice, salePrice, initialQuantity });
    }
    call('products.save', {
      id: product?.id ?? null,
      name: name.trim(),
      reference: reference.trim() || null,
      categoryId: categoryId || null,
      unitId,
      taxRateBp: Math.round(taxRate * 100),
      trackSerial,
      lowStockThreshold: lowStock,
      attributes: Object.fromEntries(relevant.map((attribute) => [attribute.id, values[attribute.id] ?? ''])),
      variants: rows,
    })
      .then(onDone)
      .catch((cause: Error) => setError(cause.message));
  };

  return (
    <Card title={product ? 'Modifier le produit' : 'Nouveau produit'}>
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2"><Field label="Nom du produit"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field></div>
        <Field label="Référence"><Input value={reference} onChange={(event) => setReference(event.target.value)} /></Field>
        <Field label="Catégorie">
          <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">Sans catégorie</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </Select>
        </Field>
        <Field label="Unité">
          <Select value={unitId} onChange={(event) => setUnitId(event.target.value)}>
            {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </Select>
        </Field>
        <Field label="Taxe incluse (%)"><Input value={tax} onChange={(event) => setTax(event.target.value)} /></Field>
        <Field label="Seuil d'alerte" hint="Vide = seuil par défaut."><Input value={threshold} onChange={(event) => setThreshold(event.target.value)} /></Field>
        <div className="col-span-2 flex items-center pt-6">
          <Checkbox label="Suivi individuel (numéro de série ou IMEI)" checked={trackSerial} disabled={Boolean(product)} onChange={(event) => setTrackSerial(event.target.checked)} />
        </div>
      </div>

      {relevant.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="mb-3 text-sm font-semibold">Caractéristiques</h3>
          <div className="grid grid-cols-3 gap-4">
            {relevant.map((attribute) => {
              const value = values[attribute.id] ?? '';
              const set = (next: string) => setValues({ ...values, [attribute.id]: next });
              const label = `${attribute.name}${attribute.required ? ' *' : ''}`;
              if (attribute.type === 'BOOLEAN') return <div key={attribute.id} className="flex items-center pt-6"><Checkbox label={label} checked={value === 'true'} onChange={(event) => set(String(event.target.checked))} /></div>;
              return (
                <Field key={attribute.id} label={label}>
                  {attribute.type === 'SELECT' ? (
                    <Select value={value} onChange={(event) => set(event.target.value)}>
                      <option value="">Non renseigné</option>
                      {attribute.options.map((option) => <option key={option} value={option}>{option}</option>)}
                    </Select>
                  ) : (
                    <Input type={attribute.type === 'DATE' ? 'date' : 'text'} value={value} onChange={(event) => set(event.target.value)} />
                  )}
                </Field>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-5 border-t border-border pt-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Prix et variantes</h3>
          <Button variant="secondary" onClick={() => setVariants([...variants, emptyVariant()])}>Ajouter une variante</Button>
        </div>
        <ul className="flex flex-col gap-3">
          {variants.map((row, index) => {
            const purchase = tryAmount(row.purchasePrice, currency);
            const sale = tryAmount(row.salePrice, currency);
            return (
              <li key={row.id ?? `new-${index}`} className="grid grid-cols-6 items-start gap-2.5 rounded-md bg-canvas p-3">
                <Field label="Variante"><Input placeholder="Noir, 128 Go" value={row.label} onChange={(event) => setVariant(index, { label: event.target.value })} /></Field>
                <Field label="Code-barres"><Input value={row.barcode} onChange={(event) => setVariant(index, { barcode: event.target.value })} /></Field>
                <Field label="Prix d'achat"><Input value={row.purchasePrice} onChange={(event) => setVariant(index, { purchasePrice: event.target.value })} /></Field>
                <Field label="Prix de vente" hint={purchase !== null && sale !== null ? `Marge : ${money(sale - purchase)}` : undefined}><Input value={row.salePrice} onChange={(event) => setVariant(index, { salePrice: event.target.value })} /></Field>
                <Field label="Stock initial"><Input disabled={Boolean(row.id) || trackSerial} value={row.initialQuantity} onChange={(event) => setVariant(index, { initialQuantity: event.target.value })} /></Field>
                <div className="pt-6">
                  {variants.length > 1 && <Button variant="secondary" onClick={() => setVariants(variants.filter((_, position) => position !== index))}>Retirer</Button>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      <div className="mt-5 flex gap-2">
        <Button disabled={!name.trim() || !unitId} onClick={save}>Enregistrer le produit</Button>
        <Button variant="secondary" onClick={onDone}>Annuler</Button>
      </div>
    </Card>
  );
}

export function ProductsPage() {
  const { money } = useCurrency();
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [rows, setRows] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);

  const load = () => call('products.list', { search, categoryId: null, archived, lowOnly: false }).then(setRows).catch((cause: Error) => setError(cause.message));
  useEffect(() => {
    if (!editing) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, archived, editing]);

  if (editing) return <ProductForm product={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Input aria-label="Rechercher" placeholder="Rechercher un produit" className="max-w-sm" value={search} onChange={(event) => setSearch(event.target.value)} />
        <Checkbox label="Voir les archives" checked={archived} onChange={(event) => setArchived(event.target.checked)} />
        <span className="flex-1" />
        <Button onClick={() => setEditing('new')}>Nouveau produit</Button>
      </div>
      {error && <Alert>{error}</Alert>}
      <Card title="Produits">
        <DataTable<Product>
          rows={rows}
          rowKey={(row) => row.id}
          empty="Aucun produit."
          columns={[
            { header: 'Nom', render: (row) => <><span className="font-medium">{row.name}</span>{row.reference && <span className="block text-xs text-muted">{row.reference}</span>}</> },
            { header: 'Catégorie', render: (row) => row.categoryName ?? '' },
            { header: 'Variantes', render: (row) => row.variants.map((variant) => variant.label).filter(Boolean).join(', ') },
            { header: 'Prix', align: 'right', render: (row) => money(row.variants[0]?.salePrice ?? 0n) },
            {
              header: 'Stock',
              align: 'right',
              render: (row) => {
                const total = row.variants.reduce((sum, variant) => sum + variant.quantity, 0n);
                return row.variants.some((variant) => variant.isLow) ? <Badge tone="danger">{formatQuantity(total)} {row.unitSymbol}</Badge> : `${formatQuantity(total)} ${row.unitSymbol}`;
              },
            },
            {
              header: 'Actions',
              align: 'right',
              render: (row) => (
                <div className="flex justify-end gap-2">
                  {!row.archived && <Button variant="secondary" onClick={() => setEditing(row)}>Modifier</Button>}
                  <Button variant="secondary" onClick={() => call('products.setArchived', { id: row.id, archived: !row.archived }).then(load).catch((cause: Error) => setError(cause.message))}>
                    {row.archived ? 'Restaurer' : 'Archiver'}
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
