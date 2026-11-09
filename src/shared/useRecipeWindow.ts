import { liveQuery } from 'dexie';
import { useEffect, useRef, useState } from 'react';
import { readRecipeList, type RecipeCursor } from '../storage/recipeList';

type Page = Awaited<ReturnType<typeof readRecipeList>>;
export function useRecipeWindow(active: boolean, tokens: string[]) {
  const key = tokens.join('\0');
  const [snapshot, setSnapshot] = useState<{ key: string; page: Page }>();
  const [error, setError] = useState<Error>();
  const next = useRef<() => void>(() => {});
  useEffect(() => {
    if (!active) return;
    const pages: Page[] = [];
    const subscriptions: { unsubscribe(): void }[] = [];
    let loading = false;
    let closed = false;
    const load = (before?: RecipeCursor) => {
      if (loading || closed) return;
      loading = true;
      const index = subscriptions.length;
      subscriptions.push(
        liveQuery(() => readRecipeList(24, tokens, before)).subscribe({
          next: (page) => {
            if (closed) return;
            const old = pages[index]?.rows.at(-1);
            const last = page.rows.at(-1);
            if (old && last && old.id !== last.id) {
              subscriptions.splice(index + 1).forEach((s) => s.unsubscribe());
              pages.splice(index + 1);
            }
            pages[index] = page;
            loading = false;
            const rows = [...new Map(pages.flatMap((p) => p.rows).map((r) => [r.id, r])).values()];
            setSnapshot({ key, page: { ...page, total: pages[0].total, rows } });
          },
          error: (error: Error) => {
            loading = false;
            if (!closed) setError(error);
          },
        }),
      );
    };
    next.current = () => {
      const page = pages.at(-1);
      const last = page?.rows.at(-1);
      if (page?.hasMore && last) load({ id: last.id, createdAt: last.createdAt });
    };
    load();
    return () => {
      closed = true;
      subscriptions.forEach((s) => s.unsubscribe());
      next.current = () => {};
    };
  }, [active, key]);
  if (error) throw error;
  return {
    page: snapshot?.key === key && active ? snapshot.page : undefined,
    loadMore: () => next.current(),
  };
}
