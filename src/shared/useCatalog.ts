import { useEffect, useState } from 'react';
import type { BuiltinRecipe } from '../domain/schema';

/**
 * Loads the offline catalog on demand. The loader is imported dynamically so pages that never show
 * the catalog do not request it, nor the module that points at its 1 MB asset.
 */
export function useCatalog(enabled: boolean) {
  const [catalog, setCatalog] = useState<BuiltinRecipe[] | null>(null);
  const [error, setError] = useState<Error>();
  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    void import('../assets/recipes')
      .then((module) => module.catalogSync() ?? module.loadCatalog())
      .then((data) => {
        if (mounted) setCatalog(data);
      })
      .catch((reason: Error) => {
        if (mounted) setError(reason);
      });
    return () => {
      mounted = false;
    };
  }, [enabled]);
  if (error) throw error;
  return catalog;
}
