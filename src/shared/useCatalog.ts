import { useEffect, useState } from 'react';
import type { BuiltinRecipe } from '../domain/schema';

export function useCatalog(enabled: boolean) {
  const [catalog, setCatalog] = useState<BuiltinRecipe[]>();
  const [error, setError] = useState<Error>();
  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    void import('../assets/recipes')
      .then(({ catalog }) => {
        if (mounted) setCatalog(catalog);
      })
      .catch((error: Error) => {
        if (mounted) setError(error);
      });
    return () => {
      mounted = false;
    };
  }, [enabled]);
  if (error) throw error;
  return catalog;
}
