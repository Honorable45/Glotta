import type { Period } from '@gestion/contracts';
import { Field, Input, SegmentedControl } from '@gestion/ui';
import { useMemo, useState } from 'react';

type Preset = 'today' | 'week' | 'month' | 'year' | 'custom';

const options: { value: Preset; label: string }[] = [
  { value: 'today', label: "Aujourd'hui" },
  { value: 'week', label: 'Cette semaine' },
  { value: 'month', label: 'Ce mois' },
  { value: 'year', label: 'Cette année' },
  { value: 'custom', label: 'Personnalisée' },
];

const dayStart = (text: string) => new Date(`${text}T00:00:00`);
const dayEnd = (text: string) => new Date(`${text}T23:59:59.999`);

function resolve(preset: Preset, from: string, to: string): Period | null {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === 'custom') {
    if (!from || !to || from > to) return null;
    return { from: dayStart(from).toISOString(), to: dayEnd(to).toISOString() };
  }
  if (preset === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (preset === 'month') start.setDate(1);
  if (preset === 'year') start.setMonth(0, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** Filtre de période partagé. `period` vaut null tant qu'une plage personnalisée est incomplète. */
export function usePeriod(initial: Preset = 'month') {
  const [preset, setPreset] = useState<Preset>(initial);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const period = useMemo(() => resolve(preset, from, to), [preset, from, to]);
  const control = (
    <div className="flex flex-wrap items-end gap-3">
      <SegmentedControl label="Période" value={preset} options={options} onChange={setPreset} />
      {preset === 'custom' && (
        <>
          <Field label="Du"><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
          <Field label="Au"><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></Field>
        </>
      )}
    </div>
  );
  return { period, control };
}
