import type { BuiltinRecipe } from '../../domain/schema';

// The catalog is ~1 MB. It stays out of every script chunk: the asset URL is resolved once, then
// the JSON is fetched and parsed on demand, so the home page and the AI list never pay for it.
let loaded: BuiltinRecipe[] | null = null;
let pending: Promise<BuiltinRecipe[]> | null = null;

export function catalogSync(): BuiltinRecipe[] | null {
  return loaded;
}

export function loadCatalog(): Promise<BuiltinRecipe[]> {
  if (loaded) return Promise.resolve(loaded);
  pending ??= import('./catalog.json?url')
    .then(({ default: url }) => fetch(url, { cache: 'force-cache' }))
    .then((response) => {
      if (!response.ok) throw new Error(`菜谱数据加载失败（HTTP ${response.status}）`);
      return response.json() as Promise<BuiltinRecipe[]>;
    })
    .then((data) => {
      loaded = data;
      return data;
    })
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  return pending;
}
