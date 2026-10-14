import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage/db';
import { defaultPreferences } from '../domain/schema';
import type { Data } from './context';

// Subscribe to each table independently. Lease writes must never reload recipe content.
export function useAppData(): Data | undefined {
  const recipes = useLiveQuery(() => db.recipes.toArray(), []);
  const sessions = useLiveQuery(() => db.sessions.toArray(), []);
  const timers = useLiveQuery(() => db.timers.toArray(), []);
  const models = useLiveQuery(() => db.models.toArray(), []);
  const settings = useLiveQuery(
    () => db.settings.bulkGet(['preferences', 'activeModelId', 'activeConversationId']),
    [],
  );
  return useMemo(() => {
    if (!recipes || !sessions || !timers || !models || !settings) return undefined;
    return {
      recipes,
      sessions,
      timers,
      models,
      preferences: (settings[0]?.value as Data['preferences']) ?? defaultPreferences(),
      activeModelId: (settings[1]?.value as string) ?? '',
      activeConversationId: (settings[2]?.value as string | null) ?? null,
    };
  }, [recipes, sessions, timers, models, settings]);
}
