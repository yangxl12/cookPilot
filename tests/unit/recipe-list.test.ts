import { expect, it } from 'vitest';
import { db } from '../../src/storage/db';
import {
  addVersion,
  backfillRecipeListBatch,
  prepareRecipeList,
  readRecipeList,
  summarizeVersion,
} from '../../src/storage/recipeList';
import { commitGeneration, createTask, newSession } from '../../src/storage/repository';
import { contentExample } from '../../src/services/ai/cooking';
import { defaultPreferences, type RecipeVersion } from '../../src/domain/schema';

function version(index: number): RecipeVersion {
  return {
    id: `v${String(index).padStart(4, '0')}`,
    recipeId: 'r',
    number: index + 1,
    parentId: null,
    content: {
      ...structuredClone(contentExample),
      title: index === 0 ? '秘传老菜' : `菜谱${index}`,
      aliases: index === 0 ? ['Hidden Alias'] : [],
    },
    change: '测试',
    createdAt: index,
  };
}

async function seed(size: number, legacy = false) {
  await db.recipes.bulkPut([
    { id: 'r', identity: 'ai', name: 'AI菜谱', source: 'ai', aliases: [], createdAt: 0 },
    {
      id: 'c',
      identity: 'catalog',
      name: '本地菜谱',
      source: 'catalog',
      aliases: [],
      createdAt: 0,
    },
  ]);
  const versions = Array.from({ length: size }, (_, i) => version(i));
  await db.versions.bulkPut(versions);
  if (!legacy) await db.versionSummaries.bulkPut(versions.map(summarizeVersion));
  await db.sessions.bulkPut(
    versions.map((v, i) => ({
      ...newSession('r', v.id),
      id: `s${String(i).padStart(4, '0')}`,
      source: legacy ? undefined : 'ai',
      createdAt: i,
      note: `心得${i}`,
    })),
  );
  await db.sessions.add({
    ...newSession('c', versions[0].id, 'catalog'),
    id: 'catalog',
    createdAt: size,
  });
  if (!legacy) await db.settings.put({ id: 'recipeListReady-v3', value: true });
}

for (const size of [250, 1000]) {
  it(`${size}条制作首屏只读25条记录和24条摘要，不读取版本正文；搜索覆盖未加载记录`, async () => {
    await seed(size);
    let sessionReads = 0;
    let summaryReads = 0;
    let versionReads = 0;
    const sessionReading = (row: unknown) => {
      sessionReads++;
      return row;
    };
    const summaryReading = (row: unknown) => {
      summaryReads++;
      return row;
    };
    const versionReading = (row: unknown) => {
      versionReads++;
      return row;
    };
    db.sessions.hook('reading', sessionReading);
    db.versionSummaries.hook('reading', summaryReading);
    db.versions.hook('reading', versionReading);
    try {
      const page = await readRecipeList(24, []);
      expect(page.total).toBe(size);
      expect(page.rows).toHaveLength(24);
      expect(page.hasMore).toBe(true);
      expect(page.rows[0].id).toBe(`s${String(size - 1).padStart(4, '0')}`);
      expect(sessionReads).toBe(25);
      expect(summaryReads).toBe(24);
      expect(versionReads).toBe(0);
      const found = await readRecipeList(24, ['hidden', 'alias']);
      expect(found.total).toBe(1);
      expect(found.rows.map((row) => row.id)).toEqual(['s0000']);
      expect(found.rows[0].version.title).toBe('秘传老菜');
      expect(found.hasMore).toBe(false);
      expect(versionReads).toBe(0);
    } finally {
      db.sessions.hook('reading').unsubscribe(sessionReading);
      db.versionSummaries.hook('reading').unsubscribe(summaryReading);
      db.versions.hook('reading').unsubscribe(versionReading);
    }
  }, 15_000);
}

it('旧库回填每批至多32份正文，可中断恢复；失败批次与进度一起回滚，查询不漏旧记录', async () => {
  await seed(70, true);
  const before = await readRecipeList(24, ['hidden', 'alias']);
  expect(before.rows.map((row) => row.id)).toEqual(['s0000']);
  expect(await backfillRecipeListBatch()).toBe(false);
  expect(await db.versionSummaries.count()).toBe(32);
  const progress = await db.settings.get('recipeListBackfill-v3');
  const fail = () => {
    throw new Error('写入失败');
  };
  db.versionSummaries.hook('creating', fail);
  try {
    await expect(backfillRecipeListBatch()).rejects.toThrow('写入失败');
  } finally {
    db.versionSummaries.hook('creating').unsubscribe(fail);
  }
  expect(await db.settings.get('recipeListBackfill-v3')).toEqual(progress);
  expect(await db.versionSummaries.count()).toBe(32);
  const read: string[] = [];
  const reading = (v: RecipeVersion) => {
    read.push(v.id);
    return v;
  };
  db.versions.hook('reading', reading);
  try {
    await backfillRecipeListBatch();
    expect(read).toHaveLength(32);
    expect(read[0]).toBe('v0032');
  } finally {
    db.versions.hook('reading').unsubscribe(reading);
  }
  await db.sessions.update('s0000', { note: '回填期间的新心得', currentCard: 3 });
  await prepareRecipeList();
  expect(await db.versionSummaries.count()).toBe(70);
  expect(await db.settings.get('recipeListBackfill-v3')).toBeUndefined();
  expect((await db.settings.get('recipeListReady-v3'))?.value).toBe(true);
  expect((await db.sessions.get('s0000'))?.note).toBe('回填期间的新心得');
  expect((await db.sessions.get('s0000'))?.currentCard).toBe(3);
  expect((await db.sessions.get('s0000'))?.source).toBe('ai');
  const after = await readRecipeList(24, ['hidden', 'alias']);
  expect(after.rows.map((row) => row.id)).toEqual(['s0000']);
  const puts: string[] = [];
  const updating = (_changes: unknown, key: unknown) => {
    puts.push(String(key));
  };
  db.versionSummaries.hook('updating', updating);
  try {
    await prepareRecipeList();
    expect(puts).toEqual([]);
  } finally {
    db.versionSummaries.hook('updating').unsubscribe(updating);
  }
});

it('同一时间的分页顺序稳定，心得和版本切换使用最新数据', async () => {
  await seed(60);
  await db.sessions.where('recipeId').equals('r').modify({ createdAt: 10 });
  const first = await readRecipeList(24, []);
  const second = await readRecipeList(48, []);
  expect(new Set(second.rows.map((row) => row.id)).size).toBe(48);
  expect(second.rows.slice(0, 24).map((row) => row.id)).toEqual(first.rows.map((row) => row.id));
  const id = first.rows[0].id;
  await db.sessions.update(id, { versionId: 'v0000', note: '新的心得' });
  const changed = await readRecipeList(24, ['秘传']);
  expect(changed.rows.find((row) => row.id === id)).toMatchObject({
    note: '新的心得',
    version: { number: 1 },
  });
});

it('摘要写入失败时生成整体回滚，重试后正文和摘要同时保存', async () => {
  const task = await createTask('generate', 'c', {
    id: 'm',
    name: 'm',
    model: 'm',
    url: 'https://example.com',
  });
  const candidate = {
    name: contentExample.title,
    aliases: [],
    minutes: 15,
    difficulty: '简单' as const,
    summary: '',
    blocked: '',
  };
  const fail = () => {
    throw new Error('摘要写入失败');
  };
  db.versionSummaries.hook('creating', fail);
  try {
    await expect(
      commitGeneration(task.id, contentExample, candidate, defaultPreferences()),
    ).rejects.toThrow('摘要写入失败');
  } finally {
    db.versionSummaries.hook('creating').unsubscribe(fail);
  }
  expect(await db.recipes.count()).toBe(0);
  expect(await db.versions.count()).toBe(0);
  expect(await db.versionSummaries.count()).toBe(0);
  expect((await db.tasks.get(task.id))?.status).toBe('pending');
  const saved = await commitGeneration(task.id, contentExample, candidate, defaultPreferences());
  expect(saved.source).toBe('ai');
  expect((await db.versionSummaries.get(saved.versionId))?.title).toBe(contentExample.title);
  await expect(addVersion((await db.versions.get(saved.versionId))!)).rejects.toThrow();
  expect(await db.versionSummaries.count()).toBe(1);
});
