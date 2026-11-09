import Dexie from 'dexie';
import { db, type CookDatabase } from './db';
import type { RecipeVersion, VersionSummary } from '../domain/schema';
import { indexVersion } from './searchIndex';

const progressKey = 'recipeListBackfill-v3';
const readyKey = 'recipeListReady-v3';
const batchSize = 32;
type Progress = { versionsAfter?: string; sessionsAfter?: string; versionsDone?: boolean };

export function summarizeVersion(version: RecipeVersion): VersionSummary {
  const { title, minutes, conditions, aliases } = version.content;
  return {
    id: version.id,
    recipeId: version.recipeId,
    number: version.number,
    title,
    minutes,
    conditions,
    searchText: `${title} ${aliases.join(' ')}`.toLowerCase(),
    change: version.change,
  };
}

/** Keep the immutable snapshot and its list projection in the same transaction. */
export function addVersion(version: RecipeVersion) {
  return db.transaction('rw', [db.versions, db.versionSummaries, db.versionSearch], async () => {
    await db.versions.add(version);
    await db.versionSummaries.add(summarizeVersion(version));
    await db.versionSearch.add(indexVersion(version));
  });
}

/** A committed cursor is also the recovery point after a reload or a failed batch. */
export function backfillRecipeListBatch(database: CookDatabase = db): Promise<boolean> {
  return database.transaction(
    'rw',
    [
      database.settings,
      database.versions,
      database.versionSummaries,
      database.sessions,
      database.recipes,
    ],
    async () => {
      if ((await database.settings.get(readyKey))?.value === true) return true;
      const progress = ((await database.settings.get(progressKey))?.value ?? {}) as Progress;
      if (!progress.versionsDone) {
        const rows = await (
          progress.versionsAfter
            ? database.versions.where(':id').above(progress.versionsAfter)
            : database.versions.toCollection()
        )
          .limit(batchSize)
          .toArray();
        await database.versionSummaries.bulkPut(rows.map(summarizeVersion));
        if (rows.length) progress.versionsAfter = rows.at(-1)!.id;
        if (rows.length < batchSize) progress.versionsDone = true;
      } else {
        const rows = await (
          progress.sessionsAfter
            ? database.sessions.where(':id').above(progress.sessionsAfter)
            : database.sessions.toCollection()
        )
          .limit(batchSize)
          .toArray();
        const recipes = new Map(
          (await database.recipes.bulkGet([...new Set(rows.map((row) => row.recipeId))]))
            .filter((recipe) => recipe !== undefined)
            .map((recipe) => [recipe.id, recipe]),
        );
        for (const row of rows) {
          const source = recipes.get(row.recipeId)?.source;
          if (source && row.source !== source) await database.sessions.update(row.id, { source });
        }
        if (rows.length) progress.sessionsAfter = rows.at(-1)!.id;
        if (rows.length < batchSize) {
          await database.settings.put({ id: readyKey, value: true });
          await database.settings.delete(progressKey);
          return true;
        }
      }
      await database.settings.put({ id: progressKey, value: progress });
      return false;
    },
  );
}

let preparing: Promise<void> | undefined;
export function prepareRecipeList(): Promise<void> {
  return (preparing ??= (async () => {
    while (!(await backfillRecipeListBatch())) {
      // Release both the database transaction and main thread between batches.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  })().finally(() => {
    preparing = undefined;
  }));
}

export type RecipeCursor = { createdAt: number; id: string };
export async function readRecipeList(limit: number, tokens: string[], before?: RecipeCursor) {
  return db.transaction(
    'r',
    [db.settings, db.recipes, db.sessions, db.versions, db.versionSummaries],
    async () => {
      const ready = (await db.settings.get(readyKey))?.value === true;
      let matched: Set<string> | undefined;
      if (tokens.length) {
        // A partially backfilled database still searches every saved version.
        matched = new Set(
          ready
            ? await db.versionSummaries
                .filter((v) => tokens.every((t) => v.searchText.includes(t)))
                .primaryKeys()
            : await db.versions
                .filter((v) =>
                  tokens.every((t) =>
                    `${v.content.title} ${v.content.aliases.join(' ')}`.toLowerCase().includes(t),
                  ),
                )
                .primaryKeys(),
        );
      }
      const aiIds = ready
        ? undefined
        : new Set(await db.recipes.where('source').equals('ai').primaryKeys());
      const collection = () => {
        const ordered = ready
          ? db.sessions
              .where('[source+createdAt+id]')
              .between(
                ['ai', Dexie.minKey],
                before ? ['ai', before.createdAt, before.id] : ['ai', Dexie.maxKey],
                true,
                !before,
              )
              .reverse()
          : db.sessions
              .orderBy('createdAt')
              .reverse()
              .filter(
                (s) =>
                  aiIds!.has(s.recipeId) &&
                  (!before ||
                    s.createdAt < before.createdAt ||
                    (s.createdAt === before.createdAt && s.id < before.id)),
              );
        return matched ? ordered.filter((s) => matched.has(s.versionId)) : ordered;
      };
      const all = db.sessions
        .where('[source+createdAt+id]')
        .between(['ai', Dexie.minKey], ['ai', Dexie.maxKey]);
      const total = before
        ? ready
          ? await (matched ? all.filter((s) => matched.has(s.versionId)) : all).count()
          : await db.sessions
              .filter((s) => aiIds!.has(s.recipeId) && (!matched || matched.has(s.versionId)))
              .count()
        : await collection().count();
      const sessions = await collection()
        .limit(limit + 1)
        .toArray();
      const ids = [...new Set(sessions.slice(0, limit).map((s) => s.versionId))];
      const summaries = new Map(
        (await db.versionSummaries.bulkGet(ids))
          .filter((v) => v !== undefined)
          .map((v) => [v.id, v]),
      );
      // Only the displayed page needs snapshots while the background backfill catches up.
      const missing = ids.filter((id) => !summaries.has(id));
      if (missing.length) {
        for (const version of await db.versions.bulkGet(missing)) {
          if (version) summaries.set(version.id, summarizeVersion(version));
        }
      }
      return {
        limit,
        query: tokens.join('\0'),
        total,
        hasMore: sessions.length > limit,
        rows: sessions.slice(0, limit).flatMap((session) => {
          const version = summaries.get(session.versionId);
          return version ? [{ ...session, version }] : [];
        }),
      };
    },
  );
}
