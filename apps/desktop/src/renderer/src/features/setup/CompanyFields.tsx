import type { CompanyInput } from '@gestion/contracts';
import { supportedCurrencies } from '@gestion/domain';
import { Button, Field, Input, Select, Textarea } from '@gestion/ui';
import { useState } from 'react';
import { call } from '../../lib/api';

export function emptyCompany(): CompanyInput {
  return { name: '', logoData: null, address: '', phone: '', email: null, currency: 'XOF', taxInfo: null };
}

export function CompanyFields({ value, onChange }: { value: CompanyInput; onChange: (value: CompanyInput) => void }) {
  const [logoError, setLogoError] = useState<string>();
  const set = <K extends keyof CompanyInput>(key: K, next: CompanyInput[K]) => onChange({ ...value, [key]: next });
  const pickLogo = () => {
    setLogoError(undefined);
    call('company.pickLogo', undefined)
      .then((logo) => {
        if (logo) set('logoData', logo);
      })
      .catch((cause: Error) => setLogoError(cause.message));
  };
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <Field label="Nom commercial">
          <Input value={value.name} onChange={(event) => set('name', event.target.value)} />
        </Field>
      </div>
      <div className="col-span-2 flex items-center gap-4">
        {value.logoData ? (
          <img src={value.logoData} alt="Logo de l'entreprise" className="size-14 rounded-md border border-border object-contain" />
        ) : (
          <div className="flex size-14 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted">Logo</div>
        )}
        <div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={pickLogo}>Choisir un logo</Button>
            {value.logoData && <Button variant="secondary" onClick={() => set('logoData', null)}>Retirer</Button>}
          </div>
          <p className={`mt-1 text-xs ${logoError ? 'text-danger' : 'text-muted'}`}>{logoError ?? 'Facultatif. PNG ou JPEG, 2 Mo maximum.'}</p>
        </div>
      </div>
      <div className="col-span-2">
        <Field label="Adresse">
          <Input value={value.address} onChange={(event) => set('address', event.target.value)} />
        </Field>
      </div>
      <Field label="Téléphone">
        <Input value={value.phone} placeholder="+228 90 00 00 00" onChange={(event) => set('phone', event.target.value)} />
      </Field>
      <Field label="Email (facultatif)">
        <Input type="email" value={value.email ?? ''} onChange={(event) => set('email', event.target.value.trim() || null)} />
      </Field>
      <Field label="Devise">
        <Select value={value.currency} onChange={(event) => set('currency', event.target.value as CompanyInput['currency'])}>
          {supportedCurrencies.map((currency) => (
            <option key={currency.code} value={currency.code}>{currency.label}</option>
          ))}
        </Select>
      </Field>
      <div className="col-span-2">
        <Field label="Informations fiscales (facultatif)" hint="Figureront sur vos factures.">
          <Textarea value={value.taxInfo ?? ''} onChange={(event) => set('taxInfo', event.target.value || null)} />
        </Field>
      </div>
    </div>
  );
}
