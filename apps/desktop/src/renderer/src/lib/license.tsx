import type { LicenseState } from '@gestion/contracts';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { call } from './api';

interface LicenseContextValue {
  license: LicenseState | null;
  setLicense: (license: LicenseState) => void;
  reload: () => Promise<void>;
}

const LicenseContext = createContext<LicenseContextValue | null>(null);

export function LicenseProvider({ children }: { children: ReactNode }) {
  const [license, setLicense] = useState<LicenseState | null>(null);
  const reload = useCallback(async () => setLicense(await call('license.state', undefined)), []);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 60_000);
    return () => clearInterval(timer);
  }, [reload]);
  return <LicenseContext.Provider value={{ license, setLicense, reload }}>{children}</LicenseContext.Provider>;
}

export function useLicense(): LicenseContextValue {
  const value = useContext(LicenseContext);
  if (!value) throw new Error('LicenseProvider manquant');
  return value;
}
