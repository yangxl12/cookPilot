import { useEffect, useMemo, useRef, useState } from 'react';

// Keep initial renders small. The full collection still participates in search and counts.
export function usePagedItems<T>(items: T[], key: string, pageSize = 24) {
  const [page, setPage] = useState({ key, limit: pageSize });
  const limit = page.key === key ? page.limit : pageSize;
  const sentinel = useRef<HTMLDivElement>(null);
  const hasMore = limit < items.length;
  useEffect(() => {
    const element = sentinel.current;
    if (!element || !hasMore) return;
    let active = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (active && entries.some((entry) => entry.isIntersecting)) {
          setPage((previous) => ({
            key,
            limit: (previous.key === key ? previous.limit : pageSize) + pageSize,
          }));
        }
      },
      { rootMargin: '600px' },
    );
    observer.observe(element);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [key, limit, hasMore, pageSize]);
  const visible = useMemo(() => items.slice(0, limit), [items, limit]);
  return { visible, sentinel, hasMore };
}
