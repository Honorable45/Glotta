import { formatAmount } from '@gestion/domain';
import { useCallback } from 'react';
import { call } from './api';
import { useLoad } from './useLoad';

export function useCurrency() {
  const { data } = useLoad(() => call('company.get', undefined));
  const currency = data?.currency ?? 'XOF';
  const money = useCallback((value: bigint) => formatAmount(value, currency), [currency]);
  return { currency, money };
}
