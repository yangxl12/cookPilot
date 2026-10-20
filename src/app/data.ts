import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage/db';
import { defaultPreferences, type CookingSession } from '../domain/schema';
import type { Data } from './context';

// Subscribe to each table independently. Lease writes must never reload recipe content, and
// cooking sessions are read per page so that saving progress never refreshes the whole app.
export function useAppData(): Data | undefined {
  const recipes = useLiveQuery(() => db.recipes.toArray(), []);
  const timers = useLiveQuery(() => db.timers.toArray(), []);
  const models = useLiveQuery(() => db.models.toArray(), []);
  const settings = useLiveQuery(
    () => db.settings.bulkGet(['preferences', 'activeModelId', 'activeConversationId']),
    [],
  );
  return useMemo(() => {
    if (!recipes || !timers || !models || !settings) return undefined;
    return {
      recipes,
      timers,
      models,
      preferences: (settings[0]?.value as Data['preferences']) ?? defaultPreferences(),
      activeModelId: (settings[1]?.value as string) ?? '',
      activeConversationId: (settings[2]?.value as string | null) ?? null,
    };
  }, [recipes, timers, models, settings]);
}

/** Every cooking record. Only list-style pages need the whole table. */
export function useSessions(): CookingSession[] | undefined {
  return useLiveQuery(() => db.sessions.toArray(), []);
}
