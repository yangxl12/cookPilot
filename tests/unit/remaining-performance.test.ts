import { expect, it, vi } from 'vitest';
import { db } from '../../src/storage/db';
import {
  appendMessages,
  migrateConversation,
  readConversation,
  updateMessage,
} from '../../src/storage/messages';
import { exportSnapshot } from '../../src/storage/exportSnapshot';
import { findExisting, initialize, pruneTasks } from '../../src/storage/repository';
import { readRecipeList, addVersion } from '../../src/storage/recipeList';
import {
  summarizeRequirements,
  checkInputBudget,
  recentContext,
  INPUT_CHAR_BUDGET,
} from '../../src/services/ai/contextBudget';
import { contentExample, recommend } from '../../src/services/ai/cooking';
import type { Message, Task } from '../../src/domain/schema';
import { newSession } from '../../src/storage/repository';

const metadata = { id: 'chat', title: '长对话', createdAt: 1, lastSentAt: Date.now() };
const messages = (count: number): Message[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 ? 'assistant' : 'user',
    text: '日常闲聊',
    createdAt: i,
  }));

it('千条消息后追加与完成只写受影响消息，元信息不保存旧消息数组', async () => {
  await appendMessages(metadata, messages(1000));
  let reads = 0;
  let writes = 0;
  const reading = (value: unknown) => {
    reads++;
    return value;
  };
  const creating = () => {
    writes++;
  };
  db.conversationMessages.hook('reading', reading);
  db.conversationMessages.hook('creating', creating);
  try {
    await appendMessages(metadata, [
      { id: 'latest-user', role: 'user', text: '花生过敏，鸡蛋3个，只用炒锅', createdAt: 1001 },
      {
        id: 'latest-answer',
        role: 'assistant',
        text: '正在分析',
        status: 'pending',
        createdAt: 1002,
      },
    ]);
    expect(reads).toBe(0);
    expect(writes).toBe(2);
    await updateMessage('latest-answer', { text: '新的建议', status: 'done' });
    expect(reads).toBeLessThanOrEqual(2);
    expect((await db.conversations.get('chat'))?.messages).toEqual([]);
    expect((await db.conversationSummaries.get('chat'))?.questionCount).toBe(501);
    expect((await db.conversations.get('chat'))?.requirements).toContain('花生过敏');
    expect((await db.messageSearch.get('latest-answer'))?.body).toContain('新的建议');
  } finally {
    db.conversationMessages.hook('reading').unsubscribe(reading);
    db.conversationMessages.hook('creating').unsubscribe(creating);
  }
});

it('消息分表失败保留原数组和成功游标，重开后继续；单条投影失败也回滚正文', async () => {
  await db.conversations.put({ ...metadata, messages: messages(65) });
  let writes = 0;
  const fail = () => {
    if (++writes === 33) throw new Error('磁盘失败');
  };
  db.messageSearch.hook('creating', fail);
  try {
    await expect(migrateConversation('chat')).rejects.toThrow('磁盘失败');
  } finally {
    db.messageSearch.hook('creating').unsubscribe(fail);
  }
  expect(await db.conversationMessages.count()).toBe(32);
  expect((await db.settings.get('messagesAfter-v5:chat'))?.value).toBe(32);
  expect((await db.conversations.get('chat'))?.messages).toHaveLength(65);
  db.close();
  await db.open();
  await migrateConversation('chat');
  expect((await readConversation('chat'))?.messages.map((m) => m.id)).toEqual(
    messages(65).map((m) => m.id),
  );
  expect(await db.settings.get('messagesAfter-v5:chat')).toBeUndefined();
  const failUpdate = () => {
    throw new Error('更新失败');
  };
  db.messageSearch.hook('updating', failUpdate);
  try {
    await expect(updateMessage('m1', { text: '未提交内容' })).rejects.toThrow('更新失败');
  } finally {
    db.messageSearch.hook('updating').unsubscribe(failUpdate);
  }
  expect((await db.conversationMessages.get('m1'))?.text).toBe('日常闲聊');
});

it('输入预算保留早期过敏、用量和最新重复修改，过大约束明确报错', async () => {
  let summary = summarizeRequirements('', '花生过敏；鸡蛋3个；只用炒锅');
  summary = summarizeRequirements(summary, '鸡蛋2个');
  summary = summarizeRequirements(summary, '鸡蛋3个');
  expect(summary.endsWith('鸡蛋3个')).toBe(true);
  expect(summary).toContain('花生过敏');
  expect(() => summarizeRequirements('', '鸡蛋3个'.repeat(2000))).toThrow('明确用量与限制过多');
  expect(
    recentContext(Array.from({ length: 1000 }, () => ({ role: 'user', content: '聊天' }))),
  ).toHaveLength(20);
  expect(() =>
    checkInputBudget([{ role: 'user', content: '长'.repeat(INPUT_CHAR_BUDGET) }]),
  ).toThrow('输入预算');
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{"text":"建议","candidates":[]}' } }] }),
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  try {
    await recommend(
      { id: 'm', name: 'm', model: 'm', url: 'https://example.com', key: '' },
      [
        { role: 'user', content: summary },
        ...Array.from({ length: 20 }, () => ({ role: 'assistant' as const, content: '聊天' })),
      ],
      { avoidances: '', taste: '', cookware: [] },
      Array.from({ length: 1000 }, (_, i) => `已有菜${i}`),
      new AbortController().signal,
    );
    const input = JSON.parse(fetcher.mock.calls[0][1].body).messages;
    expect(input[0].content).toContain('花生过敏');
    expect(JSON.stringify(input).length).toBeLessThan(INPUT_CHAR_BUDGET);
    expect(JSON.stringify(input)).not.toContain('已有菜999');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('时间游标每次只读下一页，已知别名通过索引查重且不扫描整表', async () => {
  await db.recipes.add({
    id: 'r',
    identity: '西红柿炒鸡蛋',
    name: contentExample.title,
    aliases: ['My Dish'],
    source: 'ai',
    createdAt: 1,
  });
  await addVersion({
    id: 'v',
    recipeId: 'r',
    number: 1,
    parentId: null,
    content: contentExample,
    change: '',
    createdAt: 1,
  });
  await db.sessions.bulkAdd(
    Array.from({ length: 75 }, (_, i) => ({
      ...newSession('r', 'v'),
      id: `s${String(i).padStart(3, '0')}`,
      createdAt: i,
    })),
  );
  await initialize();
  await db.settings.put({ id: 'recipeListReady-v3', value: true });
  const first = await readRecipeList(24, []);
  let reads = 0;
  const reading = (row: unknown) => {
    reads++;
    return row;
  };
  db.sessions.hook('reading', reading);
  try {
    const last = first.rows.at(-1)!;
    const next = await readRecipeList(24, [], { id: last.id, createdAt: last.createdAt });
    expect(reads).toBe(25);
    expect(new Set([...first.rows, ...next.rows].map((s) => s.id)).size).toBe(48);
  } finally {
    db.sessions.hook('reading').unsubscribe(reading);
  }
  const scan = vi.spyOn(db.recipes, 'toArray');
  expect((await findExisting('my-dish'))?.recipe.id).toBe('r');
  expect(scan).not.toHaveBeenCalled();
  scan.mockRestore();
});

it('分块导出大数据保留旧schema、消息顺序与脱敏，失败后可重试', async () => {
  await appendMessages(metadata, messages(45));
  await db.versions.bulkPut(
    Array.from({ length: 80 }, (_, i) => ({
      id: `v${i}`,
      recipeId: 'r',
      number: i,
      parentId: null,
      content: { ...contentExample, conditions: '合成数据'.repeat(30000) },
      change: '',
      createdAt: i,
    })),
  );
  await db.models.put({ id: 'model', name: '模型', url: 'https://example.com', model: 'model' });
  await db.credentials.put({ modelId: 'model', key: 'private-export-secret' });
  const blob = await exportSnapshot();
  expect(blob.size).toBeGreaterThan(20 * 1024 * 1024);
  const output = await blob.text();
  const result = JSON.parse(output);
  expect(result.schemaVersion).toBe(1);
  expect(result.versions).toHaveLength(80);
  expect(result.conversations[0].messages.map((m: Message) => m.id)).toEqual(
    messages(45).map((m) => m.id),
  );
  expect(result.models[0].key).toBe('[已隐藏]');
  expect(output).not.toContain('private-export-secret');
  expect(result.messageSearch).toBeUndefined();
  expect(result.conversationMessages).toBeUndefined();
  expect(result.conversations[0].messageCount).toBeUndefined();
  const fail = vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('读取失败'));
  try {
    await expect(exportSnapshot()).rejects.toThrow('读取失败');
  } finally {
    fail.mockRestore();
  }
  expect((await exportSnapshot()).size).toBe(blob.size);
}, 15000);

it('终态清理按批推进，保留活动任务、消息引用与待保存结果', async () => {
  const time = Date.now();
  const task = (id: string): Task => ({
    id,
    kind: 'generate',
    contextId: '',
    model: { id: 'm', name: 'm', model: 'm', url: 'https://example.com' },
    owner: '',
    status: 'done',
    createdAt: time - 31 * 86400000,
  });
  await db.tasks.bulkPut(
    Array.from({ length: 70 }, (_, i) => task(`t${String(i).padStart(3, '0')}`)),
  );
  await db.tasks.put({ ...task('active'), status: 'pending' });
  await db.tasks.put({ ...task('draft'), status: 'failed', resultContent: contentExample });
  await appendMessages(metadata, [
    { id: 'answer', taskId: 't000', role: 'assistant', text: '保存结果', createdAt: time },
  ]);
  for (let i = 0; i < 4; i++) await pruneTasks(time);
  expect((await db.tasks.toArray()).map((t) => t.id).sort()).toEqual(['active', 'draft', 't000']);
});
