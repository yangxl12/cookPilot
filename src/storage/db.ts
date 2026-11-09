import Dexie, { type Table } from 'dexie';
import type {
  Recipe,
  RecipeVersion,
  VersionSummary,
  VersionSearch,
  ConversationSummary,
  ConversationSearch,
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
  versionSummaries!: Table<VersionSummary>;
  versionSearch!: Table<VersionSearch>;
  conversationSummaries!: Table<ConversationSummary>;
  conversationSearch!: Table<ConversationSearch>;
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
    this.version(2).stores({
      cookingMessages: 'id, sessionId, createdAt, [sessionId+createdAt]',
    });
    this.version(3).stores({
      versionSummaries: 'id, recipeId',
      sessions: 'id, recipeId, versionId, createdAt, [source+createdAt+id]',
    });
    this.version(4).stores({
      versionSearch: 'id, recipeId',
      conversationSummaries: 'id, [lastSentAt+id]',
      conversationSearch: 'id, lastSentAt',
    });
    this.on('populate', (transaction) => {
      // Only upgraded databases contain snapshots that predate the list projection.
      void transaction.table('settings').put({ id: 'recipeListReady-v3', value: true });
      void transaction.table('settings').put({ id: 'versionSearchReady-v4', value: true });
      void transaction.table('settings').put({ id: 'conversationSearchReady-v4', value: true });
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
