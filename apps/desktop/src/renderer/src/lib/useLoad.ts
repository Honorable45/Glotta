import { useCallback, useEffect, useState } from 'react';

/** Charge une donnée du processus principal et expose erreur et rechargement. */
export function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    return load().then(setData).catch((cause: Error) => setError(cause.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => void reload(), [reload]);
  return { data, error, reload, setError };
}
