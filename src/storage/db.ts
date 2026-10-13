import Dexie, { type Table } from 'dexie';
import type {
  Recipe,
  RecipeVersion,
  CookingSession,
  Timer,
  Conversation,
  CookingMessage,
  ModelConfig,
  Credential,
  Task,
  Setting,
} from '../domain/schema';

export class CookDatabase extends Dexie {
  recipes!: Table<Recipe>;
  versions!: Table<RecipeVersion>;
  sessions!: Table<CookingSession>;
  timers!: Table<Timer>;
  conversations!: Table<Conversation>;
  cookingMessages!: Table<CookingMessage>;
  models!: Table<ModelConfig>;
  credentials!: Table<Credential>;
  tasks!: Table<Task>;
  settings!: Table<Setting>;
  constructor(name = 'cookpilot-v1') {
    super(name);
    this.version(1).stores({
      recipes: 'id, &[source+identity], source, *aliases',
      versions: 'id, recipeId, [recipeId+number], createdAt',
      sessions: 'id, recipeId, versionId, createdAt',
      timers: 'id, sessionId, [sessionId+targetType+targetId]',
      conversations: 'id, lastSentAt',
      cookingMessages: 'id, sessionId, createdAt',
      models: 'id',
      credentials: 'modelId',
      tasks: 'id, status, contextId, owner',
      settings: 'id',
    });
  }
}
export const db = new CookDatabase();
export async function setting<T>(id: string, fallback: T): Promise<T> {
  return ((await db.settings.get(id))?.value as T) ?? fallback;
}
export async function setSetting(id: string, value: unknown) {
  await db.settings.put({ id, value });
}
