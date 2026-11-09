import Dexie from 'dexie';
import { expect, it, vi } from 'vitest';
import { CookDatabase, db, setSetting } from '../../src/storage/db';
import {
  backfillSearchBatch,
  changeConversation,
  prepareSearchIndex,
  readConversationHistory,
  readSearchIndex,
  saveConversation,
} from '../../src/storage/searchIndex';
import { addVersion } from '../../src/storage/recipeList';
import {
  cancelTask,
  clearData,
  cookAgain,
  createTask,
  deleteSession,
  initialize,
  newSession,
  pruneHistory,
} from '../../src/storage/repository';
import { contentExample } from '../../src/services/ai/cooking';
import type { Conversation, RecipeVersion } from '../../src/domain/schema';

const version = (id = 'v1', change = '旧版独有调整'): RecipeVersion => ({
  id,
  recipeId: 'r',
  number: id === 'v1' ? 1 : 2,
  parentId: null,
  content: structuredClone(contentExample),
  change,
  createdAt: 1,
});
const conversation = (id = 'chat', lastSentAt = Date.now()): Conversation => ({
  id,
  title: `对话${id}`,
  createdAt: lastSentAt,
  lastSentAt,
  messages: [
    { id: 'u', role: 'user', text: '提问专属词', createdAt: lastSentAt },
    {
      id: 'a',
      role: 'assistant',
      text: '回复专属词',
      status: 'done',
      createdAt: lastSentAt,
      candidates: [
        {
          name: '候选独有菜',
          summary: '候选独有摘要',
          aliases: [],
          minutes: 1,
          difficulty: '简单',
          blocked: '',
        },
      ],
    },
  ],
});
const matched = (rows: Awaited<ReturnType<typeof readSearchIndex>>, query: string) =>
  rows.filter((r) =>
    query
      .toLowerCase()
      .split(/\s+/)
      .every((t) => r.parts.some((p) => p.searchText.includes(t))),
  );

async function seed() {
  await db.recipes.add({
    id: 'r',
    name: contentExample.title,
    identity: 'dish',
    aliases: [],
    source: 'ai',
    createdAt: 1,
  });
  await addVersion(version());
  await addVersion(version('v2', '新版调整'));
  await db.sessions.put({ ...newSession('r', 'v2'), id: 's', note: '心得专属词 Hidden' });
  await saveConversation(conversation());
  await prepareSearchIndex('version');
  await prepareSearchIndex('conversation');
}

it('持久搜索保留正文、旧版变更、心得、候选摘要与跨字段多词语义，并且不读完整版本和对话', async () => {
  await seed();
  let fullReads = 0;
  const reading = (value: unknown) => {
    fullReads++;
    return value;
  };
  db.versions.hook('reading', reading);
  db.conversations.hook('reading', reading);
  try {
    const rows = await readSearchIndex();
    expect(matched(rows, '旧版独有调整 hidden').map((r) => r.id)).toEqual(['s']);
    expect(matched(rows, contentExample.ingredients[0].name).some((r) => r.id === 's')).toBe(true);
    expect(matched(rows, '候选独有菜 候选独有摘要').map((r) => r.id)).toEqual(['chat']);
    expect(matched(rows, '提问专属词 回复专属词').map((r) => r.id)).toEqual(['chat']);
    expect(fullReads).toBe(0);
  } finally {
    db.versions.hook('reading').unsubscribe(reading);
    db.conversations.hook('reading').unsubscribe(reading);
  }
});

it('心得更新不重建不可变版本索引，候选更新和取消同步更新对话投影', async () => {
  await seed();
  const versionWrite = vi.spyOn(db.versionSearch, 'put');
  const versionAdd = vi.spyOn(db.versionSearch, 'add');
  try {
    await db.sessions.update('s', { note: '新心得独有词' });
    expect(matched(await readSearchIndex(), '新心得独有词').map((r) => r.id)).toEqual(['s']);
    expect(matched(await readSearchIndex(), '心得专属词')).toHaveLength(0);
    expect(versionWrite).not.toHaveBeenCalled();
    expect(versionAdd).not.toHaveBeenCalled();
  } finally {
    versionWrite.mockRestore();
    versionAdd.mockRestore();
  }
  const task = await createTask('recommend', 'chat', {
    id: 'm',
    name: 'm',
    model: 'm',
    url: 'https://example.com',
  });
  await changeConversation('chat', (c) => {
    c.messages[1] = {
      ...c.messages[1],
      text: '等待专属词',
      status: 'pending',
      taskId: task.id,
      candidates: [],
    };
  });
  expect(matched(await readSearchIndex(), '候选独有摘要')).toHaveLength(0);
  await cancelTask(task.id);
  expect((await db.conversationSearch.get('chat'))?.body).toContain('请求已取消');
  expect((await db.conversationSummaries.get('chat'))?.questionCount).toBe(1);
});

it('版本/对话投影写入失败时业务数据一起回滚；重试不丢失原对话', async () => {
  const fail = () => {
    throw new Error('投影写入失败');
  };
  db.versionSearch.hook('creating', fail);
  try {
    await expect(addVersion(version())).rejects.toThrow('投影写入失败');
  } finally {
    db.versionSearch.hook('creating').unsubscribe(fail);
  }
  expect(await db.versions.count()).toBe(0);
  expect(await db.versionSummaries.count()).toBe(0);
  db.conversationSearch.hook('creating', fail);
  try {
    await expect(saveConversation(conversation())).rejects.toThrow('投影写入失败');
  } finally {
    db.conversationSearch.hook('creating').unsubscribe(fail);
  }
  expect(await db.conversations.count()).toBe(0);
  expect(await db.conversationSummaries.count()).toBe(0);
  await saveConversation(conversation());
  expect(await db.conversationSearch.count()).toBe(1);
  db.conversationSearch.hook('updating', fail);
  try {
    await expect(
      changeConversation('chat', (c) => {
        c.title = '失败标题';
        c.messages = [];
      }),
    ).rejects.toThrow('投影写入失败');
  } finally {
    db.conversationSearch.hook('updating').unsubscribe(fail);
  }
  expect((await db.conversations.get('chat'))?.title).toBe('对话chat');
  expect((await db.conversationSummaries.get('chat'))?.questionCount).toBe(1);
});

it('历史按时间和ID游标只读一页摘要，同时间及删除游标记录后不重不漏', async () => {
  const now = Date.now();
  for (let i = 0; i < 61; i++)
    await saveConversation(conversation(`c${String(i).padStart(3, '0')}`, now));
  await saveConversation(conversation('expired', now - 31 * 86400000));
  await prepareSearchIndex('conversation');
  let bodyReads = 0;
  let summaryReads = 0;
  const bodyReading = (value: unknown) => {
    bodyReads++;
    return value;
  };
  const summaryReading = (value: unknown) => {
    summaryReads++;
    return value;
  };
  db.conversations.hook('reading', bodyReading);
  db.conversationSummaries.hook('reading', summaryReading);
  try {
    const first = await readConversationHistory(25);
    expect(first).toHaveLength(25);
    expect(summaryReads).toBe(25);
    expect(bodyReads).toBe(0);
    const cursor = first[23];
    await db.conversationSummaries.delete(cursor.id);
    const second = await readConversationHistory(25, cursor);
    const third = await readConversationHistory(25, second[23]);
    const ids = [...first.slice(0, 24), ...second.slice(0, 24), ...third].map((r) => r.id);
    expect(new Set(ids).size).toBe(61);
    expect(ids).not.toContain('expired');
  } finally {
    db.conversations.hook('reading').unsubscribe(bodyReading);
    db.conversationSummaries.hook('reading').unsubscribe(summaryReading);
  }
});

it('v3升级后分批回填可在关闭重开后恢复，失败批次和游标一起回滚，期间保留搜索回退', async () => {
  const name = `search-upgrade-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(3).stores({
    recipes: 'id, &[source+identity], source, *aliases',
    versions: 'id, recipeId, [recipeId+number], createdAt',
    versionSummaries: 'id, recipeId',
    sessions: 'id, recipeId, versionId, createdAt, [source+createdAt+id]',
    conversations: 'id, lastSentAt',
    settings: 'id',
  });
  const upgraded = new CookDatabase(name);
  try {
    await old.open();
    const versions = Array.from({ length: 65 }, (_, i) => ({
      ...version(`v${String(i).padStart(3, '0')}`),
      number: i + 1,
    }));
    await old.table('versions').bulkPut(versions);
    await old
      .table('conversations')
      .bulkPut(
        Array.from({ length: 65 }, (_, i) => conversation(`c${String(i).padStart(3, '0')}`)),
      );
    old.close();
    await upgraded.open();
    expect(upgraded.verno).toBe(4);
    expect(await upgraded.versions.count()).toBe(65);
    expect((await upgraded.settings.get('versionSearchReady-v4'))?.value).not.toBe(true);
    const fail = () => {
      throw new Error('回填失败');
    };
    upgraded.versionSearch.hook('creating', fail);
    try {
      await expect(backfillSearchBatch('version', upgraded)).rejects.toThrow('回填失败');
    } finally {
      upgraded.versionSearch.hook('creating').unsubscribe(fail);
    }
    expect(await upgraded.versionSearch.count()).toBe(0);
    expect(await upgraded.settings.get('versionSearchAfter-v4')).toBeUndefined();
    expect(await backfillSearchBatch('version', upgraded)).toBe(false);
    expect(await backfillSearchBatch('conversation', upgraded)).toBe(false);
    expect(await upgraded.versionSearch.count()).toBe(32);
    expect(await upgraded.conversationSearch.count()).toBe(32);
    upgraded.close();
    await upgraded.open();
    const visited: string[] = [];
    const reading = (row: RecipeVersion) => {
      visited.push(row.id);
      return row;
    };
    upgraded.versions.hook('reading', reading);
    try {
      while (!(await backfillSearchBatch('version', upgraded))) {
        /* each batch is bounded */
      }
    } finally {
      upgraded.versions.hook('reading').unsubscribe(reading);
    }
    expect(visited).toHaveLength(33);
    expect(visited[0]).toBe('v032');
    const peer = new CookDatabase(name);
    try {
      await peer.open();
      await Promise.all([
        backfillSearchBatch('conversation', upgraded),
        backfillSearchBatch('conversation', peer),
      ]);
    } finally {
      peer.close();
    }
    expect(await upgraded.versionSearch.count()).toBe(65);
    expect(await upgraded.conversationSummaries.count()).toBe(65);
    expect(await upgraded.conversationSearch.count()).toBe(65);
    expect(await upgraded.settings.get('versionSearchAfter-v4')).toBeUndefined();
  } finally {
    old.close();
    upgraded.close();
    await Dexie.delete(name);
  }
  // The singleton query still covers every source when neither backfill is ready.
  await seed();
  await db.versionSearch.clear();
  await db.conversationSearch.clear();
  await db.settings.bulkDelete(['versionSearchReady-v4', 'conversationSearchReady-v4']);
  expect(matched(await readSearchIndex(), '旧版独有调整')).toHaveLength(1);
  expect(matched(await readSearchIndex(), '候选独有摘要')).toHaveLength(1);
});

it('过期清理、最后引用删除和清空数据同步清理搜索投影', async () => {
  await seed();
  const next = await cookAgain('s');
  await deleteSession('s');
  expect(await db.versionSearch.count()).toBe(2);
  await deleteSession(next.id);
  expect(await db.versionSearch.count()).toBe(0);
  await saveConversation(conversation('expired', Date.now() - 31 * 86400000));
  await setSetting('activeConversationId', 'expired');
  await pruneHistory();
  expect(await db.conversationSummaries.get('expired')).toBeUndefined();
  expect(await db.conversationSearch.get('expired')).toBeUndefined();
  await clearData();
  expect(await db.conversationSummaries.count()).toBe(0);
  expect(await db.conversationSearch.count()).toBe(0);
});

it('陈旧请求恢复会同步替换对话搜索中的等待文本', async () => {
  const task = await createTask('recommend', 'chat', {
    id: 'm',
    name: 'm',
    model: 'm',
    url: 'https://example.com',
  });
  await saveConversation({
    ...conversation(),
    messages: [
      {
        id: 'a',
        taskId: task.id,
        role: 'assistant',
        text: '旧等待专属词',
        status: 'pending',
        createdAt: Date.now(),
      },
    ],
  });
  await initialize();
  expect((await db.conversationSearch.get('chat'))?.body).toContain('请求已中断');
  expect((await db.conversationSearch.get('chat'))?.body).not.toContain('旧等待专属词');
});
