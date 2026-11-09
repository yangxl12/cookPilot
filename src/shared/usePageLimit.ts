import { useEffect, useState } from 'react';

/** The same incremental list interaction can also bound a database query. */
export function usePageLimit(key: string, pageSize = 24) {
  const [page, setPage] = useState({ key, limit: pageSize });
  if (page.key !== key) setPage({ key, limit: pageSize });
  const limit = page.key === key ? page.limit : pageSize;
  const [element, sentinel] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!element) return;
    let active = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (active && entries.some((entry) => entry.isIntersecting)) {
          active = false;
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
  }, [element, key, limit, pageSize]);
  return { limit, sentinel };
}
