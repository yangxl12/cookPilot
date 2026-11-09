import { useMemo } from 'react';
import { usePageLimit } from './usePageLimit';

// Keep initial renders small. The full collection still participates in search and counts.
export function usePagedItems<T>(items: T[], key: string, pageSize = 24) {
  const { limit, sentinel } = usePageLimit(key, pageSize);
  const hasMore = limit < items.length;
  const visible = useMemo(() => items.slice(0, limit), [items, limit]);
  return { visible, sentinel, hasMore };
}
