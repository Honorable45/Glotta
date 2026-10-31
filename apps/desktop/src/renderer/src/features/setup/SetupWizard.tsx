import { companyInputSchema, setupInputSchema, type SetupInput } from '@gestion/contracts';
import { defaultPaymentMethods, sectorTemplates, type AttributeType } from '@gestion/domain';
import { Alert, Button, Checkbox, Field, Input, Select, TagList } from '@gestion/ui';
import { useState } from 'react';
import { attributeTypeLabels } from '../../lib/labels';
import { call } from '../../lib/api';
import { CompanyFields, emptyCompany } from './CompanyFields';
import { JoinForm } from './JoinForm';

const steps = ['Entreprise', 'Activité', 'Configuration', 'Compte'];

function fromTemplate(sector: string) {
  const template = sectorTemplates.find((item) => item.key === sector)!;
  return {
    categories: template.categories,
    units: template.units,
    attributes: template.attributes.map((attribute) => ({
      name: attribute.name,
      type: attribute.type,
      required: attribute.required ?? false,
      options: attribute.options ?? [],
      categoryNames: attribute.categories ?? [],
    })),
  };
}

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [joining, setJoining] = useState(false);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState<SetupInput>({
    company: emptyCompany(),
    sector: 'general',
    ...fromTemplate('general'),
    paymentMethods: defaultPaymentMethods,
    stock: { allowOutOfStockSales: false, lowStockThreshold: 5 },
    owner: { name: '', login: '', password: '' },
  });
  const [confirm, setConfirm] = useState('');
  const [newAttribute, setNewAttribute] = useState({ name: '', type: 'TEXT' as AttributeType, options: '' });

  const next = () => {
    setError(null);
    if (step === 0) {
      const parsed = companyInputSchema.safeParse(input.company);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message === 'Champ obligatoire' ? 'Renseignez le nom, l’adresse et le téléphone.' : (parsed.error.issues[0]?.message ?? 'Vérifiez les informations saisies.'));
        return;
      }
    }
    setStep(step + 1);
  };

  const addAttribute = () => {
    const name = newAttribute.name.trim();
    if (!name) return;
    const options = newAttribute.options.split(',').map((item) => item.trim()).filter(Boolean);
    if (newAttribute.type === 'SELECT' && options.length === 0) {
      setError('Indiquez les choix de la liste, séparés par des virgules.');
      return;
    }
    if (input.attributes.some((item) => item.name.localeCompare(name, 'fr', { sensitivity: 'base' }) === 0)) {
      setError(`La caractéristique « ${name} » existe déjà.`);
      return;
    }
    setError(null);
    setInput({ ...input, attributes: [...input.attributes, { name, type: newAttribute.type, required: false, options, categoryNames: [] }] });
    setNewAttribute({ name: '', type: 'TEXT', options: '' });
  };

  const finish = () => {
    setError(null);
    if (input.owner.password !== confirm) {
      setError('Les deux mots de passe sont différents.');
      return;
    }
    const parsed = setupInputSchema.shape.owner.safeParse(input.owner);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Vérifiez le compte.');
      return;
    }
    setSaving(true);
    // Une catégorie retirée ne doit plus être référencée par une caractéristique.
    const attributes = input.attributes.map((attribute) => ({
      ...attribute,
      categoryNames: attribute.categoryNames.filter((name) => input.categories.includes(name)),
    }));
    call('setup.complete', { ...input, attributes })
      .then(onDone)
      .catch((cause: Error) => {
        setError(cause.message);
        setSaving(false);
      });
  };

  if (joining) return <JoinForm onBack={() => setJoining(false)} onDone={onDone} />;

  return (
    <div className="flex min-h-screen justify-center bg-canvas px-6 py-10">
      <div className="w-full max-w-2xl">
        <h1 className="text-xl font-semibold tracking-tight">Configuration de votre commerce</h1>
        <ol className="mb-6 mt-4 flex gap-6 border-b border-border">
          {steps.map((label, index) => (
            <li
              key={label}
              aria-current={index === step ? 'step' : undefined}
              className={`-mb-px border-b-2 pb-2.5 text-sm ${index === step ? 'border-primary font-medium text-text' : 'border-transparent text-muted'}`}
            >
              {index + 1}. {label}
            </li>
          ))}
        </ol>

        <div className="rounded-lg border border-border bg-surface p-6">
          {step === 0 && <CompanyFields value={input.company} onChange={(company) => setInput({ ...input, company })} />}

          {step === 1 && (
            <fieldset>
              <legend className="mb-3 text-sm text-muted">Nous préparons des catégories et des caractéristiques adaptées. Vous pourrez tout modifier.</legend>
              <div className="grid grid-cols-2 gap-2">
                {sectorTemplates.map((sector) => (
                  <label
                    key={sector.key}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-3.5 py-3 text-sm ${
                      input.sector === sector.key ? 'border-primary bg-selected font-medium' : 'border-border hover:bg-canvas'
                    }`}
                  >
                    <input
                      type="radio"
                      name="sector"
                      className="accent-primary"
                      checked={input.sector === sector.key}
                      onChange={() => setInput({ ...input, sector: sector.key, ...fromTemplate(sector.key) })}
                    />
                    {sector.label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {step === 2 && (
            <details>
            <summary className="cursor-pointer text-sm text-primary underline">Tout est déjà prêt : cliquez sur Continuer. Ouvrir ici pour changer les réglages.</summary>
            <div className="mt-4 flex flex-col gap-5">
              <TagList label="Catégories" items={input.categories} placeholder="Ajouter une catégorie, puis Entrée" onChange={(categories) => setInput({ ...input, categories })} />
              <div>
                <TagList
                  label="Caractéristiques des produits"
                  items={input.attributes.map((attribute) => attribute.name)}
                  placeholder="Ajouter un champ texte, puis Entrée"
                  onChange={(names) => {
                    const known = input.attributes.filter((attribute) => names.includes(attribute.name));
                    const added = names
                      .filter((name) => !known.some((attribute) => attribute.name === name))
                      .map((name) => ({ name, type: 'TEXT' as AttributeType, required: false, options: [], categoryNames: [] }));
                    setInput({ ...input, attributes: [...known, ...added] });
                  }}
                />
                <div className="mt-3 grid grid-cols-[1fr_11rem_1fr_auto] items-end gap-2 rounded-md bg-canvas p-3">
                  <Field label="Autre type de champ">
                    <Input value={newAttribute.name} placeholder="Nom" onChange={(event) => setNewAttribute({ ...newAttribute, name: event.target.value })} />
                  </Field>
                  <Field label="Type">
                    <Select value={newAttribute.type} onChange={(event) => setNewAttribute({ ...newAttribute, type: event.target.value as AttributeType })}>
                      {Object.entries(attributeTypeLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Choix">
                    <Input
                      value={newAttribute.options}
                      disabled={newAttribute.type !== 'SELECT'}
                      placeholder="S, M, L"
                      onChange={(event) => setNewAttribute({ ...newAttribute, options: event.target.value })}
                    />
                  </Field>
                  <Button variant="secondary" onClick={addAttribute}>Ajouter</Button>
                </div>
              </div>
              <TagList
                label="Unités de mesure"
                items={input.units.map((unit) => unit.name)}
                placeholder="Ajouter une unité, puis Entrée"
                onChange={(names) => {
                  const known = input.units.filter((unit) => names.includes(unit.name));
                  const added = names
                    .filter((name) => !known.some((unit) => unit.name === name))
                    .map((name) => ({ name, symbol: name.slice(0, 10), allowsDecimal: false }));
                  setInput({ ...input, units: [...known, ...added] });
                }}
              />
              <TagList label="Modes de paiement" items={input.paymentMethods} placeholder="Ajouter un mode de paiement, puis Entrée" onChange={(paymentMethods) => setInput({ ...input, paymentMethods })} />
              <div className="grid grid-cols-2 items-end gap-4">
                <Field label="Seuil d'alerte de stock par défaut">
                  <Input
                    type="number"
                    min={0}
                    value={input.stock.lowStockThreshold}
                    onChange={(event) => setInput({ ...input, stock: { ...input.stock, lowStockThreshold: Math.max(0, Math.trunc(Number(event.target.value))) } })}
                  />
                </Field>
                <div className="pb-2">
                  <Checkbox
                    label="Autoriser les ventes hors stock"
                    checked={input.stock.allowOutOfStockSales}
                    onChange={(event) => setInput({ ...input, stock: { ...input.stock, allowOutOfStockSales: event.target.checked } })}
                  />
                </div>
              </div>
            </div>
            </details>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted">Ce compte propriétaire a tous les droits. Gardez bien son mot de passe : il protège votre commerce.</p>
              <Field label="Votre nom"><Input value={input.owner.name} onChange={(event) => setInput({ ...input, owner: { ...input.owner, name: event.target.value } })} /></Field>
              <Field label="Identifiant de connexion"><Input autoComplete="username" value={input.owner.login} onChange={(event) => setInput({ ...input, owner: { ...input.owner, login: event.target.value } })} /></Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Mot de passe" hint="8 caractères minimum."><Input type="password" autoComplete="new-password" value={input.owner.password} onChange={(event) => setInput({ ...input, owner: { ...input.owner, password: event.target.value } })} /></Field>
                <Field label="Confirmer le mot de passe"><Input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></Field>
              </div>
            </div>
          )}

          {error && <div className="mt-5"><Alert>{error}</Alert></div>}

          <div className="mt-6 flex justify-between border-t border-border pt-4">
            {step > 0 ? <Button variant="secondary" onClick={() => { setError(null); setStep(step - 1); }}>Retour</Button> : <Button variant="secondary" onClick={() => setJoining(true)}>Rejoindre une entreprise existante</Button>}
            {step < steps.length - 1 ? <Button onClick={next}>Continuer</Button> : <Button disabled={saving} onClick={finish}>Terminer la configuration</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}
