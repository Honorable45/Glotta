import type { PosItem, SaleSummary } from '@gestion/contracts';
import { computeSale, formatQuantity, newId } from '@gestion/domain';
import { Alert, Button, Field, Input, Select } from '@gestion/ui';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { call } from '../../lib/api';
import { tryAmount, tryQuantity } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useCurrency } from '../../lib/useCurrency';
import { useLoad } from '../../lib/useLoad';

interface CartLine {
  item: PosItem;
  quantity: string;
  discount: string;
  serialIds: string[];
  serials: { id: string; serial: string }[];
}

export function PosPage() {
  const { currency, money } = useCurrency();
  const { can } = useSession();
  const { data: options } = useLoad(() => Promise.all([call('paymentMethods.list', undefined), call('customers.list', { search: '' }), call('stockSettings.get', undefined)]));
  const methods = (options?.[0] ?? []).filter((method) => method.isActive);
  const customers = options?.[1] ?? [];
  const allowOutOfStock = options?.[2]?.allowOutOfStockSales ?? false;

  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PosItem[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartDiscount, setCartDiscount] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [methodId, setMethodId] = useState('');
  const [received, setReceived] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<SaleSummary | null>(null);
  // Conservé jusqu'au succès : un nouvel essai après une erreur réseau ou un double clic reste la même vente.
  const saleId = useRef(newId());

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      call('pos.search', { query }).then((items) => { if (active) setResults(items); }).catch((cause: Error) => setError(cause.message));
    }, query.trim() ? 100 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, reloadKey]);

  const activeMethod = methodId || methods[0]?.id || '';

  const totals = useMemo(() => {
    try {
      const discount = cartDiscount.trim() ? tryAmount(cartDiscount, currency) : 0n;
      if (discount === null) return { error: 'Remise invalide.' };
      const lines = cart.map((line) => {
        const quantity = tryQuantity(line.quantity);
        const lineDiscount = line.discount.trim() ? tryAmount(line.discount, currency) : 0n;
        if (!quantity || lineDiscount === null) throw new Error(`Vérifiez la ligne ${line.item.productName}.`);
        return { quantity, lineDiscount, unitPrice: line.item.salePrice, taxRateBp: 0 };
      });
      return { value: computeSale(lines, discount) };
    } catch (cause) {
      return { error: (cause as Error).message };
    }
  }, [cart, cartDiscount, currency]);

  const total = totals.value?.total ?? 0n;
  const receivedAmount = received.trim() ? tryAmount(received, currency) : total;
  const paid = receivedAmount !== null && receivedAmount < total ? receivedAmount : total;
  const change = receivedAmount !== null && receivedAmount > total ? receivedAmount - total : 0n;
  const remaining = total - paid;

  async function addItem(item: PosItem) {
    setError(null);
    searchRef.current?.focus();
    if (item.quantity <= 0n && !allowOutOfStock) {
      setError(`Stock insuffisant pour ${item.productName} : il n'en reste plus.`);
      return;
    }
    if (item.trackSerial) {
      const serials = await call('stock.availableSerials', { variantId: item.variantId });
      if (serials.length === 0) {
        setError(`Aucun numéro de série disponible pour ${item.productName}.`);
        return;
      }
      const preselected = item.matchedSerialId ?? (serials.length === 1 ? serials[0]!.id : null);
      setCart((lines) => {
        const existing = lines.find((line) => line.item.variantId === item.variantId);
        if (!existing) {
          const serialIds = preselected ? [preselected] : [];
          return [...lines, { item, quantity: String(serialIds.length), discount: '', serialIds, serials }];
        }
        if (!preselected || existing.serialIds.includes(preselected)) return lines;
        const serialIds = [...existing.serialIds, preselected];
        return lines.map((line) => (line === existing ? { ...line, serialIds, quantity: String(serialIds.length) } : line));
      });
      return;
    }
    // Mise à jour fonctionnelle : deux scans rapides lisent chacun le panier le plus récent.
    setCart((lines) => {
      const existing = lines.find((line) => line.item.variantId === item.variantId);
      if (!existing) return [...lines, { item, quantity: '1', discount: '', serialIds: [], serials: [] }];
      const next = (tryQuantity(existing.quantity) ?? 0n) + 1000n;
      return lines.map((line) => (line === existing ? { ...line, quantity: formatQuantity(next) } : line));
    });
  }

  function step(line: CartLine, delta: bigint) {
    const next = (tryQuantity(line.quantity) ?? 0n) + delta;
    setCart((lines) => (next <= 0n ? lines.filter((other) => other !== line) : lines.map((other) => (other === line ? { ...other, quantity: formatQuantity(next) } : other))));
  }

  function updateSerials(variantId: string, serialIds: string[]) {
    setCart((lines) => lines.map((line) => (line.item.variantId === variantId ? { ...line, serialIds, quantity: String(serialIds.length) } : line)));
  }

  function reset() {
    setCart([]);
    setCartDiscount('');
    setCustomerId('');
    setDueDate('');
    setReceived('');
    setShowOptions(false);
    setError(null);
    setQuery('');
    setReloadKey((key) => key + 1);
    saleId.current = newId();
    searchRef.current?.focus();
  }

  function validate() {
    setError(null);
    if (!totals.value) {
      setError(totals.error ?? 'Vérifiez le panier.');
      return;
    }
    if (receivedAmount === null) {
      setError('Montant reçu invalide. Écrivez seulement des chiffres.');
      return;
    }
    if (remaining > 0n && !customerId) {
      setError('Le client doit encore payer : choisissez son nom pour noter sa dette.');
      return;
    }
    if (paid > 0n && !activeMethod) {
      setError('Aucun mode de paiement actif.');
      return;
    }
    setSaving(true);
    call('sales.create', {
      id: saleId.current,
      customerId: customerId || null,
      cartDiscount: cartDiscount.trim() ? tryAmount(cartDiscount, currency)! : 0n,
      dueDate: remaining > 0n && dueDate ? dueDate : null,
      lines: cart.map((line) => ({
        variantId: line.item.variantId,
        quantity: tryQuantity(line.quantity)!,
        lineDiscount: line.discount.trim() ? tryAmount(line.discount, currency)! : 0n,
        unitPrice: null,
        serialIds: line.serialIds,
      })),
      payments: paid > 0n ? [{ methodId: activeMethod, amount: paid }] : [],
    })
      .then((sale) => {
        setDone(sale);
        reset();
      })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setSaving(false));
  }

  const print = (format: 'thermal' | 'a4') => {
    if (done) call('sales.print', { saleId: done.id, format }).catch((cause: Error) => setError(cause.message));
  };

  const message = error ?? (cart.length > 0 ? totals.error : null);
  const items = results ?? [];

  return (
    <div className="grid grid-cols-[1fr_24rem] items-start gap-5">
      <div className="flex min-w-0 flex-col gap-3">
        <Input
          ref={searchRef}
          autoFocus
          aria-label="Rechercher un produit"
          placeholder="Chercher un produit ou scanner"
          className="h-11! text-base"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            // Un scanner tape le code puis Entrée, parfois plusieurs fois de suite : le champ est vidé
            // tout de suite pour que la réponse d'un scan n'efface jamais le code du suivant.
            const code = event.currentTarget.value;
            if (!code.trim()) return;
            setQuery('');
            call('pos.search', { query: code }).then((found) => {
              const target = found.find((item) => item.exactMatch) ?? (found.length === 1 ? found[0] : undefined);
              if (target) return addItem(target);
              setQuery(code);
              setResults(found);
              return undefined;
            }).catch((cause: Error) => setError(cause.message));
          }}
        />
        {items.length > 0 && (
          <ul aria-label="Résultats" className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2.5">
            {items.map((item) => {
              const empty = item.quantity <= 0n;
              return (
                <li key={item.variantId}>
                  <button type="button" className="flex h-full w-full flex-col gap-1 rounded-lg border border-border bg-surface p-3.5 text-left hover:border-primary hover:bg-canvas" onClick={() => { setQuery(''); void addItem(item); }}>
                    <span className="font-medium">{item.productName}</span>
                    {item.variantLabel && <span className="text-sm text-muted">{item.variantLabel}</span>}
                    <span className="mt-auto pt-1 text-base font-semibold tabular-nums">{money(item.salePrice)}</span>
                    <span className={`text-xs ${empty ? 'font-medium text-danger' : 'text-muted'}`}>{empty ? 'Plus de stock' : `Reste : ${formatQuantity(item.quantity)} ${item.unitSymbol}`}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {results !== null && items.length === 0 && (query.trim()
          ? <p className="px-1 text-sm text-muted">Aucun produit trouvé.</p>
          : (
            <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center">
              <p className="mb-3 text-sm text-muted">Aucun produit pour le moment.</p>
              {can('manage_products') && <Link className="font-medium text-primary underline" to="/produits">Ajouter un produit</Link>}
            </div>
          ))}
      </div>

      <aside aria-label="Paiement" className="flex flex-col gap-3.5 rounded-lg border border-border bg-surface p-4">
        <section aria-label="Panier">
          <h2 className="mb-2 text-sm font-semibold">Panier</h2>
          {cart.length === 0 && <p className="py-4 text-center text-sm text-muted">Cliquez sur un produit pour l'ajouter.</p>}
          <ul className="divide-y divide-border">
            {cart.map((line) => {
              const quantity = tryQuantity(line.quantity);
              return (
                <li key={line.item.variantId} className="py-2.5">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 text-sm font-medium">{line.item.productName}{line.item.variantLabel && ` · ${line.item.variantLabel}`}</p>
                    <button type="button" aria-label={`Retirer ${line.item.productName}`} className="rounded p-1 text-muted hover:text-danger" onClick={() => setCart((lines) => lines.filter((other) => other !== line))}>
                      <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                    </button>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {!line.item.trackSerial && <button type="button" aria-label={`Enlever un ${line.item.productName}`} className="flex size-9 items-center justify-center rounded-md border border-border hover:bg-canvas" onClick={() => step(line, -1000n)}><Minus size={16} aria-hidden /></button>}
                    <Input
                      aria-label={`Quantité de ${line.item.productName}`}
                      className="w-16! shrink-0 text-center"
                      disabled={line.item.trackSerial}
                      value={line.quantity}
                      onChange={(event) => setCart((lines) => lines.map((other) => (other === line ? { ...other, quantity: event.target.value } : other)))}
                    />
                    {!line.item.trackSerial && <button type="button" aria-label={`Ajouter un ${line.item.productName}`} className="flex size-9 items-center justify-center rounded-md border border-border hover:bg-canvas" onClick={() => step(line, 1000n)}><Plus size={16} aria-hidden /></button>}
                    <span className="ml-auto text-sm font-medium tabular-nums">{quantity ? money((line.item.salePrice * quantity) / 1000n) : ''}</span>
                  </div>
                  {showOptions && can('discount') && (
                    <Input
                      aria-label={`Remise sur ${line.item.productName}`}
                      placeholder="Remise sur ce produit"
                      className="mt-1.5"
                      value={line.discount}
                      onChange={(event) => setCart((lines) => lines.map((other) => (other === line ? { ...other, discount: event.target.value } : other)))}
                    />
                  )}
                  {line.item.trackSerial && (
                    <fieldset className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                      <legend className="mb-1 text-xs text-muted">Numéros de série vendus</legend>
                      {line.serials.map((serial) => (
                        <label key={serial.id} className="flex items-center gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            className="accent-primary"
                            checked={line.serialIds.includes(serial.id)}
                            onChange={(event) => updateSerials(line.item.variantId, event.target.checked ? [...line.serialIds, serial.id] : line.serialIds.filter((id) => id !== serial.id))}
                          />
                          {serial.serial}
                        </label>
                      ))}
                    </fieldset>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <div role="group" aria-label="Mode de paiement" className="flex flex-wrap gap-1.5 border-t border-border pt-3">
          {methods.map((method) => (
            <button
              key={method.id}
              type="button"
              aria-pressed={method.id === activeMethod}
              className={`rounded-md border px-3 py-2 text-sm ${method.id === activeMethod ? 'border-primary bg-selected font-medium text-selected-text' : 'border-border hover:bg-canvas'}`}
              onClick={() => setMethodId(method.id)}
            >
              {method.name}
            </button>
          ))}
        </div>
        <Field label="Montant reçu" hint="Laissez vide si le client donne le montant exact.">
          <Input value={received} inputMode="numeric" onChange={(event) => setReceived(event.target.value)} />
        </Field>

        {(showOptions || remaining > 0n) && (
          <Field label="Client">
            <Select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">{remaining > 0n ? 'Choisir le client' : 'Client de passage'}</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </Select>
          </Field>
        )}
        {remaining > 0n && (
          <Field label="Date d'échéance (facultatif)">
            <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </Field>
        )}
        {showOptions && can('discount') && (
          <Field label="Remise globale">
            <Input value={cartDiscount} inputMode="numeric" onChange={(event) => setCartDiscount(event.target.value)} />
          </Field>
        )}
        {!showOptions && <button type="button" className="self-start text-sm text-primary underline" onClick={() => setShowOptions(true)}>{can('discount') ? 'Ajouter un client ou une remise' : 'Ajouter un client'}</button>}

        <dl className="space-y-1.5 border-t border-border pt-3 text-sm">
          {(totals.value?.discount ?? 0n) > 0n && (
            <div className="flex justify-between text-muted"><dt>Remises</dt><dd className="tabular-nums">{money(totals.value!.discount)}</dd></div>
          )}
          <div className="flex items-baseline justify-between"><dt className="font-medium">Total</dt><dd data-testid="total" className="text-2xl font-semibold tabular-nums">{money(total)}</dd></div>
          {change > 0n && <div className="flex items-baseline justify-between"><dt className="font-medium">Monnaie à rendre</dt><dd className="text-lg font-semibold tabular-nums">{money(change)}</dd></div>}
          {remaining > 0n && <div className="flex justify-between text-danger"><dt>Reste à crédit</dt><dd className="font-medium tabular-nums">{money(remaining)}</dd></div>}
        </dl>

        {message && <Alert>{message}</Alert>}
        {message?.startsWith('Stock insuffisant') && can('manage_stock') && <Link className="text-sm font-medium text-primary underline" to="/stock">Ajouter du stock</Link>}
        <Button className="h-12! text-base" disabled={saving || cart.length === 0 || !totals.value} onClick={validate}>Valider la vente</Button>

        {done && (
          <div role="status" className="rounded-md bg-success-bg px-3.5 py-3 text-sm text-success">
            <p className="font-medium">Vente {done.number} enregistrée</p>
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" onClick={() => print('thermal')}>Imprimer le reçu</Button>
              <Button variant="secondary" onClick={() => print('a4')}>Facture A4</Button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
