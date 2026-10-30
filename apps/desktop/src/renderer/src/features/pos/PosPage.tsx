import type { PosItem, SaleSummary } from '@gestion/contracts';
import { computeSale, formatQuantity, newId } from '@gestion/domain';
import { Alert, Button, Field, Input, Select } from '@gestion/ui';
import { Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  const { data: options } = useLoad(() => Promise.all([call('paymentMethods.list', undefined), call('customers.list', { search: '' })]));
  const methods = (options?.[0] ?? []).filter((method) => method.isActive);
  const customers = options?.[1] ?? [];

  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PosItem[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartDiscount, setCartDiscount] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [methodId, setMethodId] = useState('');
  const [received, setReceived] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<SaleSummary | null>(null);
  // Conservé jusqu'au succès : un nouvel essai après une erreur réseau ou un double clic reste la même vente.
  const saleId = useRef(newId());

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      call('pos.search', { query }).then((items) => { if (active) setResults(items); }).catch((cause: Error) => setError(cause.message));
    }, 100);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

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
    setResults([]);
    searchRef.current?.focus();
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

  function updateSerials(variantId: string, serialIds: string[]) {
    setCart((lines) => lines.map((line) => (line.item.variantId === variantId ? { ...line, serialIds, quantity: String(serialIds.length) } : line)));
  }

  function reset() {
    setCart([]);
    setCartDiscount('');
    setCustomerId('');
    setDueDate('');
    setReceived('');
    setError(null);
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
      setError('Montant reçu invalide.');
      return;
    }
    if (remaining > 0n && !customerId) {
      setError('Sélectionnez un client pour une vente à crédit.');
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

  return (
    <div className="grid grid-cols-[1fr_24rem] items-start gap-5">
      <div className="flex min-w-0 flex-col gap-3">
        <Input
          ref={searchRef}
          autoFocus
          aria-label="Rechercher un produit"
          placeholder="Nom, référence, code-barres ou numéro de série"
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
            call('pos.search', { query: code }).then((items) => {
              const target = items.find((item) => item.exactMatch) ?? (items.length === 1 ? items[0] : undefined);
              if (target) return addItem(target);
              setQuery(code);
              setResults(items);
              return undefined;
            }).catch((cause: Error) => setError(cause.message));
          }}
        />
        {results.length > 0 && (
          <ul aria-label="Résultats" className="divide-y divide-border rounded-lg border border-border bg-surface">
            {results.map((item) => (
              <li key={item.variantId}>
                <button type="button" className="flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left text-sm hover:bg-canvas" onClick={() => { setQuery(''); void addItem(item); }}>
                  <span className="min-w-0">
                    <span className="font-medium">{item.productName}</span>
                    {item.variantLabel && <span className="text-muted"> · {item.variantLabel}</span>}
                    <span className="block text-xs text-muted">Stock : {formatQuantity(item.quantity)} {item.unitSymbol}</span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">{money(item.salePrice)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim() && results.length === 0 && <p className="px-1 text-sm text-muted">Aucun produit trouvé.</p>}

        <section aria-label="Panier" className="rounded-lg border border-border bg-surface">
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Panier</h2>
          {cart.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted">Recherchez ou scannez un produit pour commencer.</p>}
          <ul className="divide-y divide-border">
            {cart.map((line) => (
              <li key={line.item.variantId} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate font-medium">{line.item.productName}{line.item.variantLabel && ` · ${line.item.variantLabel}`}</p>
                    <p className="text-xs tabular-nums text-muted">{money(line.item.salePrice)} / {line.item.unitSymbol}</p>
                  </div>
                  <Input
                    aria-label={`Quantité de ${line.item.productName}`}
                    className="w-20! shrink-0 text-right"
                    disabled={line.item.trackSerial}
                    value={line.quantity}
                    onChange={(event) => setCart((lines) => lines.map((other) => (other === line ? { ...other, quantity: event.target.value } : other)))}
                  />
                  {can('discount') && <Input
                    aria-label={`Remise sur ${line.item.productName}`}
                    placeholder="Remise"
                    className="w-24! shrink-0 text-right"
                    value={line.discount}
                    onChange={(event) => setCart((lines) => lines.map((other) => (other === line ? { ...other, discount: event.target.value } : other)))}
                  />}
                  <button type="button" aria-label={`Retirer ${line.item.productName}`} className="rounded p-1.5 text-muted hover:text-danger" onClick={() => setCart((lines) => lines.filter((other) => other !== line))}>
                    <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                  </button>
                </div>
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
            ))}
          </ul>
        </section>
      </div>

      <aside aria-label="Paiement" className="flex flex-col gap-3.5 rounded-lg border border-border bg-surface p-4">
        <Field label="Client">
          <Select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
            <option value="">Client de passage</option>
            {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
          </Select>
        </Field>
        {can('discount') && (
          <Field label="Remise globale">
            <Input value={cartDiscount} inputMode="numeric" onChange={(event) => setCartDiscount(event.target.value)} />
          </Field>
        )}
        <Field label="Mode de paiement">
          <Select value={activeMethod} onChange={(event) => setMethodId(event.target.value)}>
            {methods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
          </Select>
        </Field>
        <Field label="Montant reçu" hint="Laissez vide pour un paiement exact. Un montant inférieur crée un crédit.">
          <Input value={received} inputMode="numeric" onChange={(event) => setReceived(event.target.value)} />
        </Field>
        {remaining > 0n && (
          <Field label="Date d'échéance (facultatif)">
            <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </Field>
        )}

        <dl className="space-y-1.5 border-t border-border pt-3 text-sm">
          {(totals.value?.discount ?? 0n) > 0n && (
            <div className="flex justify-between text-muted"><dt>Remises</dt><dd className="tabular-nums">{money(totals.value!.discount)}</dd></div>
          )}
          <div className="flex items-baseline justify-between"><dt className="font-medium">Total</dt><dd data-testid="total" className="text-2xl font-semibold tabular-nums">{money(total)}</dd></div>
          {change > 0n && <div className="flex justify-between"><dt>Monnaie à rendre</dt><dd className="font-medium tabular-nums">{money(change)}</dd></div>}
          {remaining > 0n && <div className="flex justify-between text-danger"><dt>Reste à crédit</dt><dd className="font-medium tabular-nums">{money(remaining)}</dd></div>}
        </dl>

        {(error ?? (cart.length > 0 ? totals.error : null)) && <Alert>{error ?? totals.error}</Alert>}
        <Button className="h-11! text-base" disabled={saving || cart.length === 0 || !totals.value} onClick={validate}>Valider la vente</Button>

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
