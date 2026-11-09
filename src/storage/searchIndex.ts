import { readConversation } from './messages';
import Dexie from 'dexie';
import { db, type CookDatabase } from './db';
import { contentSearchText, isExpired } from '../domain/rules';
import type {
  Conversation,
  ConversationSearch,
  ConversationSummary,
  RecipeVersion,
  SearchText,
  VersionSearch,
} from '../domain/schema';

export const conversationTables = [
  db.conversations,
  db.conversationSummaries,
  db.conversationSearch,
  db.conversationMessages,
  db.messageSearch,
];
const batchSize = 32;
const readyKey = (kind: 'version' | 'conversation') => `${kind}SearchReady-v4`;
const progressKey = (kind: 'version' | 'conversation') => `${kind}SearchAfter-v4`;
export const searchableText = (body: string): SearchText => ({
  body,
  searchText: body.toLowerCase(),
});

export function indexVersion(version: RecipeVersion): VersionSearch {
  return {
    id: version.id,
    recipeId: version.recipeId,
    title: version.content.title,
    ...searchableText(contentSearchText(version.content)),
  };
}

export function summarizeConversation(conversation: Conversation): ConversationSummary {
  const { messages, requirements: _requirements, ...summary } = conversation;
  return {
    ...summary,
    questionCount:
      conversation.questionCount ?? (messages ?? []).filter((m) => m.role === 'user').length,
  };
}

export function indexConversation(conversation: Conversation): ConversationSearch {
  return {
    id: conversation.id,
    title: conversation.title,
    lastSentAt: conversation.lastSentAt,
    ...searchableText(
      conversation.messages
        .map(
          (m) => `${m.text} ${m.candidates?.map((c) => `${c.name} ${c.summary}`).join(' ') ?? ''}`,
        )
        .join(' '),
    ),
  };
}

/** All application conversation writes share this atomic projection boundary. */
export function saveConversation(conversation: Conversation, add = false) {
  return db.transaction('rw', [...conversationTables, db.settings], async () => {
    // Compatibility boundary for legacy imports and bulk replacement. Interactive
    // appends/completions use message-level writes from messages.ts instead.
    const {
      messageCount: _count,
      questionCount: _questions,
      requirements: _requirements,
      ...legacy
    } = conversation;
    if (add) await db.conversations.add(legacy);
    else await db.conversations.put(legacy);
    await db.settings.delete(`messagesAfter-v5:${conversation.id}`);
    await db.conversationMessages.where('conversationId').equals(conversation.id).delete();
    await db.messageSearch.where('conversationId').equals(conversation.id).delete();
    await db.conversationSummaries.put(summarizeConversation(legacy));
    await db.conversationSearch.put(indexConversation(legacy));
  });
}

export function changeConversation(id: string, update: (conversation: Conversation) => void) {
  return db.transaction('rw', [...conversationTables, db.settings], async () => {
    const conversation = await readConversation(id);
    if (!conversation) return;
    update(conversation);
    await saveConversation(conversation);
  });
}

/** A batch and its cursor commit together; concurrent tabs serialize on these stores. */
export function backfillSearchBatch(kind: 'version' | 'conversation', database: CookDatabase = db) {
  return database.transaction(
    'rw',
    kind === 'version'
      ? [database.settings, database.versions, database.versionSearch, database.versionSummaries]
      : [
          database.settings,
          database.conversations,
          database.conversationSearch,
          database.conversationSummaries,
        ],
    async () => {
      if ((await database.settings.get(readyKey(kind)))?.value === true) return true;
      const after = (await database.settings.get(progressKey(kind)))?.value as string | undefined;
      const table = kind === 'version' ? database.versions : database.conversations;
      const rows = await (after ? table.where(':id').above(after) : table.toCollection())
        .limit(batchSize)
        .toArray();
      if (kind === 'version') {
        const versions = rows as RecipeVersion[];
        await database.versionSearch.bulkPut(versions.map(indexVersion));
        // Historical changes are tiny and independent of each version's immutable body.
        for (const version of versions) {
          const { title, minutes, conditions, aliases } = version.content;
          await database.versionSummaries.put({
            id: version.id,
            recipeId: version.recipeId,
            number: version.number,
            title,
            minutes,
            conditions,
            searchText: `${title} ${aliases.join(' ')}`.toLowerCase(),
            change: version.change,
          });
        }
      } else {
        const conversations = (rows as Conversation[]).filter((c) => c.messageCount === undefined);
        await database.conversationSearch.bulkPut(conversations.map(indexConversation));
        await database.conversationSummaries.bulkPut(conversations.map(summarizeConversation));
      }
      if (rows.length < batchSize) {
        await database.settings.put({ id: readyKey(kind), value: true });
        await database.settings.delete(progressKey(kind));
        return true;
      }
      await database.settings.put({ id: progressKey(kind), value: rows.at(-1)!.id });
      return false;
    },
  );
}

const preparing = new Map<string, Promise<void>>();
export function prepareSearchIndex(kind: 'version' | 'conversation'): Promise<void> {
  const pending = preparing.get(kind);
  if (pending) return pending;
  const work = (async () => {
    while (!(await backfillSearchBatch(kind))) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  })().finally(() => preparing.delete(kind));
  preparing.set(kind, work);
  return work;
}

export type StoredSearchResult = {
  id: string;
  title: string;
  source: 'ai' | 'conversations';
  parts: SearchText[];
};

export async function readSearchIndex(): Promise<StoredSearchResult[]> {
  return db.transaction(
    'r',
    [
      db.settings,
      db.recipes,
      db.sessions,
      db.versions,
      db.versionSummaries,
      db.versionSearch,
      db.conversations,
      db.conversationSearch,
      db.messageSearch,
    ],
    async () => {
      const versionReady = (await db.settings.get(readyKey('version')))?.value === true;
      const conversationReady = (await db.settings.get(readyKey('conversation')))?.value === true;
      const aiIds = new Set(await db.recipes.where('source').equals('ai').primaryKeys());
      const sessions = (await db.sessions.toArray())
        .filter((s) => aiIds.has(s.recipeId))
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
      const ids = [...new Set(sessions.map((s) => s.versionId))];
      // During an old database's first backfill, retain complete search coverage.
      const legacyVersions = versionReady ? [] : await db.versions.toArray();
      const versions = new Map(
        (versionReady
          ? (await db.versionSearch.bulkGet(ids)).filter((v) => v !== undefined)
          : legacyVersions.map(indexVersion)
        ).map((v) => [v.id, v]),
      );
      const changes = new Map<string, string[]>();
      for (const version of versionReady ? await db.versionSummaries.toArray() : legacyVersions) {
        const rows = changes.get(version.recipeId) ?? [];
        rows.push(version.change ?? '');
        changes.set(version.recipeId, rows);
      }
      const changeText = new Map(
        [...changes].map(([id, rows]) => [id, searchableText(rows.join(' '))]),
      );
      const conversations = conversationReady
        ? await db.conversationSearch
            .where('lastSentAt')
            .aboveOrEqual(Date.now() - 30 * 86400000)
            .reverse()
            .toArray()
        : (await db.conversations.orderBy('lastSentAt').reverse().toArray())
            .filter((c) => !isExpired(c.lastSentAt))
            .map(indexConversation);
      const messageParts = new Map<string, SearchText[]>();
      for (const message of await db.messageSearch.toArray()) {
        const parts = messageParts.get(message.conversationId) ?? [];
        parts.push(message);
        messageParts.set(message.conversationId, parts);
      }
      return [
        ...sessions.flatMap((session): StoredSearchResult[] => {
          const version = versions.get(session.versionId);
          if (!version) return [];
          return [
            {
              id: session.id,
              title: version.title,
              source: 'ai',
              parts: [
                version,
                searchableText(session.note),
                changeText.get(session.recipeId) ?? searchableText(''),
              ],
            },
          ];
        }),
        ...conversations.map((c): StoredSearchResult => ({
          id: c.id,
          title: c.title,
          source: 'conversations',
          parts: [searchableText(c.title), c, ...(messageParts.get(c.id) ?? [])],
        })),
      ];
    },
  );
}

export type HistoryCursor = { lastSentAt: number; id: string };
export async function readConversationHistory(limit: number, before?: HistoryCursor) {
  if ((await db.settings.get(readyKey('conversation')))?.value === true) {
    return db.conversationSummaries
      .where('[lastSentAt+id]')
      .between(
        [Date.now() - 30 * 86400000, Dexie.minKey],
        before ? [before.lastSentAt, before.id] : [Infinity, Dexie.maxKey],
        true,
        false,
      )
      .reverse()
      .limit(limit)
      .toArray();
  }
  return (
    await db.conversations
      .orderBy('lastSentAt')
      .reverse()
      .filter(
        (c) =>
          !isExpired(c.lastSentAt) &&
          (!before ||
            c.lastSentAt < before.lastSentAt ||
            (c.lastSentAt === before.lastSentAt && c.id < before.id)),
      )
      .limit(limit)
      .toArray()
  ).map(summarizeConversation);
}
