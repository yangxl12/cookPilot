import { expect, it, vi } from 'vitest';
import { db, setSetting, setting } from '../../src/storage/db';
import {
  initialize,
  pageOwner,
  pruneHistory,
  latestVersion,
  findExisting,
  saveProposal,
  newSession,
} from '../../src/storage/repository';
import { contentExample } from '../../src/services/ai/cooking';
import { identity } from '../../src/domain/rules';
import Dexie from 'dexie';
import { CookDatabase } from '../../src/storage/db';
import { backfillRecipeListBatch } from '../../src/storage/recipeList';

it.each([1, 2])('v%i原库升级保留对话、问答和制作记录，列表回填可恢复', async (schemaVersion) => {
  const name = `upgrade-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(schemaVersion).stores({
    recipes: 'id, &[source+identity], source, *aliases',
    versions: 'id, recipeId, [recipeId+number], createdAt',
    sessions: 'id, recipeId, versionId, createdAt',
    timers: 'id, sessionId, [sessionId+targetType+targetId]',
    conversations: 'id, lastSentAt',
    cookingMessages:
      schemaVersion === 1
        ? 'id, sessionId, createdAt'
        : 'id, sessionId, createdAt, [sessionId+createdAt]',
    models: 'id',
    credentials: 'modelId',
    tasks: 'id, status, contextId, owner',
    settings: 'id',
  });
  const upgraded = new CookDatabase(name);
  try {
    const conversation = {
      id: 'c',
      title: '旧对话',
      createdAt: 1,
      lastSentAt: 2,
      messages: [{ id: 'm', role: 'user', text: '保留用量400g', createdAt: 1 }],
    };
    await old.table('conversations').put(conversation);
    await old.table('recipes').put({
      id: 'r',
      source: 'ai',
      identity: '旧菜谱',
      name: '旧菜谱',
      aliases: [],
      createdAt: 0,
    });
    await old.table('versions').put({
      id: 'v',
      recipeId: 'r',
      number: 1,
      parentId: null,
      content: contentExample,
      change: '旧版本',
      createdAt: 0,
    });
    const session = { ...newSession('r', 'v'), source: undefined };
    await old.table('sessions').put(session);
    await old.table('cookingMessages').bulkPut(
      Array.from({ length: 100 }, (_, index) => ({
        id: `m${index}`,
        sessionId: index % 2 ? 's' : 'other',
        role: 'user',
        text: `${index}`,
        createdAt: index,
      })),
    );
    old.close();
    await upgraded.open();
    expect(upgraded.verno).toBe(3);
    expect(await upgraded.versionSummaries.count()).toBe(0);
    expect((await upgraded.settings.get('recipeListReady-v3'))?.value).not.toBe(true);
    await backfillRecipeListBatch(upgraded);
    upgraded.close();
    await upgraded.open();
    expect((await upgraded.settings.get('recipeListBackfill-v3'))?.value).toMatchObject({
      versionsAfter: 'v',
      versionsDone: true,
    });
    expect(await backfillRecipeListBatch(upgraded)).toBe(true);
    expect((await upgraded.versionSummaries.get('v'))?.title).toBe(contentExample.title);
    expect(await upgraded.sessions.get(session.id)).toEqual({ ...session, source: 'ai' });
    expect(await upgraded.conversations.get('c')).toEqual(conversation);
    expect(await upgraded.cookingMessages.count()).toBe(100);
    const rows = await upgraded.cookingMessages
      .where('[sessionId+createdAt]')
      .between(['s', -Infinity], ['s', Infinity])
      .reverse()
      .limit(10)
      .toArray();
    expect(rows.map((row) => row.createdAt)).toEqual([99, 97, 95, 93, 91, 89, 87, 85, 83, 81]);
  } finally {
    old.close();
    await upgraded.delete();
  }
});

it('100个历史版本只读取最新正文，分配新版本号保留旧版父引用', async () => {
  await db.recipes.put({
    id: 'r',
    source: 'ai',
    identity: identity(contentExample.title),
    name: contentExample.title,
    aliases: ['家传炒蛋'],
    createdAt: 0,
  });
  await db.versions.bulkPut(
    Array.from({ length: 100 }, (_, i) => ({
      id: `v${i + 1}`,
      recipeId: 'r',
      number: i + 1,
      parentId: i ? `v${i}` : null,
      content: structuredClone(contentExample),
      change: '历史',
      createdAt: i,
    })),
  );
  await db.sessions.put({ ...newSession('r', 'v1'), id: 's', progressKnown: true });
  await db.cookingMessages.put({
    id: 'm',
    sessionId: 's',
    role: 'assistant',
    text: '延长时间',
    createdAt: 0,
    baseVersionId: 'v1',
    baseRevision: 0,
    proposalStatus: 'pending',
    answer: {
      text: '',
      confirmations: [],
      proposal: {
        explanation: '延长时间',
        ingredients: [],
        prep: [],
        steps: [{ ...contentExample.steps[1], seconds: 300 }],
      },
    },
  });
  const read: string[] = [];
  const reading = (version: { id: string }) => {
    read.push(version.id);
    return version;
  };
  db.versions.hook('reading', reading);
  try {
    expect((await latestVersion('r'))?.number).toBe(100);
    expect(read).toEqual(['v100']);
    read.length = 0;
    expect((await findExisting(contentExample.title))?.version.number).toBe(100);
    expect(read).toEqual(['v100']);
    expect((await findExisting('家传炒蛋'))?.version.number).toBe(100);
    read.length = 0;
    await saveProposal('m');
    expect(read).toEqual(['v1', 'v100']);
  } finally {
    db.versions.hook('reading').unsubscribe(reading);
  }
  const saved = await latestVersion('r');
  expect(saved?.number).toBe(101);
  expect(saved?.parentId).toBe('v1');
});

it('历史清理保持30天边界，只删除过期记录且空清理不写入', async () => {
  const now = Date.now();
  const boundary = now - 30 * 86400000;
  await db.conversations.bulkPut([
    { id: 'old', title: '过期', createdAt: boundary - 1, lastSentAt: boundary - 1, messages: [] },
    { id: 'boundary', title: '保留', createdAt: boundary, lastSentAt: boundary, messages: [] },
    { id: 'recent', title: '最新', createdAt: now, lastSentAt: now, messages: [] },
  ]);
  await setSetting('activeConversationId', 'old');
  await pruneHistory(now);
  expect(await db.conversations.toCollection().primaryKeys()).toEqual(['boundary', 'recent']);
  expect(await setting('activeConversationId', 'fallback')).toBe('fallback');
  const deleteSpy = vi.spyOn(db.conversations, 'bulkDelete');
  const putSpy = vi.spyOn(db.settings, 'put');
  try {
    await pruneHistory(now);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(putSpy).not.toHaveBeenCalled();
  } finally {
    deleteSpy.mockRestore();
    putSpy.mockRestore();
  }
});

it('启动不重写已完成对话，并清理废弃租约、保留活跃请求', async () => {
  const now = Date.now();
  await setSetting('localBootstrapDisabled', true);
  await setSetting('lease:stale', now - 60000);
  await setSetting('lease:live', now);
  await setSetting('lease:invalid', 'invalid');
  const model = { id: 'test', name: 'test', model: 'test', url: 'https://example.com' };
  await db.tasks.bulkPut([
    {
      id: 'stale-task',
      kind: 'recommend',
      contextId: 'stale-chat',
      status: 'pending',
      owner: 'stale',
      model,
      createdAt: now,
    },
    {
      id: 'live-task',
      kind: 'recommend',
      contextId: 'live-chat',
      status: 'pending',
      owner: 'live',
      model,
      createdAt: now,
    },
  ]);
  await db.conversations.bulkPut([
    { id: 'finished', title: '已完成', createdAt: now, lastSentAt: now, messages: [] },
    ...['stale', 'live'].map((owner) => ({
      id: `${owner}-chat`,
      title: owner,
      createdAt: now,
      lastSentAt: now,
      messages: [
        {
          id: owner,
          taskId: `${owner}-task`,
          role: 'assistant' as const,
          text: '等待中',
          status: 'pending' as const,
          createdAt: now,
        },
      ],
    })),
    {
      id: 'orphan',
      title: '孤立消息',
      createdAt: now,
      lastSentAt: now,
      messages: [
        { id: 'orphan', role: 'assistant', text: '等待中', status: 'pending', createdAt: now },
      ],
    },
  ]);
  const updated: string[] = [];
  const onUpdate = (_changes: unknown, id: unknown) => {
    updated.push(String(id));
  };
  db.conversations.hook('updating', onUpdate);
  try {
    await initialize();
    expect(updated).not.toContain('finished');
    expect(updated).not.toContain('live-chat');
    expect((await db.tasks.get('stale-task'))?.status).toBe('interrupted');
    expect((await db.tasks.get('live-task'))?.status).toBe('pending');
    expect((await db.conversations.get('orphan'))?.messages[0].status).toBe('interrupted');
    expect(await db.settings.get('lease:stale')).toBeUndefined();
    expect(await db.settings.get('lease:invalid')).toBeUndefined();
    expect((await db.settings.get('lease:live'))?.value).toBe(now);
    expect((await db.settings.get(`lease:${pageOwner}`))?.value).toBeGreaterThanOrEqual(now);
  } finally {
    db.conversations.hook('updating').unsubscribe(onUpdate);
  }
});
