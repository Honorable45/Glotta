import type { Theme } from '@gestion/contracts';
import { Card, SegmentedControl } from '@gestion/ui';
import { useTheme } from '../../lib/theme';

const options: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Système' },
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
];

export function AppearancePage() {
  const { theme, error, setTheme } = useTheme();
  return (
    <Card title="Thème">
      <SegmentedControl label="Thème de l'application" value={theme} options={options} onChange={setTheme} />
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </Card>
  );
}
