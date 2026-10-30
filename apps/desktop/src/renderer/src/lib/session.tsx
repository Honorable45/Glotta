import type { Session } from '@gestion/contracts';
import type { Permission } from '@gestion/domain';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { call } from './api';

interface SessionState {
  session: Session | null;
  loaded: boolean;
  refresh: () => Promise<void>;
  /** Pour adapter l'affichage seulement : la vraie vérification se fait dans le processus principal. */
  can: (permission: Permission) => boolean;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    setSession(await call('auth.session', undefined));
    setLoaded(true);
  }, []);
  useEffect(() => void refresh(), [refresh]);
  const can = useCallback((permission: Permission) => session?.permissions.includes(permission) ?? false, [session]);
  return <SessionContext.Provider value={{ session, loaded, refresh, can }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const state = useContext(SessionContext);
  if (!state) throw new Error('SessionProvider manquant');
  return state;
}
